import type { CraneSpec } from './cranes';

export interface CraneState {
  /** Giro de la superestructura (rad). Positivo = antihorario visto desde arriba. */
  slew: number;
  /** Ángulo de la pluma sobre la horizontal (rad) */
  ang: number;
  /** Largo de pluma, del pie a la cabeza (m) */
  Lb: number;
  /** Largo de cable de la cabeza al gancho (m) */
  cable: number;
  /** Velocidades actuales (con rampa) */
  v: { slew: number; ang: number; Lb: number; cable: number };
}

export interface CraneInput {
  slew: number; // +1 izquierda (A), -1 derecha (D)
  luff: number; // +1 sube (W)
  tele: number; // +1 extiende (E)
  hoist: number; // +1 baja gancho (F), -1 sube (R)
  fine: boolean;
}

export const CABLE_MIN = 1.2;
export const CABLE_MAX = 70;
const RAMP = 0.4; // s para llegar a velocidad plena
const FINE = 0.3; // factor de mando fino (igual que la referencia)

export function initialState(T: CraneSpec): CraneState {
  return { slew: 0, ang: 40 * Math.PI / 180, Lb: T.boom.min, cable: 4, v: { slew: 0, ang: 0, Lb: 0, cable: 0 } };
}

function axis(cur: number, vel: number, cmd: number, vmax: number, lo: number, hi: number, dt: number) {
  const target = cmd * vmax;
  const acc = vmax / RAMP;
  vel += Math.max(-acc * dt, Math.min(acc * dt, target - vel));
  let next = cur + vel * dt;
  if (next <= lo) { next = lo; if (vel < 0) vel = 0; }
  if (next >= hi) { next = hi; if (vel > 0) vel = 0; }
  return [next, vel] as const;
}

export function stepCrane(T: CraneSpec, S: CraneState, inp: CraneInput, dt: number) {
  const k = inp.fine ? FINE : 1;
  [S.slew, S.v.slew] = axis(S.slew, S.v.slew, inp.slew, T.spd.slew * k, -Infinity, Infinity, dt);
  [S.ang, S.v.ang] = axis(S.ang, S.v.ang, inp.luff, T.spd.luff * k, T.boom.angMin, T.boom.angMax, dt);
  [S.Lb, S.v.Lb] = axis(S.Lb, S.v.Lb, inp.tele, T.spd.tele * k, T.boom.min, T.boom.max, dt);
  [S.cable, S.v.cable] = axis(S.cable, S.v.cable, inp.hoist, T.spd.hoist * k, CABLE_MIN, CABLE_MAX, dt);
}

/** Distancia horizontal del centro de giro a la cabeza (como reach() de la referencia, sin plumín). */
export function headReach(T: CraneSpec, S: Pick<CraneState, 'ang' | 'Lb'>) {
  return T.foot + S.Lb * Math.cos(S.ang);
}

/** Posición de la cabeza de pluma en coordenadas del mundo (y arriba; chasis a lo largo de +x). */
export function headPos(T: CraneSpec, S: Pick<CraneState, 'slew' | 'ang' | 'Lb'>) {
  const r = headReach(T, S);
  return {
    x: T.piv + r * Math.cos(S.slew),
    y: T.pivH + S.Lb * Math.sin(S.ang),
    z: -r * Math.sin(S.slew),
  };
}
