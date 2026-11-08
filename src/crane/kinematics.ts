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
  /** Estabilizadores: avance 0 (recogidos) … 1 (apoyados) y objetivo (outS / outT de la referencia) */
  out: number;
  outT: 0 | 1;
  /** Inclinación incipiente al vuelco (rad) y su velocidad (phi / phiV de la referencia) */
  phi: number;
  phiV: number;
  /** Arista de vuelco mientras phi > 0 (índice de tipEdge), −1 si no hay */
  edge: number;
}

export interface CraneInput {
  slew: number; // +1 izquierda (A), -1 derecha (D)
  luff: number; // +1 sube (W)
  tele: number; // +1 extiende (E)
  hoist: number; // +1 baja gancho (F), -1 sube (R)
  fine: boolean;
}

/** Límites que impone el LMI en un paso (ver guard en step() de la referencia). */
export interface StepLimits {
  /** LMI estático con el estado actual de S */
  lmi: (S: CraneState) => number;
  /** LMI al empezar el paso: se permite cualquier movimiento que no lo haga subir por encima de 1 */
  L0: number;
  /** No dejar subir la carga (la carga enganchada supera la capacidad aquí) */
  noHoistUp: boolean;
  /** Grúa inclinada (phi > 0): solo se permiten movimientos que la recuperan */
  tilted: boolean;
}

export const CABLE_MIN = 1.2;
export const CABLE_MAX = 70;
const RAMP = 0.4; // s para llegar a velocidad plena
const FINE = 0.3; // factor de mando fino (igual que la referencia)
/** Lo que se levanta el chasis con los estabilizadores apoyados (lift() de la referencia) */
export const OUT_LIFT = 0.3;

export function initialState(T: CraneSpec): CraneState {
  return {
    slew: 0, ang: 40 * Math.PI / 180, Lb: T.boom.min, cable: 4, v: { slew: 0, ang: 0, Lb: 0, cable: 0 },
    out: 0, outT: 0, phi: 0, phiV: 0, edge: -1,
  };
}

function ramp(vel: number, cmd: number, vmax: number, dt: number) {
  const acc = vmax / RAMP;
  return vel + Math.max(-acc * dt, Math.min(acc * dt, cmd * vmax - vel));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Un paso de los mandos de la grúa. Con `lim`, cada movimiento que deja el LMI en 100 % o más y además
 * lo aumenta se deshace y su velocidad queda en 0 (guard de la referencia). Devuelve true si hubo corte.
 */
export function stepCrane(T: CraneSpec, S: CraneState, inp: CraneInput, dt: number, lim?: StepLimits): boolean {
  const k = inp.fine ? FINE : 1;
  let cut = false;
  const guard = (apply: () => void, undo: () => void) => {
    apply();
    if (!lim) return true;
    const n = lim.lmi(S);
    if (n >= 1 && n > lim.L0 + 1e-6) { undo(); cut = true; return false; }
    return true;
  };

  // giro
  S.v.slew = ramp(S.v.slew, inp.slew, T.spd.slew * k, dt);
  if (lim?.tilted) S.v.slew *= 0.9;
  if (S.v.slew) {
    const o = S.slew;
    if (!guard(() => { S.slew += S.v.slew * dt; }, () => { S.slew = o; })) S.v.slew = 0;
  }
  // pluma (inclinada: solo subir)
  S.v.ang = ramp(S.v.ang, inp.luff, T.spd.luff * k, dt);
  if (lim?.tilted) S.v.ang = Math.max(0, S.v.ang);
  if (S.v.ang) {
    const o = S.ang;
    if (!guard(() => { S.ang = clamp(S.ang + S.v.ang * dt, T.boom.angMin, T.boom.angMax); }, () => { S.ang = o; })) S.v.ang = 0;
    if (S.ang === T.boom.angMin || S.ang === T.boom.angMax) S.v.ang = 0;
  }
  // telescopio (inclinada: solo recoger)
  S.v.Lb = ramp(S.v.Lb, inp.tele, T.spd.tele * k, dt);
  if (lim?.tilted) S.v.Lb = Math.min(0, S.v.Lb);
  if (S.v.Lb) {
    const o = S.Lb;
    if (!guard(() => { S.Lb = clamp(S.Lb + S.v.Lb * dt, T.boom.min, T.boom.max); }, () => { S.Lb = o; })) S.v.Lb = 0;
    if (S.Lb === T.boom.min || S.Lb === T.boom.max) S.v.Lb = 0;
  }
  // cable: subir la carga (hoist < 0) se corta si la carga supera la capacidad
  let hoist = inp.hoist;
  if (hoist < 0 && lim?.noHoistUp) { hoist = 0; S.v.cable = Math.max(0, S.v.cable); cut = true; }
  S.v.cable = ramp(S.v.cable, hoist, T.spd.hoist * k, dt);
  S.cable += S.v.cable * dt;
  if (S.cable <= CABLE_MIN) { S.cable = CABLE_MIN; if (S.v.cable < 0) S.v.cable = 0; }
  if (S.cable >= CABLE_MAX) { S.cable = CABLE_MAX; if (S.v.cable > 0) S.v.cable = 0; }
  return cut;
}

/** Avance de los estabilizadores hacia su objetivo en T.out.t segundos (como la referencia). */
export function stepOutriggers(T: CraneSpec, S: CraneState, dt: number) {
  const t = T.out?.t ?? 1;
  S.out += clamp(S.outT - S.out, -dt / t, dt / t);
}

/** Altura que se levanta el chasis: empieza cuando los gatos tocan el suelo (outS > 0,5). */
export function carrierLift(S: Pick<CraneState, 'out'>) {
  return S.out > 0.5 ? ((S.out - 0.5) / 0.5) * OUT_LIFT : 0;
}

/** Distancia horizontal del centro de giro a la cabeza (como reach() de la referencia, sin plumín). */
export function headReach(T: CraneSpec, S: Pick<CraneState, 'ang' | 'Lb'>) {
  return T.foot + S.Lb * Math.cos(S.ang);
}

/**
 * Posición de la cabeza de pluma en el marco del chasis apoyado en el suelo (y arriba; chasis a lo largo de +x).
 * La elevación por estabilizadores y la inclinación se aplican después con carrierPose().
 */
export function headPos(T: CraneSpec, S: Pick<CraneState, 'slew' | 'ang' | 'Lb'>) {
  const r = headReach(T, S);
  return {
    x: T.piv + r * Math.cos(S.slew),
    y: T.pivH + S.Lb * Math.sin(S.ang),
    z: -r * Math.sin(S.slew),
  };
}
