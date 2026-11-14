// Fase 18: el chasis sobre el terreno. La referencia es plana; esto es aproximación del juego.
//
// Se toman las alturas del suelo bajo cada rueda (cada eje, a cada lado) o a lo largo de cada oruga, se ajusta un
// plano por mínimos cuadrados en el marco del chasis y se sube lo justo para que ningún apoyo quede enterrado.
// Ese plano da la altura del origen del chasis y su inclinación (pendiente hacia delante y hacia la derecha).

import type { CraneSpec } from './cranes';

export interface GroundFit {
  /** Altura del origen del chasis (m) */
  y: number;
  /** Pendiente del plano en el marco del chasis: dy/dx (+ = sube hacia delante) y dy/dz (+ = sube hacia la derecha, +z) */
  b: number;
  c: number;
  /** Pendiente máxima del plano (rad) */
  slope: number;
  /** Diferencia entre el apoyo más alto y el más bajo respecto del plano (m): lo irregular que es el suelo */
  spread: number;
}

/** Pendiente máxima para conducir (aproximación del juego; la referencia no tiene pendientes) */
export const MAX_SLOPE = { wheels: (15 * Math.PI) / 180, tracks: (20 * Math.PI) / 180 };
/** Suelo demasiado irregular bajo el chasis (m fuera del plano; una oruga rígida que pasa la cresta de 18° llega a ~0,7) */
export const MAX_SPREAD = 1;
/** Pendiente a partir de la cual no se apoyan los estabilizadores (≈ 1°; la nivelación llega en la parte B) */
export const PAD_SLOPE = Math.PI / 180;

export const FLAT: GroundFit = { y: 0, b: 0, c: 0, slope: 0, spread: 0 };

/** Puntos de apoyo en el marco del chasis (x adelante, z derecha) */
export function supportPoints(T: CraneSpec): [number, number][] {
  if (T.crawler && T.track) {
    const { xf, xr, hw } = T.track, zc = hw - (T.trackW ?? 1) / 2;
    const xs = [xr, (xr + xf) / 2, xf];
    return [...xs.map((x): [number, number] => [x, -zc]), ...xs.map((x): [number, number] => [x, zc])];
  }
  const hw = T.tire?.hw ?? T.half;
  const ax = T.axles ?? [T.len[0] + 1, T.len[1] - 1];
  return [...ax.map((x): [number, number] => [x, -hw]), ...ax.map((x): [number, number] => [x, hw])];
}

/** Plano del suelo bajo el chasis en (x, z) con rumbo h (convenios de pose.ts: avance (cos h, −sin h)) */
export function groundFit(T: CraneSpec, height: (x: number, z: number) => number, x: number, z: number, h: number): GroundFit {
  const pts = supportPoints(T), c = Math.cos(h), s = Math.sin(h);
  const ys = pts.map(([lx, lz]) => height(x + c * lx + s * lz, z - s * lx + c * lz));
  if (ys.every((y) => y === 0)) return FLAT;
  // mínimos cuadrados y = a + b·x + c·z (ecuaciones normales 3 × 3)
  let n = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sy = 0, sxy = 0, szy = 0;
  pts.forEach(([px, pz], i) => {
    const y = ys[i];
    n++; sx += px; sz += pz; sxx += px * px; szz += pz * pz; sxz += px * pz; sy += y; sxy += px * y; szy += pz * y;
  });
  const [a, b, cc] = solve3([[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]], [sy, sxy, szy]);
  let hi = -Infinity, lo = Infinity;
  pts.forEach(([px, pz], i) => { const r = ys[i] - (a + b * px + cc * pz); hi = Math.max(hi, r); lo = Math.min(lo, r); });
  return { y: a + hi, b, c: cc, slope: Math.atan(Math.hypot(b, cc)), spread: hi - lo };
}

function solve3(A: number[][], v: number[]): [number, number, number] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const col = (k: number) => A.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

/** Pendiente máxima para conducir esta grúa */
export const maxSlope = (T: CraneSpec) => (T.crawler ? MAX_SLOPE.tracks : MAX_SLOPE.wheels);
