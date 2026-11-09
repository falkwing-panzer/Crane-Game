import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import './style.css';
import { CRANES, isCrawler, type CraneId, type WheeledSpec } from './crane/cranes';
import { WHEELED_IDS } from './render/models/layout';
import { initialState, stepCrane, stepOutriggers, type CraneState } from './crane/kinematics';
import { baseConfig, lmiStatic, ratedCap, reach } from './crane/stability';
import { dynamicStability, stepTilt, supportMode, toggleOutriggers, TILTED_PHI, type Dyn } from './crane/ops';
import { apply, carrierFrame, carrierPose, edgeAxis, rotate, worldToCarrier, type Pose } from './crane/pose';
import { stepDrive, stepSuspension } from './crane/drive';
import { blockWhileAssembling, outriggersLocked, stepAssembly, teleLimit, toggleBallast, toggleYGuy, yGuyPhase } from './crane/assembly';
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

/** Grúas del menú: las de ruedas (fase 4) y las de orugas (fase 6) */
const MENU_IDS: CraneId[] = [...WHEELED_IDS, 'crawler', 'lr'];

const MODE_TEXT = { out: 'estabilizadores', tire: 'neumáticos', move: 'en marcha', crawler: 'orugas', crawlMove: 'orugas en marcha' };

const _lat = new THREE.Vector3();

async function start() {
  await RAPIER.init();

  const ctx = createScene(document.getElementById('c') as HTMLCanvasElement);
  // Grúa elegida en el menú (?grua=id); por defecto la AT 60
  const q = new URLSearchParams(location.search).get('grua') as CraneId | null;
  const id: CraneId = q && MENU_IDS.includes(q) ? q : 'medium';
  const T = CRANES[id];
  const S: CraneState = initialState(T);
  const C = baseConfig(T);

  const crane = isCrawler(T) ? new CrawlerModel(T) : new CraneModel(T as WheeledSpec);
  ctx.scene.add(crane.root);
  let pose: Pose = carrierPose(T, S, supportMode(S, T));
  const phys = new Physics(T, S, pose);
  for (const o of TEST_OBSTACLES) phys.addObstacle(o);
  // carga pesada de prueba para la LR 3000 (hasta que lleguen los niveles)
  if (T.superlift) phys.addLoad(TEST_HEAVY.label, TEST_HEAVY.mass, TEST_HEAVY.half, TEST_HEAVY.pos);
  phys.softs.push(...TEST_SOFT);
  buildSite(ctx.scene, phys.obstacles, phys.softs);
  const rig = new Rigging(ctx.scene, phys, T);
  // escala de la cámara con el largo del chasis; las orugas, con su pluma de celosía larga, más lejos
  // (la LR 3000, con 108 m de pluma, unas 3 veces la distancia de la AT 60)
  const camSize = Math.max(isCrawler(T) ? Math.max(1.4, T.boom.max / 36) : 1, (T.len[1] - T.len[0]) / 12.3);
  // encuadre de sombras: lo que llega la pluma más tumbada (y la bandeja del superlift), al menos ±45 m
  const shadowHalf = Math.max(45, T.foot + T.boom.max * Math.cos(T.boom.angMin) + 6,
    T.superlift ? T.superlift.rMax + T.superlift.w / 2 + 4 : 0);
  const cam = new CameraRig(ctx, crane.cab, (s) => crane.eye(s), camSize, shadowHalf);
  const input = new Input();
  const hud = new Hud(document.getElementById('hud')!, T.name, id, MENU_IDS.map((k) => ({ id: k, name: CRANES[k].name })),
    { ballast: !!T.ballast, yguy: !!T.yguy, outriggers: !!T.out, tele: T.boom.max > T.boom.min, superlift: !!T.superlift });
  hud.onCrane = (k) => {
    const u = new URL(location.href);
    u.searchParams.set('grua', k);
    location.href = u.toString();
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

  input.onHook = () => { if (!tipped()) hud.say(phys.toggleHook()); };
  input.onReset = () => { if (!tipped()) hud.say(phys.resetLoads()); };
  input.onOutriggers = () => {
    if (!tipped()) hud.say(toggleOutriggers(T, C, S, { loadHanging: hanging(), padsBlocked: phys.padsBlocked(S), locked: outriggersLocked(S) }), 1.8);
  };
  input.onBallast = () => { if (!tipped()) hud.say(toggleBallast(T, S, { loadHanging: hanging() }), 1.8); };
  input.onYGuy = () => { if (!tipped()) hud.say(toggleYGuy(T, S, { loadHanging: hanging() }), 2.2); };
  input.onView = () => hud.say(cam.cycle(S, pose), 1.5);
  input.onBypass = () => {
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
  hud.say(T.superlift ? `${T.name} · K/L acercan o alejan el lastre superlift · la bandeja barre un círculo detrás · V cambia la cámara`
    : T.crawler ? `${T.name} · flechas para conducir (← → gira en el sitio) · puede llevar la carga colgada · V cambia la cámara`
    : `${T.name} · flechas para conducir · O despliega los estabilizadores · V cambia la cámara`, 4);

  /** Un paso fijo de la lógica de la grúa y de la física. */
  function tick(dt: number) {
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
      if (dr.msg) hud.sayOnce(dr.msg);
      stepSuspension(T, S, (S.vd - v0) / dt, dt);
      // Montajes (lastre, Y-guy): avanzan y, mientras tanto, la grúa no se mueve
      const am = stepAssembly(T, S, C, dt);
      if (am) hud.say(am, 2);
      const bm = blockWhileAssembling(S, inp);
      if (bm) hud.sayOnce(bm);
      const teleMax = teleLimit(T, S);
      if (inp.tele > 0 && S.Lb >= teleMax - 1e-6 && teleMax < T.boom.max) {
        hud.sayOnce(`Sin arriostramiento tensado la pluma solo llega a ${teleMax} m (Y)`);
      }
      const md = supportMode(S, T);
      // Como la referencia: los cortes usan el LMI estático; la carga cuenta solo si cuelga.
      const mEval = hanging() ? mLoad : T.hookM;
      const noHoistUp = !!att && lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mLoad) >= 1;
      cut = stepCrane(T, S, inp, dt, {
        lmi: bypass ? () => 0 : (s) => lmiStatic(T, C, md, s.Lb, s.ang, s.slew, mEval),
        L0: lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
        noHoistUp: noHoistUp && !bypass,
        tilted: S.phi > TILTED_PHI, // la inclinación limita los movimientos aunque el LMI esté puenteado
        teleMax,
        // la bandeja del superlift no atraviesa obstáculos al girar (boomHit de la referencia)
        slewBlocked: T.superlift ? (s) => {
          const why = phys.trayBlocked(s.x, s.z, s.h, s.slew, C.slR);
          if (why) hud.sayOnce(why);
          return !!why;
        } : undefined,
      });
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
    if (tipped()) {
      pose = phys.tippedPose()!;
      if (tipClock >= 0 && (tipClock += dt) >= CARD_DELAY) { hud.showTipped(tipText); tipClock = -1; }
      return;
    }

    // Estabilidad con la tensión real del cable: un balanceo o un tirón también cuentan.
    const md = supportMode(S, T);
    dyn = dynamicStability(T, C, S, md, phys.tension, worldToCarrier(S, phys.gp));
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
    });
  }
  requestAnimationFrame(frame);

  // Acceso para depurar desde la consola del navegador
  // advance(s): avanza la simulación s segundos sin depender de requestAnimationFrame (pruebas con la pestaña oculta)
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __gruas: {
        S, C, T, phys, ctx, input, hud, cam, crane,
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
