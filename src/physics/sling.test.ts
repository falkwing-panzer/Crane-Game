import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES, type CraneSpec } from '../crane/cranes';
import { headPos, initialState, stepCrane, type CraneInput } from '../crane/kinematics';
import { apply, carrierPose } from '../crane/pose';
import { Physics, FIXED_DT, HOOK_HALF_H, rigPlan, BEAM_DROP, GUIDE_RATE } from './world';

// Fase 26: aparejos. Medidas del cable (estiramiento y tensión al izar a velocidad plena) con cargas de 2 a 800 t,
// como en las fases 2 y 6B; se miden antes y después de la eslinga de 4 ramales.

const D = Math.PI / 180;
const idle: CraneInput = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false };

beforeAll(async () => { await RAPIER.init(); });

/** Engancha una carga bajo la cabeza, la iza 12 s a fondo y mide */
export function liftRun(T: CraneSpec, mass: number, half: { x: number; y: number; z: number }, ang = 60 * D, Lb?: number) {
  const S = initialState(T);
  S.ang = ang;
  if (T.out) S.slew = Math.PI / 2; // de lado: lejos del chasis
  // pluma sacada lo justo para que la carga quede lejos del chasis (con 60° y la pluma recogida cae encima)
  if (!T.boom.lattice) S.Lb = Lb ?? Math.min(T.boom.max, 22);
  const md = T.out ? 'out' : 'crawler';
  if (T.out) { S.out = 1; S.outT = 1; }
  const pose = carrierPose(T, S, md);
  const hp = apply(pose, headPos(T, S));
  // gancho justo encima de la carga
  S.cable = hp.y - (2 * half.y + 0.3) - 2 * HOOK_HALF_H;
  const P = new Physics(T, S, pose);
  const L = P.addLoad('Pieza', mass, half, { x: hp.x, y: half.y, z: hp.z });
  for (let i = 0; i < 120; i++) P.step(S, pose);
  const msg = P.toggleHook();
  let stretch = 0, tMin = Infinity, tMax = 0, up = -1;
  // izar a fondo hasta 6 m de altura (o 15 s)
  for (let i = 0; i < 60 * 15 && L.body.translation().y - half.y < 6; i++) {
    stepCrane(T, S, { ...idle, hoist: -1 }, FIXED_DT);
    P.step(S, pose);
    const t = P.hookTop(), d = Math.hypot(t.x - hp.x, t.y - hp.y, t.z - hp.z);
    stretch = Math.max(stretch, d - S.cable);
    if (up < 0 && L.body.translation().y - half.y > 0.3) up = i;
    if (up >= 0 && i > up + 60) { tMin = Math.min(tMin, P.tension); tMax = Math.max(tMax, P.tension); }
  }
  for (let i = 0; i < 300; i++) P.step(S, pose);
  const q = L.body.rotation();
  return { msg, stretch, tMin, tMax, rest: P.tension, hookM: T.hookM, y: L.body.translation().y, tilt: 2 * Math.acos(Math.min(1, Math.abs(q.w))) / D, P, L, S, pose };
}

/* eslint-disable-next-line */
const CASES: [string, CraneSpec, number, { x: number; y: number; z: number }, number?][] = [
  ['AT 60, palé de 2 t', CRANES.medium, 2, { x: 0.6, y: 0.5, z: 0.6 }],
  ['AT 60, bloque de 15 t', CRANES.medium, 15, { x: 1.2, y: 0.8, z: 1.2 }],
  ['AT 500-8, 60 t', CRANES.xl, 60, { x: 2, y: 1.2, z: 2 }],
  ['LR 3000, 800 t', CRANES.lr, 800, { x: 3, y: 2.5, z: 3 }, 68 * D],
  ['AT 220, viga de 22 m y 12 t', CRANES.large, 12, { x: 11, y: 0.4, z: 0.3 }],
];

describe('Fase 26: cable con la eslinga (medidas)', () => {
  for (const [name, T, m, half, ang] of CASES) {
    it(name, () => {
      const r = liftRun(T, m, half, ang);
      const st = m + r.hookM;
      console.log(`${name}: estira ${(r.stretch * 100).toFixed(1)} cm, tensión ${(r.tMin / st * 100).toFixed(0)}–${(r.tMax / st * 100).toFixed(0)} %, en reposo ${(r.rest / st * 100).toFixed(1)} %, inclinación ${r.tilt.toFixed(2)}°`);
      expect(r.msg).toMatch(/Enganchad/);
      expect(r.y).toBeGreaterThan(half.y + 2);
      expect(r.stretch).toBeLessThan(0.08);
      expect(r.tMin).toBeGreaterThan(st * 0.8);
      expect(r.tMax).toBeLessThan(st * 1.2);
      expect(r.rest / st).toBeCloseTo(1, 1);
    });
  }
});

