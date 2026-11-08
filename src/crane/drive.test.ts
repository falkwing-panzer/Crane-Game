import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AT60 } from './cranes';
import { initialState, headPos } from './kinematics';
import { baseConfig, lmiStatic, ratedCap } from './stability';
import { supportMode, toggleOutriggers } from './ops';
import { axleSteer, CARRY_SPEED, minTurnRadius, stepDrive, stepSuspension, type DriveCtx } from './drive';
import { apply, carrierPose, worldToCarrier } from './pose';
import { Physics, FIXED_DT } from '../physics/world';

const D = Math.PI / 180;
const T = AT60;
const C = baseConfig(T);
const dt = 1 / 60;
const free: DriveCtx = { loadHanging: false, lmiMove: 0, tilted: false };
const run = (S: ReturnType<typeof initialState>, s: number, throttle: number, steer: number, ctx = free) => {
  let last = null;
  for (let i = 0; i < Math.round(s / dt); i++) last = stepDrive(T, S, { throttle, steer, fine: false }, dt, ctx);
  return last!;
};

describe('conducción (step() de la referencia)', () => {
  it('acelera a 1,2 m/s² hasta spd.drive y frena a 2,4 m/s²', () => {
    const S = initialState(T);
    run(S, 1, 1, 0);
    expect(S.vd).toBeCloseTo(1.2, 2);
    run(S, 5, 1, 0);
    expect(S.vd).toBeCloseTo(T.spd.drive, 6);
    expect(S.x).toBeGreaterThan(10);
    expect(S.z).toBeCloseTo(0, 9);
    expect(supportMode(S)).toBe('move');
    run(S, 0.5, 0, 0);
    expect(S.vd).toBeCloseTo(T.spd.drive - 1.2, 2);
    run(S, 2, 0, 0);
    expect(S.vd).toBe(0);
    expect(supportMode(S)).toBe('tire');
  });

  it('radio de giro = wheelbase / (2·tan steerMax) con dirección en todos los ejes; ← gira a la izquierda', () => {
    expect(minTurnRadius(T)).toBeCloseTo(T.wheelbase! / (2 * Math.tan(T.steerMax!)), 9);
    const S = initialState(T);
    run(S, 2, 0, 1); // girar el volante a tope parado (0,8 rad/s)
    expect(S.steer).toBeCloseTo(T.steerMax!, 6);
    expect(S.x).toBe(0);
    // una vuelta completa a velocidad baja: vuelve al punto de partida pasando por la izquierda (−z)
    const R = minTurnRadius(T);
    let minZ = 0;
    for (let i = 0; i < 3000 && S.h < 2 * Math.PI; i++) { stepDrive(T, S, { throttle: 1, steer: 1, fine: true }, dt, free); minZ = Math.min(minZ, S.z); }
    expect(minZ).toBeCloseTo(-2 * R, 1);
    expect(Math.hypot(S.x, S.z)).toBeLessThan(0.2);
  });

  it('las ruedas siguen el reparto de la referencia', () => {
    const st = 20 * D;
    expect(axleSteer(T, 3.4, st)).toBeCloseTo(st); // delantero
    expect(axleSteer(T, -2.45, st)).toBeCloseTo(-st * (2.45 / 4) * 0.8); // traseros en contrafase
    expect(axleSteer(T, -4.0, st)).toBeCloseTo(-st * 0.8);
  });

  it('no conduce con los estabilizadores fuera ni con la grúa inclinada', () => {
    const S = initialState(T);
    S.out = 0.2;
    expect(run(S, 1, 1, 0).msg).toMatch(/Recoge los estabilizadores/);
    expect(S.vd).toBe(0);
    const R = initialState(T);
    run(R, 1, 1, 0, { ...free, tilted: true });
    expect(R.vd).toBe(0);
  });

  it('pick & carry: con carga colgando va al 30 % y el LMI en "move" puede impedirlo', () => {
    const S = initialState(T);
    run(S, 6, 1, 0, { ...free, loadHanging: true });
    expect(S.vd).toBeCloseTo(T.spd.drive * CARRY_SPEED, 6);
    const B = initialState(T);
    const r = run(B, 1, 1, 0, { ...free, loadHanging: true, lmiMove: 1.05 });
    expect(r.lmiCut).toBe(true);
    expect(B.vd).toBe(0);
    // en marcha la capacidad (KF 0,45) es menor que parada sobre neumáticos (KF 0,66)
    expect(ratedCap(T, C, 'move', 20, 40 * D, 0)).toBeLessThan(ratedCap(T, C, 'tire', 20, 40 * D, 0));
    expect(lmiStatic(T, C, 'move', 20, 40 * D, 0, 3)).toBeGreaterThan(lmiStatic(T, C, 'tire', 20, 40 * D, 0, 3));
  });

  it('no despliega los estabilizadores en marcha', () => {
    const S = initialState(T);
    run(S, 1, 1, 0);
    expect(toggleOutriggers(T, C, S, { loadHanging: false })).toMatch(/Detén la grúa/);
    expect(S.outT).toBe(0);
  });

  it('la suspensión cabecea al frenar y se balancea hacia fuera en las curvas, con tope de 1°', () => {
    const S = initialState(T);
    let maxBank = 0;
    for (let i = 0; i < 240; i++) {
      const v0 = S.vd;
      stepDrive(T, S, { throttle: 1, steer: 1, fine: false }, dt, free);
      stepSuspension(T, S, (S.vd - v0) / dt, dt);
      maxBank = Math.max(maxBank, S.sus.bank);
    }
    expect(maxBank).toBeGreaterThan(0.2 * D); // curva a la izquierda: se inclina a la derecha (+)
    expect(Math.abs(S.sus.bank)).toBeLessThan(1.3 * D);
    let minPitch = 0;
    for (let i = 0; i < 120; i++) {
      const v0 = S.vd;
      stepDrive(T, S, { throttle: 0, steer: 0, fine: false }, dt, free);
      stepSuspension(T, S, (S.vd - v0) / dt, dt);
      minPitch = Math.min(minPitch, S.sus.pitch);
    }
    expect(minPitch).toBeLessThan(-0.3 * D); // al frenar baja el morro
  });

  it('la pose sigue la posición y el rumbo; worldToCarrier es su inversa', () => {
    const S = initialState(T);
    S.x = 12; S.z = -4; S.h = 70 * D;
    const P = carrierPose(T, S, 'tire');
    const p = apply(P, { x: 3, y: 0, z: 1 });
    const back = worldToCarrier(S, p);
    expect(back.x).toBeCloseTo(3, 9); expect(back.z).toBeCloseTo(1, 9);
    const f = apply(P, { x: 1, y: 0, z: 0 });
    expect(f.x - S.x).toBeCloseTo(Math.cos(S.h), 9); expect(f.z - S.z).toBeCloseTo(-Math.sin(S.h), 9);
  });
});

