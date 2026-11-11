import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import './style.css';
import { CRANES, isCrawler, type CraneId, type CraneSpec, type WheeledSpec } from './crane/cranes';
import { TRUCK_IDS } from './render/models/layout';
import { initialState, stepCrane, stepOutriggers, type CraneState } from './crane/kinematics';
import { baseConfig, lmiStatic, ratedCap, reach, type CraneConfig } from './crane/stability';
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
import { allPlaced, levelBounds, placeCrane, populate } from './levels/setup';
import { ALL_LEVELS as LEVELS, OVER_T, ROLL_MAX, SIDE_LOAD, SIDE_MAX, SIDE_T, SIDE_WARN, TANDEM_IDS, TEST_COLUMN, cableAngle, placeTandem, rollOf, tandemColumn } from './levels/tandemSetup';
import { buildLevelSite } from './render/levelSite';
import { LevelUi, levelUrl, saveRecord, stars } from './ui/levelUi';
import { HARD_LANDING, LANDING_MIN, LINE_WARN, lineMargin, windArea, windForce } from './levels/rules';
import { boomFoot, headPos } from './crane/kinematics';

/** Grúas del menú: las de ruedas (fase 4), la grúa torre sobre camión (fase 8) y las de orugas (fase 6) */
const MENU_IDS: CraneId[] = [...TRUCK_IDS, 'crawler', 'lr'];

const MODE_TEXT = { out: 'estabilizadores', tire: 'neumáticos', move: 'en marcha', crawler: 'orugas', crawlMove: 'orugas en marcha' };

const _lat = new THREE.Vector3();
const deg = (r: number) => Math.round((r * 180) / Math.PI);

const _wd = new THREE.Vector3();

/**
 * Una grúa en la obra: datos, estado, configuración de montaje, modelo 3D, física y lo que se mide de ella.
 * Normalmente hay una; en el tándem (fase 10) dos, en el mismo mundo de Rapier, y Tab cambia la que se maneja.
 */
interface Unit {
  id: CraneId;
  T: CraneSpec;
  S: CraneState;
  C: CraneConfig;
  crane: CraneModel | CrawlerModel;
  phys: Physics;
  rig: Rigging;
  pose: Pose;
  dyn: Dyn;
  cut: boolean;
  cutMsg: boolean;
  /** Tiempo desde el vuelco: el cartel sale después, para ver caer la grúa */
  tipClock: number;
  tipText: string;
  /** Plumín abatible permitido (nivel "Sobre la nave" y prueba libre) */
  jibOk: boolean;
  /** Nivel de tándem: tiempo seguido con el LMI por encima del 100 % y con el cable inclinado más del límite (s) */
  over: number;
  side: number;
  /** Ángulo del cable con la vertical (rad) */
  sideAng: number;
}


/** Mandos sueltos: la grúa que no se maneja se queda quieta */
const IDLE = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false, sl: 0, jib: 0 };
const IDLE_DRIVE = { throttle: 0, steer: 0, fine: false };

