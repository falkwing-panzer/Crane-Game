import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import './style.css';
import { CRANES, isCrawler, type CraneId, type WheeledSpec } from './crane/cranes';
import { TRUCK_IDS } from './render/models/layout';
import { initialState, stepCrane, stepOutriggers, type CraneState } from './crane/kinematics';
import { baseConfig, lmiStatic, ratedCap, reach } from './crane/stability';
import { dynamicStability, stepTilt, supportMode, toggleOutriggers, TILTED_PHI, type Dyn } from './crane/ops';
import { apply, carrierFrame, carrierPose, edgeAxis, rotate, worldToCarrier, type Pose } from './crane/pose';
import { stepDrive, stepSuspension } from './crane/drive';
import { blockWhileAssembling, jibPhase, towerPhase, outriggersLocked, stepAssembly, teleLimit, toggleBallast, toggleMount, toggleYGuy, yGuyPhase } from './crane/assembly';
import { CameraRig } from './render/camera';
import { buildSite, TEST_HEAVY, TEST_OBSTACLES, TEST_SOFT } from './render/site';
import { createScene } from './render/scene';
import { CraneModel } from './render/craneModel';
import { CrawlerModel } from './render/crawlerModel';
import { Rigging } from './render/rigging';
import { Physics, FIXED_DT } from './physics/world';
import { Input } from './ui/input';
import { Hud } from './ui/hud';
import { stepSuperlift } from './crane/superlift';
import { LEVELS } from './levels/levels';
import { LEVEL_BOUNDS, allPlaced, placeCrane, populate } from './levels/setup';
import { buildLevelSite } from './render/levelSite';
import { LevelUi, levelUrl, saveRecord, stars } from './ui/levelUi';
import { HARD_LANDING, LANDING_MIN, LINE_WARN, lineMargin, windArea, windForce } from './levels/rules';
import { boomFoot, headPos } from './crane/kinematics';

/** Grúas del menú: las de ruedas (fase 4), la grúa torre sobre camión (fase 8) y las de orugas (fase 6) */
const MENU_IDS: CraneId[] = [...TRUCK_IDS, 'crawler', 'lr'];

const MODE_TEXT = { out: 'estabilizadores', tire: 'neumáticos', move: 'en marcha', crawler: 'orugas', crawlMove: 'orugas en marcha' };

const _lat = new THREE.Vector3();
const _wd = new THREE.Vector3();

