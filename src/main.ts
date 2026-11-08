import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { AT60 } from './crane/cranes';
import { initialState, stepCrane, headPos } from './crane/kinematics';
import { baseConfig, lmiStatic, ratedCap, reach, type SupportMode } from './crane/stability';
import { createScene } from './render/scene';
import { CraneModel } from './render/craneModel';
import { Rigging } from './render/rigging';
import { Physics, FIXED_DT } from './physics/world';
import { Input } from './ui/input';
import { Hud } from './ui/hud';

async function start() {
  await RAPIER.init();

  const ctx = createScene(document.getElementById('c') as HTMLCanvasElement);
  const T = AT60;
  const S = initialState(T);
  const C = baseConfig(T);
  // Fase 1: la AT 60 aún no tiene estabilizadores ni conducción → apoyo sobre neumáticos, parada (KF 0,66).
  const md: SupportMode = 'tire';

  const crane = new CraneModel(T);
  ctx.scene.add(crane.root);
  const phys = new Physics(T, S);
  const rig = new Rigging(ctx.scene, phys, T);
  const input = new Input();
  const hud = new Hud(document.getElementById('hud')!);
  input.onHook = () => hud.say(phys.toggleHook());
  hud.say('AT 60 sobre neumáticos · LMI activo (solo indica; los bloqueos llegan en la fase 2)', 4);

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
    const inp = input.state();
    let n = 0;
    while (acc >= FIXED_DT && n < MAX_STEPS) {
      stepCrane(T, S, inp, FIXED_DT);
      phys.step(S);
      acc -= FIXED_DT;
      n++;
    }
    if (n === MAX_STEPS) acc = 0; // si la máquina no da abasto, se ralentiza en vez de acumular
    const t1 = performance.now();

    crane.update(S);
    rig.update(S);
    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
    const t2 = performance.now();

    const hp = headPos(T, S);
    // LMI estático como en la referencia: la carga cuenta solo si cuelga (no si está apoyada).
    const att = phys.attached;
    const mHook = T.hookM + (att ? att.mass : 0);
    const mEval = att && !phys.isResting(att) ? mHook : T.hookM;
    const lmi = lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval);
    const rated = ratedCap(T, C, md, S.Lb, S.ang, S.slew);
    hud.frame(dt, t1 - t0, t2 - t1, ctx.renderer.info);
    hud.readout({
      Lb: S.Lb,
      angDeg: (S.ang * 180) / Math.PI,
      radius: Math.max(0, reach(T, C, S.Lb, S.ang)),
      headH: hp.y,
      cable: S.cable,
      load: phys.attached ? `${phys.attached.label} ${phys.attached.mass.toFixed(1).replace('.', ',')} t` : 'libre',
      fine: inp.fine,
      lmi, rated, mHook,
      mode: 'neumáticos',
    });
  }
  requestAnimationFrame(frame);

  // Acceso para depurar desde la consola del navegador
  if (import.meta.env.DEV) Object.assign(window, { __gruas: { S, C, phys, ctx } });
}

start().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:40%;left:20px;color:#b00">${String(err)}</pre>`);
});
