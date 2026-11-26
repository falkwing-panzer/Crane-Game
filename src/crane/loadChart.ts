import type { CraneSpec } from './cranes';
import { ratedCap, reach, type CraneConfig, type SupportMode } from './stability';

// Tabla de cargas (fase 20; no está en la referencia): ratedCap por radio y largo de pluma para la configuración
// actual, como las tablas de un operador real. Solo usa el modelo de estabilidad que ya existe (ratedCap, reach):
// cada casilla es exactamente la capacidad que daría el LMI en ese punto. Sin three.js ni DOM.

const D = Math.PI / 180;

/** Giros con los que se busca el peor caso de la tabla de 360° (el apoyo es simétrico a los lados: 0…180°) */
export const SLEW_SAMPLES = Array.from({ length: 19 }, (_, i) => i * 10 * D);

/**
 * Ángulo de la pluma que da el radio R con el largo Lb (inversa de reach), o null si no se llega dentro de
 * angMin…angMax. Sin plumín es exacta; con plumín, por bisección (reach baja al subir la pluma en todo el recorrido).
 */
export function angleFor(T: CraneSpec, C: CraneConfig, Lb: number, R: number): number | null {
  const { angMin, angMax } = T.boom;
  const rMax = reach(T, C, Lb, angMin), rMin = reach(T, C, Lb, angMax);
  if (R > rMax + 1e-9 || R < rMin - 1e-9) return null;
  if (!C.jib) return Math.acos(Math.min(1, Math.max(-1, (R - T.foot) / Lb)));
  let lo = angMin, hi = angMax;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (reach(T, C, Lb, m) > R) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Capacidad en un punto: con un giro dado o la peor de todos los giros (tabla de 360°) */
export function capAt(T: CraneSpec, C: CraneConfig, md: SupportMode, Lb: number, ang: number, slew: number | null) {
  if (slew !== null) return ratedCap(T, C, md, Lb, ang, slew);
  let c = Infinity;
  for (const s of SLEW_SAMPLES) c = Math.min(c, ratedCap(T, C, md, Lb, ang, s));
  return c;
}

/** Pasos "redondos" para filas y columnas */
const NICE = [0.5, 1, 2, 2.5, 5, 10, 15, 20, 25, 30];

/** Valores redondos de a a b (con a y b incluidos) con unos n tramos */
export function niceSteps(a: number, b: number, n: number): number[] {
  if (b - a < 1e-6) return [a];
  const step = NICE.find((s) => (b - a) / s <= n) ?? NICE[NICE.length - 1];
  const out = [a];
  for (let v = Math.ceil((a + 1e-6) / step) * step; v < b - step * 0.3; v += step) out.push(v);
  out.push(b);
  return out.map((v) => Math.round(v * 100) / 100);
}

/** Múltiplos de un paso redondo entre a y b (sin los extremos si no son redondos), unos n */
export function roundSteps(a: number, b: number, n: number): number[] {
  const step = NICE.find((s) => (b - a) / s <= n) ?? NICE[NICE.length - 1];
  const out: number[] = [];
  for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) out.push(Math.round(k * step * 100) / 100);
  return out;
}

export interface LoadChart {
  /** 'boom': columnas = largo de pluma (m); 'tower': columnas = ángulo de la pluma (°) y el radio lo da el carro */
  kind: 'boom' | 'tower';
  cols: number[];
  radii: number[];
  /** cap[fila][columna] en t (incluye el gancho, como el HUD); null = no se llega a ese radio */
  cap: (number | null)[][];
  md: SupportMode;
  /** null = peor giro (360°) */
  slew: number | null;
}

/**
 * Largo y ángulo de una casilla. Telescópica o de celosía: el largo de la columna y el ángulo que da el radio.
 * Grúa torre: el ángulo de la columna y el carro (Lb) que da el radio (pie en el eje: reach = Lb·cos ang).
 */
export function cellPose(T: CraneSpec, C: CraneConfig, kind: LoadChart['kind'], col: number, R: number, maxLb = T.boom.max) {
  if (kind === 'tower') {
    const ang = col * D, Lb = (R - T.foot) / Math.cos(ang);
    return Lb >= T.boom.min - 1e-9 && Lb <= T.boom.max + 1e-9 ? { Lb, ang } : null;
  }
  if (col > maxLb + 1e-9) return null;
  const ang = angleFor(T, C, col, R);
  return ang === null ? null : { Lb: col, ang };
}

/**
 * Tabla de cargas para la configuración C y el modo de apoyo md. slew = giro (rad) o null para el peor giro.
 * maxLb = largo al que se puede telescopar ahora (sin Y-guy la AT 500-8 y la AT 650-8 no pasan de 35 m).
 */
export function loadChart(T: CraneSpec, C: CraneConfig, md: SupportMode, slew: number | null, maxLb = T.boom.max): LoadChart {
  const kind: LoadChart['kind'] = T.tower ? 'tower' : 'boom';
  const cols = kind === 'tower'
    ? niceSteps(T.boom.angMin / D, T.boom.angMax / D, 4)
    : niceSteps(T.boom.min, T.boom.max, 8);
  // radios: del más corto (pluma más corta y más alta) al más largo (pluma más larga y más tumbada)
  let r0: number, r1: number;
  if (kind === 'tower') { r0 = T.foot + T.boom.min * Math.cos(T.boom.angMax); r1 = T.foot + T.boom.max; }
  else { r0 = reach(T, C, T.boom.min, T.boom.angMax); r1 = reach(T, C, T.boom.max, T.boom.angMin); }
  const radii = roundSteps(Math.max(r0, 1), r1, 18);
  const cap = radii.map((R) => cols.map((c) => {
    const p = cellPose(T, C, kind, c, R, maxLb);
    return p ? capAt(T, C, md, p.Lb, p.ang, slew) : null;
  }));
  return { kind, cols, radii, cap, md, slew };
}

/** Fila y columna más cercanas a la posición actual (radio R, largo Lb y ángulo ang) */
export function chartMark(ch: LoadChart, R: number, Lb: number, ang: number) {
  const near = (list: number[], v: number) => list.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(list[b] - v) ? i : b), 0);
  return { row: near(ch.radii, R), col: near(ch.cols, ch.kind === 'tower' ? ang / D : Lb) };
}