async function start() {
  await RAPIER.init();

  const ctx = createScene(document.getElementById('c') as HTMLCanvasElement);
  // ?nivel=1…13: un nivel (con ?grua= una de las permitidas; si no, la recomendada).
  // ?grua=id o ?libre=1: prueba libre con los obstáculos de prueba. Sin parámetros: menú de niveles.
  const params = new URLSearchParams(location.search);
  const nivel = Number(params.get('nivel')) || 0;
  const li = nivel >= 1 && nivel <= LEVELS.length ? nivel - 1 : -1;
  const L = li >= 0 ? LEVELS[li] : null;
  const showMenu = !L && !params.has('grua') && !params.has('libre');
  const q = params.get('grua') as CraneId | null;
  const id: CraneId = L ? (q && L.cranes.includes(q) ? q : L.rec) : q && MENU_IDS.includes(q) ? q : 'medium';
  const T = CRANES[id];
  const S: CraneState = initialState(T);
  const C = baseConfig(T);
  if (L) placeCrane(T, S, L);
  // el plumín abatible solo en el nivel "Sobre la nave" (referencia: jibAvail) y en la prueba libre
  const jibOk = !!T.jibDef && (!L || !!L.jib);

  const crane = isCrawler(T) ? new CrawlerModel(T) : new CraneModel(T as WheeledSpec);
  ctx.scene.add(crane.root);
  let pose: Pose = carrierPose(T, S, supportMode(S, T));
  const phys = new Physics(T, S, pose, L ? { testLoad: false, bounds: LEVEL_BOUNDS } : {});
  if (L) {
    populate(phys, L);
    buildLevelSite(ctx.scene, L);
  } else {
    for (const o of TEST_OBSTACLES) phys.addObstacle(o);
    // carga pesada de prueba para la LR 3000
    if (T.superlift) phys.addLoad(TEST_HEAVY.label, TEST_HEAVY.mass, TEST_HEAVY.half, TEST_HEAVY.pos);
    phys.softs.push(...TEST_SOFT);
    buildSite(ctx.scene, phys.obstacles, phys.softs);
  }
  const rig = new Rigging(ctx.scene, phys, T);
  // escala de la cámara con el largo del chasis; las orugas, con su pluma de celosía larga, más lejos
  // (la LR 3000, con 108 m de pluma, unas 3 veces la distancia de la AT 60)
  // con plumín (AT 650-8: 54 + 42 m), según el largo total
  const camSize = Math.max(isCrawler(T) ? Math.max(1.4, T.boom.max / 36) : 1, (T.len[1] - T.len[0]) / 12.3,
    T.jibDef ? (T.boom.max + T.jibDef.len) / 55 : 0,
    // grúa torre: 40 m de alto y 60 m de pluma (la referencia aleja la vista a J·1,2 + 16)
    T.tower ? (T.tower.J * 1.2 + 16) / 40 : 0);
  // encuadre de sombras: lo que llega la pluma más tumbada (y la bandeja del superlift), al menos ±45 m
  const shadowHalf = Math.max(45, T.foot + T.boom.max * Math.cos(T.boom.angMin) + 6,
    T.jibDef ? T.foot + T.boom.min + T.jibDef.len + 8 : 0,
    T.superlift ? T.superlift.rMax + T.superlift.w / 2 + 4 : 0);
  const cam = new CameraRig(ctx, crane.cab, (s) => crane.eye(s), camSize, shadowHalf);
  const input = new Input();
  const hud = new Hud(document.getElementById('hud')!, T.name, id, MENU_IDS.map((k) => ({ id: k, name: CRANES[k].name })),
    { ballast: !!T.ballast, yguy: !!T.yguy, outriggers: !!T.out, tele: T.boom.max > T.boom.min, superlift: !!T.superlift, jib: jibOk, tower: !!T.tower });
  hud.onCrane = (k) => { location.href = levelUrl(0, k); };

  // Niveles: menú, ficha, carteles y reloj. El turno empieza en pausa hasta "Empezar turno".
  const hudRoot = document.getElementById('hud')!;
  const lui = new LevelUi(hudRoot);
  hudRoot.insertAdjacentHTML('beforeend', `<a class="panel menu-btn" href="${location.pathname}" style="top:${L ? 86 : 124}px">☰ Niveles</a>`);
  if (L) hudRoot.querySelector<HTMLElement>('.pick')!.hidden = true;
  let running = !L && !showMenu;
  /** Nivel: tiempo de turno, terminado (ganado o fallido), LMI máximo con la carga colgada */
  // (parte B) bumpCd: espera entre golpes; lineD: margen a la línea eléctrica más cercana; inProx: dentro de la alarma;
  // wind: viento actual (m/s)
  const run = { t: 0, done: false, hard: 0, bumps: 0, prox: 0, maxLmi: 0, bumpCd: 0, lineD: Infinity, inProx: false, wind: 0 };
  let winCheck = 0;
  if (showMenu) lui.menu();
  else if (L) lui.brief(li, id, (k) => { location.href = levelUrl(nivel, k); }, () => { running = true; });
  const finish = (fail: { title: string; text: string } | null) => {
    if (!L || run.done) return;
    run.done = true;
    running = false;
    if (fail) { lui.failed(li, T.name, fail.title, fail.text); return; }
    const n = stars(L, run);
    lui.won(li, T.name, run, saveRecord(li, n, run.t));
  };
  /** Golpe (strike de la referencia): cuenta para las estrellas, uno por segundo como mucho */
  const bump = (msg: string) => {
    if (!L || run.bumpCd > 0) return;
    run.bumps++;
    run.bumpCd = 1;
    hud.say(msg, 2);
  };

  let dyn: Dyn = { u: 0, edge: 0, lmi: 0 };
  let cut = false, cutMsg = false;
  /** Puenteo del LMI (tecla P): sin cortes, para poder probar el vuelco */
  let bypass = false;
  /** Tiempo desde el vuelco: el cartel sale después, para ver caer la grúa */
  let tipClock = -1, tipText = '';
  const CARD_DELAY = 2.5;
  const tipped = () => phys.tipped !== null;
  const hanging = () => !!phys.attached && !phys.isResting(phys.attached);

  /** Las teclas actúan solo con el turno en marcha (no con la ficha o un cartel abiertos) y la grúa de pie */
  const live = () => running && !tipped();
  input.onHook = () => { if (live()) hud.say(phys.toggleHook()); };
  // X y P son ayudas de prueba: solo en la prueba libre
  input.onReset = () => { if (live()) hud.say(L ? 'En los niveles no se puede reponer la carga (X): solo en la prueba libre' : phys.resetLoads()); };
  input.onOutriggers = () => {
    if (live()) hud.say(toggleOutriggers(T, C, S, { loadHanging: hanging(), padsBlocked: phys.padsBlocked(S), locked: outriggersLocked(S) }), 1.8);
  };
  input.onBallast = () => {
    if (live()) hud.say(toggleBallast(T, S, { loadHanging: hanging(), tailBlocked: phys.tailBlocked(S, S.slew, 1) }), 1.8);
  };
  input.onYGuy = () => { if (live()) hud.say(toggleYGuy(T, S, { loadHanging: hanging() }), 2.2); };
  input.onMount = () => {
    if (!live()) return;
    if (T.jibDef && !jibOk) { hud.say('En este trabajo no hace falta el plumín', 2); return; }
    hud.say(toggleMount(T, S, { loadAttached: !!phys.attached, groundBlocked: phys.jibGroundBlocked(S, pose) }), 2.4);
  };
  input.onView = () => hud.say(cam.cycle(S, pose), 1.5);
  input.onBypass = () => {
    if (L) { hud.say('El puenteo del LMI (P) solo está en la prueba libre', 2); return; }
    bypass = !bypass;
    hud.say(bypass ? 'LMI PUENTEADO: sin cortes, la grúa puede volcar' : 'LMI activo de nuevo', 2.5);
  };
  hud.onRestart = () => {
    Object.assign(S, initialState(T));
    Object.assign(C, baseConfig(T)); // sin lastre ni Y-guy
    pose = carrierPose(T, S, supportMode(S, T));
    phys.reset(S, pose);
    dyn = { u: 0, edge: 0, lmi: 0 };
    tipClock = -1;
    bypass = false;
    hud.showTipped(null);
    hud.say('Grúa reiniciada', 1.5);
  };
  if (!L && !showMenu) hud.say(T.tower ? `${T.name} · O despliega los estabilizadores · M monta la grúa torre · Q/E mueven el carro · V cambia la cámara`
    : T.superlift ? `${T.name} · K/L acercan o alejan el lastre superlift · la bandeja barre un círculo detrás · V cambia la cámara`
    : T.crawler ? `${T.name} · flechas para conducir (← → gira en el sitio) · puede llevar la carga colgada · V cambia la cámara`
    : `${T.name} · flechas para conducir · O despliega los estabilizadores · V cambia la cámara`, 4);

  /**
   * Reglas del nivel después de cada paso de física (impact, strike y líneas de la referencia): aterrizajes, vidrio
   * roto, golpes de la carga y distancia a las líneas eléctricas. Devuelve true si el nivel terminó.
   */
  function levelRules(): boolean {
    for (const e of phys.events.splice(0)) {
      if (e.kind === 'land') {
        if (e.v < LANDING_MIN) continue;
        if (e.load.fragile && e.v > e.load.fragile) {
          finish({ title: 'Vidrio roto', text: `La caja tocó a ${e.v.toFixed(2).replace('.', ',')} m/s. El vidrio necesita menos de ${String(e.load.fragile).replace('.', ',')} m/s: usa velocidad fina (Shift) antes de apoyar.` });
          return true;
        }
        if (e.v > HARD_LANDING) { run.hard++; hud.say(`Aterrizaje duro · ${e.v.toFixed(1).replace('.', ',')} m/s`, 2); }
        else hud.say(`Apoyada · ${e.v.toFixed(2).replace('.', ',')} m/s`, 1.4);
      } else if (e.v > 0.25) bump('La carga chocó con un obstáculo');
    }
    if (!L!.lines?.length || tipped()) return false;
    const hk = phys.hookBody.translation(), a = phys.attached;
    let load;
    if (a) {
      const c = a.body.translation();
      load = { bottom: { x: c.x, y: c.y - a.half.y, z: c.z }, top: { x: c.x, y: c.y + a.half.y, z: c.z }, r: Math.hypot(a.half.x, a.half.z) };
    }
    run.lineD = lineMargin(L!.lines, {
      foot: apply(pose, boomFoot(T, S)), head: apply(pose, headPos(T, S)), tip: phys.headWorld(),
      hook: { x: hk.x, y: hk.y, z: hk.z }, load,
    });
    if (run.lineD < LINE_WARN) {
      if (!run.inProx) { run.prox++; run.inProx = true; hud.say('¡Alarma de proximidad a línea eléctrica!', 2.5); }
    } else run.inProx = false;
    if (run.lineD < 0) {
      finish({ title: 'Contacto eléctrico', text: 'El equipo invadió la distancia mínima de seguridad del conductor energizado. Mantén la pluma, el cable y la carga lejos de los cables.' });
      return true;
    }
    return false;
  }

  /** Un paso fijo de la lógica de la grúa y de la física. */
  function tick(dt: number) {
    if (!running) return; // ficha, menú o cartel abiertos: todo quieto
    if (L) {
      run.t += dt;
      if (L.time && run.t > L.time) {
        finish({ title: 'Se acabó el tiempo', text: 'No terminaste la descarga a tiempo. Busca una posición desde la que alcances ambos camiones y la zona sin volver a moverte.' });
        return;
      }
      // checkWin: cada 0,25 s, sin nada enganchado, todas las cargas sueltas y quietas en una zona
      if ((winCheck += dt) >= 0.25 && !tipped()) {
        winCheck = 0;
        if (!phys.attached && allPlaced(phys.loads.map((l) => phys.placed(l)), L.zones)) { finish(null); return; }
      }
      run.bumpCd = Math.max(0, run.bumpCd - dt);
      // viento sobre la carga enganchada o el gancho (step de la referencia)
      const a = phys.attached;
      const w = windForce(L, run.t, windArea(a ? { w: 2 * a.half.x, d: 2 * a.half.z, h: 2 * a.half.y } : null));
      run.wind = w.v;
      phys.wind = { x: w.x, z: w.z };
    }
    const inp = input.state();
    if (!tipped()) {
      const att = phys.attached;
      const mLoad = T.hookM + (att ? att.mass : 0);
      // Conducción (antes de las funciones de la grúa, como step() en la referencia)
      const v0 = S.vd;
      const dr = stepDrive(T, S, input.drive(), dt, {
        loadHanging: hanging(),
        lmiMove: lmiStatic(T, C, T.crawler ? 'crawlMove' : 'move', S.Lb, S.ang, S.slew, mLoad),
        tilted: S.phi > TILTED_PHI,
        bypass,
        blocked: (x, z, h) => phys.carrierBlocked(x, z, h),
      });
      if (dr.msg) {
        // choque del chasis a más de 1,2 m/s: golpe (referencia)
        if (dr.hit && L) bump(dr.msg); else hud.sayOnce(dr.msg);
      }
      stepSuspension(T, S, (S.vd - v0) / dt, dt);
      // Montajes (lastre, Y-guy): avanzan y, mientras tanto, la grúa no se mueve
      // (grúa torre: el montaje se detiene si la torre o su pluma tocarían algo)
      const am = stepAssembly(T, S, C, dt, T.tower ? (s) => phys.towerHits(s, pose) : undefined);
      if (am) hud.say(am, 2);
      const bm = blockWhileAssembling(S, inp, T);
      if (bm) hud.sayOnce(bm);
      const teleMax = teleLimit(T, S);
      if (inp.tele > 0 && S.Lb >= teleMax - 1e-6 && teleMax < T.boom.max) {
        hud.sayOnce(`Sin arriostramiento tensado la pluma solo llega a ${teleMax} m (Y)`);
      }
      const md = supportMode(S, T);
      // Como la referencia: los cortes usan el LMI estático; la carga cuenta solo si cuelga.
      const mEval = hanging() ? mLoad : T.hookM;
      const noHoistUp = !!att && lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mLoad) >= 1;
      let hitMsg = '';
      cut = stepCrane(T, S, inp, dt, {
        // C.jibRel sigue al ángulo del plumín que se está probando (T/G)
        lmi: bypass ? () => 0 : (s) => { C.jibRel = s.jibRel; return lmiStatic(T, C, md, s.Lb, s.ang, s.slew, mEval); },
        L0: lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
        noHoistUp: noHoistUp && !bypass,
        tilted: S.phi > TILTED_PHI, // la inclinación limita los movimientos aunque el LMI esté puenteado
        teleMax,
        // la bandeja del superlift no atraviesa obstáculos al girar (boomHit de la referencia)
        // y las torres de lastre tampoco (no está en la referencia)
        // (fase 8B: el contrapeso de todas las grúas, salvo la torre, que lo lleva arriba)
        slewBlocked: !T.tower ? (s) => {
          const why = phys.trayBlocked(s.x, s.z, s.h, s.slew, C.slR) ?? phys.tailBlocked(s, s.slew, s.cw);
          if (why) hud.sayOnce(why);
          return !!why;
        } : undefined,
        // el plumín no atraviesa obstáculos, cargas sueltas ni el suelo; la torre y su pluma tampoco
        jibHit: T.jibDef || T.tower ? (s) => {
          const r = T.tower ? phys.towerHits(s, pose) : phys.jibHits(s, pose);
          if (r.n) hitMsg = r.what;
          return r.n;
        } : undefined,
        // el plumín o la torre tocarían algo: en un nivel cuenta como golpe (strike de la referencia)
        onHit: () => { if (L) bump(hitMsg); else hud.sayOnce(hitMsg); },
      });
      C.jibRel = S.jibRel;
      // radio del superlift (K/L), con el guard del LMI y sin chocar
      if (T.superlift && inp.sl) {
        const why = stepSuperlift(T, C, inp.sl, inp.fine, dt, {
          lmi: () => (bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval)),
          L0: bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
          hit: (r) => phys.trayBlocked(S.x, S.z, S.h, S.slew, r),
        });
        if (why === 'lmi') { cut = true; } else if (why) hud.sayOnce(why);
      }
      if (cut && !cutMsg) {
        hud.say(noHoistUp && inp.hoist < 0 ? 'LMI: la carga supera la capacidad en esta posición'
          : 'LMI: movimiento cortado · solo se permiten los que reducen el momento');
      }
      cutMsg = cut;
      stepOutriggers(T, S, dt);
      pose = carrierPose(T, S, supportMode(S, T));
    }
    phys.step(S, pose, C.slR);
    if (L) { if (levelRules()) return; } else phys.events.length = 0;
    if (tipped()) {
      pose = phys.tippedPose()!;
      if (tipClock >= 0 && (tipClock += dt) >= CARD_DELAY) {
        // en un nivel, el cartel de nivel fallido (Repetir vuelve a la ficha); en la prueba libre, Reiniciar
        if (L) finish({ title: 'La grúa volcó', text: tipText }); else hud.showTipped(tipText);
        tipClock = -1;
      }
      return;
    }

    // Estabilidad con la tensión real del cable: un balanceo o un tirón también cuentan.
    const md = supportMode(S, T);
    dyn = dynamicStability(T, C, S, md, phys.tension, worldToCarrier(S, phys.gp));
    if (hanging()) run.maxLmi = Math.max(run.maxLmi, dyn.lmi); // LMI máximo con la carga colgada (maxLmi de la referencia)
    if (stepTilt(S, dyn, dt)) {
      const { p, axis } = edgeAxis(T, md, S.edge);
      const f = carrierFrame(S); // la arista viene en el marco del chasis
      phys.tipOver(C, S, md, pose, apply(f, p), rotate(f.q, axis));
      S.vd = 0;
      cut = false;
      tipClock = 0;
      tipText = `El momento de vuelco superó la estabilidad (${Math.round(dyn.u * 100)} %). ` +
        (md === 'tire' || md === 'move' ? 'Sobre neumáticos la capacidad es mucho menor: despliega los estabilizadores (O). ' : '') +
        'Reduce el radio y evita que la carga se balancee hacia fuera.';
      hud.say('¡La grúa vuelca!', CARD_DELAY);
    }
  }

  // Bucle con paso de física fijo (60 Hz) y render a la frecuencia de la pantalla.
  let last = performance.now();
  let acc = 0;
  const MAX_STEPS = 4;

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dt;

    const t0 = performance.now();
    let n = 0;
    while (acc >= FIXED_DT && n < MAX_STEPS) {
      tick(FIXED_DT);
      acc -= FIXED_DT;
      n++;
    }
    if (n === MAX_STEPS) acc = 0; // si la máquina no da abasto, se ralentiza en vez de acumular
    draw(dt, performance.now() - t0);
  }

  /** Dibuja el cuadro y actualiza el HUD (physMs = tiempo de física de este cuadro). */
  function draw(dt: number, physMs: number) {
    const t1 = performance.now();
    crane.update(S, pose, C.slR);
    rig.update(crane.lateral(_lat));
    cam.update(dt, S, pose);
    ctx.renderer.render(ctx.scene, ctx.camera);
    const t2 = performance.now();

    const md = supportMode(S, T);
    const att = phys.attached;
    const hp = phys.headWorld();
    hud.frame(dt, physMs, t2 - t1, ctx.renderer.info);
    if (L) {
      // flecha del viento en pantalla: dirección del nivel respecto de hacia dónde mira la cámara
      ctx.camera.getWorldDirection(_wd);
      const fl = Math.hypot(_wd.x, _wd.z) || 1, fx = _wd.x / fl, fz = _wd.z / fl;
      const a = (L.wind[2] * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a);
      const arrow = (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI;
      lui.setClock(L, run.t, nivel, { wind: run.wind, arrow, lineD: run.lineD });
    } else lui.setClock(null, 0);
    hud.readout({
      Lb: S.Lb,
      angDeg: (S.ang * 180) / Math.PI,
      radius: Math.max(0, reach(T, C, S.Lb, S.ang)),
      headH: hp.y,
      cable: S.cable,
      load: att ? `${att.label} ${att.mass.toFixed(1).replace('.', ',')} t` : 'libre',
      fine: input.state().fine,
      lmi: dyn.lmi,
      rated: ratedCap(T, C, md, S.Lb, S.ang, S.slew),
      mHook: T.hookM + (att ? att.mass : 0),
      mode: S.out > 0 && S.out < 1 ? (S.outT ? 'desplegando estabilizadores…' : 'recogiendo estabilizadores…') : MODE_TEXT[md],
      tension: phys.tension,
      cut,
      tiltDeg: (S.phi * 180) / Math.PI,
      tipped: tipped(),
      bypass,
      speed: S.vd,
      steerDeg: T.crawler ? null : (S.steer * 180) / Math.PI,
      ballast: T.ballast ? { t: T.ballast.m * S.cw, of: T.ballast.m, p: S.cw, target: S.cwT } : null,
      yguy: T.yguy ? { text: yGuyPhase(S.yg), p: S.yg } : null,
      superlift: T.superlift ? { r: C.slR, min: T.superlift.rMin, max: T.superlift.rMax } : null,
      jib: T.jibDef ? { text: jibPhase(S.jg), p: S.jg, deg: ((S.ang - S.jibRel) * 180) / Math.PI, len: T.jibDef.len } : null,
      tower: T.tower ? { text: towerPhase(S.er, S.erT), p: S.er } : null,
    });
  }
  requestAnimationFrame(frame);

  // Acceso para depurar desde la consola del navegador
  // advance(s): avanza la simulación s segundos sin depender de requestAnimationFrame (pruebas con la pestaña oculta)
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __gruas: {
        S, C, T, phys, ctx, input, hud, cam, crane, L, lui, run,
        /** empieza el turno sin pulsar el botón de la ficha */
        start() { lui.close(); running = true; },
        get running() { return running; },
        get dyn() { return dyn; }, get pose() { return pose; }, get cut() { return cut; },
        advance(s: number) {
          for (let i = 0; i < Math.round(s / FIXED_DT); i++) tick(FIXED_DT);
          draw(FIXED_DT, 0);
        },
      },
    });
  }
}

start().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:40%;left:20px;color:#b00">${String(err)}</pre>`);
});