describe('Fase 26: aparejos', () => {
  it('carga corta: 4 ramales a 45° (el gancho cuelga a la distancia de los puntos de enganche)', () => {
    const half = { x: 1.2, y: 0.8, z: 1.2 };
    const plan = rigPlan(half, 15);
    expect(plan.beam).toBeNull();
    expect(plan.legs).toHaveLength(4);
    const r = liftRun(CRANES.medium, 15, half);
    expect(r.P.rig).toHaveLength(4);
    const hb = r.P.hookBody.translation().y - HOOK_HALF_H, top = r.L.body.translation().y + half.y;
    const span = Math.hypot(plan.legs[0].b.x, plan.legs[0].b.z);
    expect(hb - top).toBeGreaterThan(span - 0.1);
    expect(hb - top).toBeLessThan(span + 0.15);
  });

  it('carga larga: balancín a lo largo del lado mayor, con ramales casi verticales', () => {
    const half = { x: 11, y: 0.4, z: 0.3 };
    const plan = rigPlan(half, 12);
    expect(plan.beam).not.toBeNull();
    expect(plan.legs).toHaveLength(5);
    const r = liftRun(CRANES.large, 12, half);
    const b = r.P.beam!.translation(), l = r.L.body.translation();
    // el balancín cuelga sobre la carga, a la altura de los ramales
    expect(Math.hypot(b.x - l.x, b.z - l.z)).toBeLessThan(0.2);
    expect(b.y - (l.y + half.y)).toBeGreaterThan(BEAM_DROP * 0.9);
    expect(r.tilt).toBeLessThan(2);
    // al soltar desaparece
    for (let i = 0; i < 600 && !r.P.isResting(r.L); i++) { stepCrane(CRANES.large, r.S, { ...idle, hoist: 1 }, FIXED_DT); r.P.step(r.S, r.pose); }
    expect(r.P.toggleHook()).toMatch(/soltada/);
    expect(r.P.beam).toBeNull();
  });

  it('cuerdas guía: sin tocar nada la carga no gira; con la tecla gira a ~GUIDE_RATE', () => {
    const half = { x: 3, y: 0.6, z: 0.8 };
    const r = liftRun(CRANES.medium, 6, half);
    const yaw = () => { const q = r.L.body.rotation(); return 2 * Math.atan2(q.y, q.w); };
    const pose = r.pose;
    const y0 = yaw();
    for (let i = 0; i < 300; i++) r.P.step(r.S, pose);
    expect(Math.abs(yaw() - y0)).toBeLessThan(0.02);
    r.P.guide = 1;
    for (let i = 0; i < 300; i++) r.P.step(r.S, pose);
    const turned = yaw() - y0;
    expect(turned).toBeGreaterThan(GUIDE_RATE * 5 * 0.8);
    expect(turned).toBeLessThan(GUIDE_RATE * 5 * 1.1);
    r.P.guide = 0;
    for (let i = 0; i < 60; i++) r.P.step(r.S, pose);
    expect(Math.abs(r.L.body.angvel().y)).toBeLessThan(0.01);
  });

  it('la carga choca con la pluma empinada y cuenta como golpe; apoyada en la pluma, la tensión sigue siendo la carga', () => {
    const T = CRANES.medium, half = { x: 1.6, y: 0.8, z: 1.6 };
    const r = liftRun(T, 4, half, 78 * D);
    const pose = r.pose;
    r.P.events.length = 0;
    // subir hasta el doble bloqueo: con la pluma a 78° la caja de 3,2 m toca la pluma
    let hit = false;
    for (let i = 0; i < 60 * 20; i++) {
      stepCrane(T, r.S, { ...idle, hoist: -1 }, FIXED_DT);
      r.P.step(r.S, pose);
      if (r.P.events.some((e) => e.kind === 'strike')) hit = true;
    }
    expect(hit).toBe(true);
    for (let i = 0; i < 300; i++) r.P.step(r.S, pose);
    expect(r.P.tension).toBeGreaterThan((4 + T.hookM) * 0.9);
  });
});