async function start() {
  await RAPIER.init();

  const ctx = createScene(document.getElementById('c') as HTMLCanvasElement);
  // ?nivel=1…13: un nivel (con ?grua= una de las permitidas; si no, la recomendada).
  // ?grua=id o ?libre=1: prueba libre con los obstáculos de prueba. ?tandem=1: prueba libre del tándem (dos grúas).
  // Sin parámetros: menú de niveles.
  const params = new URLSearchParams(location.search);
  const nivel = Number(params.get('nivel')) || 0;
  const li = nivel >= 1 && nivel <= LEVELS.length ? nivel - 1 : -1;
  const L = li >= 0 ? LEVELS[li] : null;
  // tándem: la prueba libre (?tandem=1) o el nivel 14
  const freeTandem = !L && params.has('tandem');
  const tandem = freeTandem || !!L?.tandem;
  const showMenu = !L && !freeTandem && !params.has('grua') && !params.has('libre');
  const q = params.get('grua') as CraneId | null;
  const ids: CraneId[] = L?.tandem ? [L.tandem.main.id, L.tandem.tail.id] : freeTandem ? [...TANDEM_IDS]
    : [L ? (q && L.cranes.includes(q) ? q : L.rec) : q && MENU_IDS.includes(q) ? q : 'medium'];

  // Estado de cada grúa y su colocación
  const states = ids.map((id) => {
    const T = CRANES[id];
    return { id, T, S: initialState(T), C: baseConfig(T) };
  });
  const place = () => {
    if (L?.tandem) placeTandem(states[0], states[1], L.tandem, tandemColumn(L));
    else if (freeTandem) placeTandem(states[0], states[1]);
    else if (L) placeCrane(states[0].T, states[0].S, L);
  };
  place();

  // Física: la primera grúa crea el mundo; la segunda lo comparte
  const units: Unit[] = [];
  for (const st of states) {
    const { T, S } = st;
    const pose = carrierPose(T, S, supportMode(S, T));
    const phys = units.length ? new Physics(T, S, pose, { site: units[0].phys })
      : new Physics(T, S, pose, L ? { testLoad: false, bounds: levelBounds(L) } : freeTandem ? { testLoad: false } : {});
    const crane = isCrawler(T) ? new CrawlerModel(T) : new CraneModel(T as WheeledSpec);
    ctx.scene.add(crane.root);
    units.push({
      ...st, crane, phys, pose, rig: null as unknown as Rigging, dyn: { u: 0, edge: 0, lmi: 0 }, cut: false, cutMsg: false,
      tipClock: -1, tipText: '', jibOk: !!T.jibDef && !tandem && (!L || !!L.jib), over: 0, side: 0, sideAng: 0,
    });
  }
  const site = units[0].phys;
  if (L) {
    populate(site, L);
    buildLevelSite(ctx.scene, L);
  } else if (freeTandem) {
    const c = TEST_COLUMN;
    site.addLoad(c.label, c.mass, c.half, c.pos, { lugs: c.lugs, color: '#9aa3aa', kind: 'vessel' });
    buildSite(ctx.scene, site.obstacles, site.softs);
  } else {
    const T = units[0].T;
    for (const o of TEST_OBSTACLES) site.addObstacle(o);
    // carga pesada de prueba para la LR 3000
    if (T.superlift) site.addLoad(TEST_HEAVY.label, TEST_HEAVY.mass, TEST_HEAVY.half, TEST_HEAVY.pos);
    site.softs.push(...TEST_SOFT);
    buildSite(ctx.scene, site.obstacles, site.softs);
  }
  // el aparejo de la primera grúa dibuja las cargas (después de crearlas)
  units.forEach((u, i) => { u.rig = new Rigging(ctx.scene, u.phys, u.T, i === 0); });

  /** Grúa que se maneja (Tab la cambia en el tándem) */
  let act = units[0];
  const multi = units.length > 1;

  // escala de la cámara con el largo del chasis; las orugas, con su pluma de celosía larga, más lejos
  // (la LR 3000, con 108 m de pluma, unas 3 veces la distancia de la AT 60)
  // con plumín (AT 650-8: 54 + 42 m), según el largo total
  const camSize = Math.max(...units.map(({ T }) => Math.max(isCrawler(T) ? Math.max(1.4, T.boom.max / 36) : 1, (T.len[1] - T.len[0]) / 12.3,
    T.jibDef ? (T.boom.max + T.jibDef.len) / 55 : 0,
    // grúa torre: 40 m de alto y 60 m de pluma (la referencia aleja la vista a J·1,2 + 16)
    T.tower ? (T.tower.J * 1.2 + 16) / 40 : 0)));
  // encuadre de sombras: lo que llega la pluma más tumbada (y la bandeja del superlift), al menos ±45 m
  const shadowHalf = Math.max(...units.map(({ T }) => Math.max(45, T.foot + T.boom.max * Math.cos(T.boom.angMin) + 6,
    T.jibDef ? T.foot + T.boom.min + T.jibDef.len + 8 : 0,
    T.superlift ? T.superlift.rMax + T.superlift.w / 2 + 4 : 0)));
  const cam = new CameraRig(ctx, act.crane.cab, (s) => act.crane.eye(s), camSize, shadowHalf);
  const input = new Input();
  const any = (f: (T: CraneSpec, u: Unit) => boolean) => units.some((u) => f(u.T, u));
  const hud = new Hud(document.getElementById('hud')!, act.T.name, act.id, MENU_IDS.map((k) => ({ id: k, name: CRANES[k].name })),
    { ballast: any((T) => !!T.ballast), yguy: any((T) => !!T.yguy), outriggers: any((T) => !!T.out), tele: any((T) => T.boom.max > T.boom.min),
      superlift: any((T) => !!T.superlift), jib: any((_, u) => u.jibOk), tower: any((T) => !!T.tower), tandem: multi });
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
  else if (L) lui.brief(li, ids[0], (k) => { location.href = levelUrl(nivel, k); }, () => { running = true; });
  const finish = (fail: { title: string; text: string } | null) => {
    if (!L || run.done) return;
    run.done = true;
    running = false;
    if (fail) { lui.failed(li, act.T.name, fail.title, fail.text); return; }
    const n = stars(L, run);
    lui.won(li, act.T.name, run, saveRecord(li, n, run.t));
  };
  /** Golpe (strike de la referencia): cuenta para las estrellas, uno por segundo como mucho */
  const bump = (msg: string) => {
    if (!L || run.bumpCd > 0) return;
    run.bumps++;
    run.bumpCd = 1;
    hud.say(msg, 2);
  };
  /** Mensaje de una grúa: en el tándem, los de la que no se maneja llevan su nombre */
  const sayU = (u: Unit, msg: string, s?: number) => hud.say(multi && u !== act ? `${u.T.name}: ${msg}` : msg, s);
  const sayOnceU = (u: Unit, msg: string) => hud.sayOnce(multi && u !== act ? `${u.T.name}: ${msg}` : msg);

  /** Puenteo del LMI (tecla P): sin cortes, para poder probar el vuelco */
  let bypass = false;
  const CARD_DELAY = 2.5;
  const tipped = (u = act) => u.phys.tipped !== null;
  /** Carga que cuenta en el gancho: en el tándem, su parte (medida); si no, toda si cuelga */
  const loadOnHook = (u: Unit) => {
    const att = u.phys.attached;
    if (!att) return 0;
    return u.phys.slingShare() ?? att.mass;
  };
  const hanging = (u = act) => !!u.phys.attached && (!!u.phys.attached.lugs || !u.phys.isResting(u.phys.attached));

  /** Las teclas actúan solo con el turno en marcha (no con la ficha o un cartel abiertos) y la grúa de pie */
  const live = () => running && !tipped();
  input.onHook = () => { if (live()) hud.say(act.phys.toggleHook()); };
  // X y P son ayudas de prueba: solo en la prueba libre
  input.onReset = () => { if (live()) hud.say(L ? 'En los niveles no se puede reponer la carga (X): solo en la prueba libre' : act.phys.resetLoads()); };
  input.onOutriggers = () => {
    const { T, C, S, phys } = act;
    if (live()) hud.say(toggleOutriggers(T, C, S, { loadHanging: hanging(), padsBlocked: phys.padsBlocked(S), locked: outriggersLocked(S) }), 1.8);
  };
  input.onBallast = () => {
    const { T, S, phys } = act;
    if (live()) hud.say(toggleBallast(T, S, { loadHanging: hanging(), tailBlocked: phys.tailBlocked(S, S.slew, 1) }), 1.8);
  };
  input.onYGuy = () => { if (live()) hud.say(toggleYGuy(act.T, act.S, { loadHanging: hanging() }), 2.2); };
  input.onMount = () => {
    if (!live()) return;
    const { T, S, phys, pose } = act;
    if (T.jibDef && !act.jibOk) { hud.say(multi ? 'En el tándem no se monta el plumín' : 'En este trabajo no hace falta el plumín', 2); return; }
    hud.say(toggleMount(T, S, { loadAttached: !!phys.attached, groundBlocked: phys.jibGroundBlocked(S, pose) }), 2.4);
  };
  input.onView = () => hud.say(cam.cycle(act.S, act.pose), 1.5);
  input.onBypass = () => {
    if (L) { hud.say('El puenteo del LMI (P) solo está en la prueba libre', 2); return; }
    bypass = !bypass;
    hud.say(bypass ? 'LMI PUENTEADO: sin cortes, la grúa puede volcar' : 'LMI activo de nuevo', 2.5);
  };
  input.onSwitch = () => {
    if (!multi || !running) return;
    act = units[(units.indexOf(act) + 1) % units.length];
    cam.follow(act.crane.cab, (s) => act.crane.eye(s));
    hud.setTitle(act.T.name);
    hud.say(`Manejas la ${act.T.name}${tipped() ? ' (volcada)' : ''} · la otra se queda quieta`, 2);
  };
  hud.onRestart = () => {
    for (const u of units) {
      Object.assign(u.S, initialState(u.T));
      Object.assign(u.C, baseConfig(u.T)); // sin lastre ni Y-guy
    }
    place(); // tándem: con los montajes hechos
    for (const u of units) {
      u.pose = carrierPose(u.T, u.S, supportMode(u.S, u.T));
      u.phys.reset(u.S, u.pose);
      u.dyn = { u: 0, edge: 0, lmi: 0 };
      u.tipClock = -1;
    }
    bypass = false;
    hud.showTipped(null);
    hud.say('Grúa reiniciada', 1.5);
  };
  if (freeTandem) hud.say('Tándem: LR 3000 en la cabeza de la columna y AT 500-8 en el pie · Espacio engancha cada una · Tab cambia de grúa', 5);
  else if (!L && !showMenu) {
    const T = act.T;
    hud.say(T.tower ? `${T.name} · O despliega los estabilizadores · M monta la grúa torre · Q/E mueven el carro · V cambia la cámara`
      : T.superlift ? `${T.name} · K/L acercan o alejan el lastre superlift · la bandeja barre un círculo detrás · V cambia la cámara`
      : T.crawler ? `${T.name} · flechas para conducir (← → gira en el sitio) · puede llevar la carga colgada · V cambia la cámara`
      : `${T.name} · flechas para conducir · O despliega los estabilizadores · V cambia la cámara`, 4);
  }

  /**
   * Reglas del nivel después de cada paso de física (impact, strike y líneas de la referencia): aterrizajes, vidrio
   * roto, golpes de la carga y distancia a las líneas eléctricas. Devuelve true si el nivel terminó.
   * (Los niveles tienen una sola grúa.)
   */
  function levelRules(): boolean {
    const { T, S, phys, pose } = units[0];
    // tándem: los aterrizajes y golpes de la carga los registra cada grúa que la lleva (el golpe espera 1 s)
    for (const e of units.flatMap((u) => u.phys.events.splice(0))) {
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
    if (L!.tandem && tandemRules()) return true;
    if (!L!.lines?.length || tipped(units[0])) return false;
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

  /**
   * Fallos del nivel de tándem (fase 10, no están en la referencia): una grúa con el LMI por encima del 100 % más de
   * 0,5 s; un cable que lleva carga a más de 6° de la vertical más de 1 s (tiro lateral sobre la pluma); la columna
   * ladeada más de 10° sobre su eje largo; un gancho contra su cabeza (doble bloqueo). Devuelve true si falló.
   */
  function tandemRules(): boolean {
    const dt = FIXED_DT;
    for (const u of units) {
      if (tipped(u)) continue;
      const { T, phys } = u;
      u.over = u.dyn.lmi > 1 ? u.over + dt : 0;
      if (u.over > OVER_T) {
        finish({ title: 'Grúa sobrecargada', text: `La ${T.name} pasó del 100 % de LMI (${Math.round(u.dyn.lmi * 100)} %). En un tándem, al mover una grúa cambia el reparto de la carga: mueve una función a la vez y vigila el LMI de las dos.` });
        return true;
      }
      const share = phys.slingShare();
      if (share !== null && share > SIDE_LOAD) {
        if (u.sideAng > SIDE_WARN) sayOnceU(u, `Tiro lateral: cable a ${deg(u.sideAng)}° de la vertical (máximo 6°)`);
        u.side = u.sideAng > SIDE_MAX ? u.side + dt : 0;
        if (u.side > SIDE_T) {
          finish({ title: 'Tiro lateral', text: `El cable de la ${T.name} se apartó ${deg(u.sideAng)}° de la vertical (máximo 6°). La pluma no aguanta cargas de costado: mantén cada cable vertical con el giro y la pluma, y mueve una grúa a la vez.` });
          return true;
        }
      } else u.side = 0;
      if (phys.attached && phys.twoBlocked()) {
        finish({ title: 'Doble bloqueo', text: `El gancho de la ${T.name} chocó con la cabeza de su pluma. Al subir la columna con la otra grúa, baja (F) el cable de esta o suéltala cuando ya no lleve carga.` });
        return true;
      }
    }
    const col = units[0].phys.loads[0];
    if (col && rollOf(col.body.rotation()) > ROLL_MAX) {
      finish({ title: 'Columna ladeada', text: `La columna se ladeó ${deg(rollOf(col.body.rotation()))}° sobre su eje (máximo 10°). Las dos grúas deben tirar en el mismo plano: no gires una mientras la otra sostiene el otro extremo.` });
      return true;
    }
    return false;
  }

  /** Mandos, montajes y conducción de una grúa antes del paso de física (inp/drv = null: no se maneja). */
  function controlUnit(u: Unit, dt: number, mine: boolean) {
    const { T, S, C, phys } = u;
    if (tipped(u)) return;
    const inp = mine ? input.state() : IDLE;
    const att = phys.attached;
    const mLoad = T.hookM + loadOnHook(u);
    // Conducción (antes de las funciones de la grúa, como step() en la referencia)
    const v0 = S.vd;
    const dr = stepDrive(T, S, mine ? input.drive() : IDLE_DRIVE, dt, {
      loadHanging: hanging(u),
      lmiMove: lmiStatic(T, C, T.crawler ? 'crawlMove' : 'move', S.Lb, S.ang, S.slew, mLoad),
      tilted: S.phi > TILTED_PHI,
      bypass,
      blocked: (x, z, h) => phys.carrierBlocked(x, z, h),
    });
    if (dr.msg) {
      // choque del chasis a más de 1,2 m/s: golpe (referencia)
      if (dr.hit && L) bump(dr.msg); else sayOnceU(u, dr.msg);
    }
    stepSuspension(T, S, (S.vd - v0) / dt, dt);
    // Montajes (lastre, Y-guy): avanzan y, mientras tanto, la grúa no se mueve
    // (grúa torre: el montaje se detiene si la torre o su pluma tocarían algo)
    const am = stepAssembly(T, S, C, dt, T.tower ? (s) => phys.towerHits(s, u.pose) : undefined);
    if (am) sayU(u, am, 2);
    const bm = blockWhileAssembling(S, inp, T);
    if (bm) sayOnceU(u, bm);
    const teleMax = teleLimit(T, S);
    if (inp.tele > 0 && S.Lb >= teleMax - 1e-6 && teleMax < T.boom.max) {
      sayOnceU(u, `Sin arriostramiento tensado la pluma solo llega a ${teleMax} m (Y)`);
    }
    const md = supportMode(S, T);
    // Como la referencia: los cortes usan el LMI estático; la carga cuenta solo si cuelga.
    // Tándem: la parte de la carga que lleva esta grúa (medida en Rapier).
    const mEval = hanging(u) ? mLoad : T.hookM;
    const noHoistUp = !!att && lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mLoad) >= 1;
    let hitMsg = '';
    u.cut = stepCrane(T, S, inp, dt, {
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
        if (why) sayOnceU(u, why);
        return !!why;
      } : undefined,
      // el plumín no atraviesa obstáculos, cargas sueltas ni el suelo; la torre y su pluma tampoco
      jibHit: T.jibDef || T.tower ? (s) => {
        const r = T.tower ? phys.towerHits(s, u.pose) : phys.jibHits(s, u.pose);
        if (r.n) hitMsg = r.what;
        return r.n;
      } : undefined,
      // el plumín o la torre tocarían algo: en un nivel cuenta como golpe (strike de la referencia)
      onHit: () => { if (L) bump(hitMsg); else sayOnceU(u, hitMsg); },
    });
    C.jibRel = S.jibRel;
    // radio del superlift (K/L), con el guard del LMI y sin chocar
    if (T.superlift && inp.sl) {
      const why = stepSuperlift(T, C, inp.sl, inp.fine, dt, {
        lmi: () => (bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval)),
        L0: bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
        hit: (r) => phys.trayBlocked(S.x, S.z, S.h, S.slew, r),
      });
      if (why === 'lmi') { u.cut = true; } else if (why) sayOnceU(u, why);
    }
    if (u.cut && !u.cutMsg) {
      sayU(u, noHoistUp && inp.hoist < 0 ? 'LMI: la carga supera la capacidad en esta posición'
        : 'LMI: movimiento cortado · solo se permiten los que reducen el momento');
    }
    u.cutMsg = u.cut;
    stepOutriggers(T, S, dt);
    u.pose = carrierPose(T, S, supportMode(S, T));
  }

  /** Después del paso de física: estabilidad con la tensión real, inclinación y vuelco de una grúa. */
  function afterUnit(u: Unit, dt: number) {
    const { T, S, C, phys } = u;
    if (tipped(u)) {
      u.pose = phys.tippedPose()!;
      if (u.tipClock >= 0 && (u.tipClock += dt) >= CARD_DELAY) {
        // en un nivel, el cartel de nivel fallido (Repetir vuelve a la ficha); en la prueba libre, Reiniciar
        if (L) finish({ title: 'La grúa volcó', text: u.tipText }); else hud.showTipped(multi ? `${T.name}: ${u.tipText}` : u.tipText);
        u.tipClock = -1;
      }
      return;
    }
    if (phys.twoBlocked()) sayOnceU(u, 'Gancho contra la cabeza de la pluma (doble bloqueo)');
    // ángulo del cable con la vertical (tiro lateral del tándem)
    u.sideAng = cableAngle(phys.headWorld(), phys.hookTop());
    // Estabilidad con la tensión real del cable: un balanceo o un tirón también cuentan.
    const md = supportMode(S, T);
    u.dyn = dynamicStability(T, C, S, md, phys.tension, worldToCarrier(S, phys.gp));
    if (hanging(u)) run.maxLmi = Math.max(run.maxLmi, u.dyn.lmi); // LMI máximo con la carga colgada (maxLmi de la referencia)
    if (stepTilt(S, u.dyn, dt)) {
      const { p, axis } = edgeAxis(T, md, S.edge);
      const f = carrierFrame(S); // la arista viene en el marco del chasis
      phys.tipOver(C, S, md, u.pose, apply(f, p), rotate(f.q, axis));
      S.vd = 0;
      u.cut = false;
      u.tipClock = 0;
      u.tipText = `El momento de vuelco superó la estabilidad (${Math.round(u.dyn.u * 100)} %). ` +
        (md === 'tire' || md === 'move' ? 'Sobre neumáticos la capacidad es mucho menor: despliega los estabilizadores (O). ' : '') +
        'Reduce el radio y evita que la carga se balancee hacia fuera.';
      sayU(u, '¡La grúa vuelca!', CARD_DELAY);
    }
  }

  /** Un paso fijo de la lógica de las grúas y de la física. */
  function tick(dt: number) {
    if (!running) return; // ficha, menú o cartel abiertos: todo quieto
    if (L) {
      const { phys } = units[0];
      run.t += dt;
      if (L.time && run.t > L.time) {
        finish({ title: 'Se acabó el tiempo', text: 'No terminaste la descarga a tiempo. Busca una posición desde la que alcances ambos camiones y la zona sin volver a moverte.' });
        return;
      }
      // checkWin: cada 0,25 s, sin nada enganchado, todas las cargas sueltas y quietas en una zona
      if ((winCheck += dt) >= 0.25 && !tipped(units[0])) {
        winCheck = 0;
        if (units.every((u) => !u.phys.attached) && allPlaced(phys.loads.map((l) => phys.placed(l)), L.zones)) { finish(null); return; }
      }
      run.bumpCd = Math.max(0, run.bumpCd - dt);
      // viento sobre la carga enganchada o el gancho (step de la referencia); tándem: lo pone una sola grúa
      for (const u of units) {
        const a = u.phys.attached;
        const w = windForce(L, run.t, windArea(a ? { w: 2 * a.half.x, d: 2 * a.half.z, h: 2 * a.half.y } : null));
        run.wind = w.v;
        u.phys.wind = { x: w.x, z: w.z };
      }
    }
    for (const u of units) controlUnit(u, dt, u === act);
    if (multi) Physics.stepCrew(units.map((u) => ({ phys: u.phys, S: u.S, pose: u.pose, slR: u.C.slR })));
    else act.phys.step(act.S, act.pose, act.C.slR);
    if (L) { if (levelRules()) return; } else for (const u of units) u.phys.events.length = 0;
    for (const u of units) afterUnit(u, dt);
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
    for (const u of units) {
      u.crane.update(u.S, u.pose, u.C.slR);
      u.rig.update(u.crane.lateral(_lat));
    }
    cam.update(dt, act.S, act.pose);
    ctx.renderer.render(ctx.scene, ctx.camera);
    const t2 = performance.now();

    const { T, S, C, phys } = act;
    const md = supportMode(S, T);
    const att = phys.attached;
    const share = phys.slingShare();
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
    const f1 = (v: number) => v.toFixed(1).replace('.', ',');
    hud.readout({
      Lb: S.Lb,
      angDeg: (S.ang * 180) / Math.PI,
      radius: Math.max(0, reach(T, C, S.Lb, S.ang)),
      headH: hp.y,
      cable: S.cable,
      // tándem: la parte de la carga que lleva esta grúa
      load: att ? (share !== null ? `${att.label} ${phys.attachedLug === 0 ? '(cabeza)' : '(pie)'} ${f1(share)} de ${f1(att.mass)} t`
        : `${att.label} ${f1(att.mass)} t`) : 'libre',
      fine: input.state().fine,
      lmi: act.dyn.lmi,
      rated: ratedCap(T, C, md, S.Lb, S.ang, S.slew),
      mHook: T.hookM + loadOnHook(act),
      mode: S.out > 0 && S.out < 1 ? (S.outT ? 'desplegando estabilizadores…' : 'recogiendo estabilizadores…') : MODE_TEXT[md],
      tension: phys.tension,
      cut: act.cut,
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
      side: share !== null ? { deg: (act.sideAng * 180) / Math.PI, max: 6 } : null,
    });
    const o = multi ? units.find((u) => u !== act)! : null;
    hud.other(o ? { name: o.T.name, lmi: o.dyn.lmi, tension: o.phys.tension, share: o.phys.slingShare(), tiltDeg: (o.S.phi * 180) / Math.PI, tipped: tipped(o),
      sideDeg: o.phys.slingShare() !== null ? (o.sideAng * 180) / Math.PI : null } : null);
  }
  requestAnimationFrame(frame);

  // Acceso para depurar desde la consola del navegador
  // advance(s): avanza la simulación s segundos sin depender de requestAnimationFrame (pruebas con la pestaña oculta)
  // S, C, T, phys, crane, dyn, pose y cut son los de la grúa que se maneja; units, todas.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __gruas: {
        ctx, input, hud, cam, L, lui, run, units,
        get S() { return act.S; }, get C() { return act.C; }, get T() { return act.T; }, get phys() { return act.phys; },
        get crane() { return act.crane; }, get act() { return act; },
        /** empieza el turno sin pulsar el botón de la ficha */
        start() { lui.close(); running = true; },
        get running() { return running; },
        get dyn() { return act.dyn; }, get pose() { return act.pose; }, get cut() { return act.cut; },
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
