import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES, type CraneSpec } from './cranes';
import { headPos, initialState, type CraneState } from './kinematics';
import { stepDrive, stepSuspension, type DriveCtx } from './drive';
import { supportMode } from './ops';
import { apply, carrierPose, worldToCarrier } from './pose';
import { blockWhileTied, canTie, tieLug, tieReach } from './tiedown';
import { Physics, HOOK_HALF_H } from '../physics/world';
import { WHEELED_IDS } from '../render/models/layout';

// Amarre del gancho al frente del chasis (posición de transporte; no está en la referencia).

const dt = 1 / 60;
const free: DriveCtx = { loadHanging: false, lmiMove: 0, tilted: false };

/** Pluma tumbada hacia delante y el gancho subido hasta el doble bloqueo, junto al frente */
function transport(T: CraneSpec) {
  const S = initialState(T);
  S.ang = T.boom.angMin;
  S.cable = 0.5;
  const P = new Physics(T, S, carrierPose(T, S, 'tire'), { testLoad: false });
  for (let i = 0; i < 90; i++) P.step(S, carrierPose(T, S, 'tire'));
  return { S, P };
}

/** Conducir con curvas `secs` s; devuelve cuánto se aleja el gancho de su sitio respecto del chasis (m) */
function drive(T: CraneSpec, S: CraneState, P: Physics, secs: number) {
  const rel = () => {
    const h = P.hookBody.translation(), c = worldToCarrier(S, h);
    return { x: c.x, y: h.y, z: c.z };
  };
  const r0 = rel();
  let dev = 0;
  for (let i = 0; i < secs * 60; i++) {
    const v0 = S.vd;
    // acelera, gira a un lado y al otro y frena: la carga de un gancho libre se balancea
    const steer = i < 60 ? 0 : i < 180 ? 1 : i < 300 ? -1 : 0;
    stepDrive(T, S, { throttle: i < 360 ? 1 : -1, steer, fine: false }, dt, free);
    stepSuspension(T, S, (S.vd - v0) / dt, dt);
    P.step(S, carrierPose(T, S, supportMode(S, T)));
    const r = rel();
    dev = Math.max(dev, Math.hypot(r.x - r0.x, r.y - r0.y, r.z - r0.z));
  }
  return dev;
}

describe('amarre del gancho al frente', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('solo en las grúas de ruedas', () => {
    for (const id of WHEELED_IDS) expect(canTie(CRANES[id])).toBe(true);
    for (const id of ['crawler', 'lr', 'sk'] as const) expect(canTie(CRANES[id])).toBe(false);
  });

  it('cada grúa de ruedas amarra el gancho con la pluma tumbada y no se balancea al conducir', () => {
    for (const id of WHEELED_IDS) {
      const T = CRANES[id];
      const { S, P } = transport(T);
      expect(P.toggleHook(), id).toMatch(/amarrado/);
      expect(P.tied).toBe(true);
      // el fondo del gancho junto al gancho de remolque
      P.step(S, carrierPose(T, S, 'tire'));
      const lug = apply(carrierPose(T, S, 'tire'), tieLug(T)), hb = P.bodyPoint(P.hookBody, 0, -HOOK_HALF_H, 0);
      expect(Math.hypot(lug.x - hb.x, lug.y - hb.y, lug.z - hb.z), id).toBeLessThan(0.6);
      expect(drive(T, S, P, 8), id).toBeLessThan(0.15); // solo la suspensión lo mueve
      // la cabeza de la pluma no se ha movido respecto del chasis y el cable mide hasta el gancho
      const head = apply(carrierPose(T, S, supportMode(S, T)), headPos(T, S)), top = P.hookTop();
      expect(S.cable).toBeCloseTo(Math.hypot(top.x - head.x, top.y - head.y, top.z - head.z), 1);
    }
  }, 30000); // ocho grúas × 8 s de conducción

  it('sin amarrar, el mismo recorrido balancea el gancho', () => {
    const T = CRANES.medium;
    const { S, P } = transport(T);
    expect(drive(T, S, P, 8)).toBeGreaterThan(0.3);
  });

  it('al soltarlo vuelve a colgar del cable, sin saltos', () => {
    const T = CRANES.medium;
    const { S, P } = transport(T);
    P.toggleHook();
    drive(T, S, P, 3);
    expect(P.toggleHook()).toMatch(/suelto/);
    expect(P.tied).toBe(false);
    let vmax = 0;
    for (let i = 0; i < 120; i++) {
      P.step(S, carrierPose(T, S, supportMode(S, T)));
      const v = P.hookBody.linvel();
      vmax = Math.max(vmax, Math.hypot(v.x, v.y, v.z));
    }
    expect(vmax).toBeLessThan(2); // cae hasta tensar el cable que medía al soltarlo; no sale despedido
    expect(P.tension).toBeCloseTo(T.hookM, 0);
  });

  it('lejos del frente no se amarra', () => {
    const T = CRANES.medium;
    const S = initialState(T); // pluma a 40°, gancho a 4 m de la cabeza
    const P = new Physics(T, S, carrierPose(T, S, 'tire'), { testLoad: false });
    for (let i = 0; i < 60; i++) P.step(S, carrierPose(T, S, 'tire'));
    expect(P.toggleHook()).toMatch(/remolque/);
    expect(P.tied).toBe(false);
  });

  it('alcance: hasta 4 m en planta, a la altura del parachoques', () => {
    const lug = { x: 0, y: 0.7, z: 0 };
    expect(tieReach(lug, { x: 3.4, y: 1.0, z: 0 })).toBe(true); // RT 90: cabeza por delante del frente
    expect(tieReach(lug, { x: 4.5, y: 1.0, z: 0 })).toBe(false);
    expect(tieReach(lug, { x: 1, y: 2.5, z: 0 })).toBe(false); // demasiado alto
    expect(tieReach(lug, { x: 1, y: -0.5, z: 0 })).toBe(false); // gancho por debajo (en una zanja)
  });

  it('amarrado, la pluma y el cable no se mueven (conducir sí)', () => {
    const inp = { slew: 1, luff: -1, tele: 1, hoist: 1, jib: 0, fine: false };
    expect(blockWhileTied(inp as never)).toMatch(/amarrado/);
    expect([inp.slew, inp.luff, inp.tele, inp.hoist]).toEqual([0, 0, 0, 0]);
    const quiet = { slew: 0, luff: 0, tele: 0, hoist: 0, jib: 0, fine: false };
    expect(blockWhileTied(quiet as never)).toBeNull();
  });
});