describe('física: choques y carga en marcha', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('el chasis se detiene contra un obstáculo y respeta el límite de la obra', () => {
    const S = initialState(T);
    const P = new Physics(T, S, carrierPose(T, S, 'tire'));
    P.addObstacle({ label: 'Bloque', kind: 'block', half: { x: 0.6, y: 0.6, z: 1.2 }, pos: { x: 20, y: 0.6, z: 0 }, rotY: 0 });
    P.addObstacle({ label: 'Bajo', kind: 'block', half: { x: 0.5, y: 0.1, z: 3 }, pos: { x: 10, y: 0.1, z: 0 }, rotY: 0 }); // bordillo
    P.step(S, carrierPose(T, S, 'tire'));
    const ctx: DriveCtx = { ...free, blocked: (x, z, h) => P.carrierBlocked(x, z, h) };
    let msg = '';
    for (let i = 0; i < 60 * 15; i++) {
      const r = stepDrive(T, S, { throttle: 1, steer: 0, fine: false }, dt, ctx);
      if (r.msg) msg = r.msg;
      P.step(S, carrierPose(T, S, supportMode(S)));
    }
    expect(msg).toMatch(/obstáculo/);
    // frente del chasis (x = 6,3) a menos de un paso del bloque (cara en x = 19,4); el bordillo bajo no frena
    expect(S.x + T.len[1]).toBeGreaterThan(19.3);
    expect(S.x + T.len[1]).toBeLessThan(19.41);
    expect(P.carrierBlocked(300, 0, 0)).toMatch(/Límite/);
    // las zapatas no se pueden abrir con un obstáculo debajo
    S.x = 30; S.z = 0;
    P.addObstacle({ label: 'Bloque', kind: 'block', half: { x: 0.5, y: 0.5, z: 0.5 }, pos: { x: 30 + T.out.xf, y: 0.5, z: T.out.hw }, rotY: 0 });
    P.step(S, carrierPose(T, S, 'tire'));
    expect(P.padsBlocked(S)).toMatch(/obstáculo/);
  });

  it('con la carga colgando, una curva cerrada sube la tensión y el LMI dinámico', async () => {
    const { dynamicStability } = await import('./ops');
    const S = initialState(T);
    S.Lb = 20; S.ang = 40 * D;
    // carga de 2 t en el suelo bajo la cabeza, gancho bajado hasta quedar 0,5 m por encima
    const hp = apply(carrierPose(T, S, 'tire'), headPos(T, S));
    S.cable = hp.y - 0.8 - 0.5 - 1.0;
    const P = new Physics(T, S, carrierPose(T, S, 'tire'));
    const L = P.addLoad('Prueba', 2, { x: 0.5, y: 0.4, z: 0.5 }, { x: hp.x, y: 0.4, z: hp.z });
    for (let i = 0; i < 90; i++) P.step(S, carrierPose(T, S, 'tire'));
    expect(P.toggleHook()).toMatch(/Enganchada/);
    // izar 4 m despacio y dejar que se calme
    for (let i = 0; i < 400; i++) { S.cable = Math.max(S.cable - 0.01, hp.y - 0.8 - 0.5 - 1.0 - 4); P.step(S, carrierPose(T, S, 'tire')); }
    for (let i = 0; i < 240; i++) P.step(S, carrierPose(T, S, 'tire'));
    const calm = P.tension;
    expect(calm).toBeCloseTo(T.hookM + L.mass, 1);
    let peakT = 0, peakLmi = 0;
    const lmi0 = dynamicStability(T, C, S, 'move', calm, worldToCarrier(S, P.gp)).lmi;
    for (let i = 0; i < 60 * 8; i++) {
      stepDrive(T, S, { throttle: 1, steer: i > 120 ? 1 : 0, fine: false }, dt, { ...free, loadHanging: true });
      P.step(S, carrierPose(T, S, supportMode(S)));
      peakT = Math.max(peakT, P.tension);
      peakLmi = Math.max(peakLmi, dynamicStability(T, C, S, supportMode(S), P.tension, worldToCarrier(S, P.gp)).lmi);
    }
    expect(peakT).toBeGreaterThan(calm * 1.01);
    expect(peakLmi).toBeGreaterThan(lmi0 * 1.03);
    void FIXED_DT;
  });
});
