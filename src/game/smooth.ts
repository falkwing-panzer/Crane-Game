/**
 * Suavidad (fase 22): cómo se manejó la carga colgada, como lo vería un operador. Sin three.js ni Rapier.
 *
 * Mientras hay carga colgando se miden, en cada paso:
 * - **balanceo**: ángulo del cable con la vertical (grados); cuenta la media en el tiempo;
 * - **tirones**: cuánto pasa la tensión medida de la estática (gancho + carga); cuenta el peor pico;
 * - **arranques y paradas**: aceleración horizontal de la carga (m/s²), de la velocidad filtrada; cuenta la media.
 *
 * Todo va en campos planos del turno (`Run`): las instantáneas lo copian y rebobinar lo devuelve como estaba.
 * La nota (0–100) y la medalla salen de `smoothScore`. Los umbrales son **provisionales** (sacados de los alumnos de
 * guion de las pruebas): se fijarán con partidas de Jesús.
 */

/** Lo que el turno guarda de la suavidad */
export interface SmoothRun {
  /** Segundos con carga colgada */
  smT: number;
  /** Integral del balanceo (grados · s) y su pico (grados) */
  smSw: number; smSwMax: number;
  /** Peor tirón: tensión / estática − 1 */
  smJk: number;
  /** Integral de la aceleración horizontal (m/s² · s) y su pico */
  smAc: number; smAcMax: number;
  /** Velocidad horizontal filtrada de la carga en el paso anterior y si hay paso anterior (0/1) */
  smVx: number; smVz: number; smOn: number;
}

export const newSmooth = (): SmoothRun => ({ smT: 0, smSw: 0, smSwMax: 0, smJk: 0, smAc: 0, smAcMax: 0, smVx: 0, smVz: 0, smOn: 0 });

/** Filtro de la velocidad (s): quita el ruido de un paso de Rapier sin tapar un frenazo */
export const VEL_TAU = 0.1;
/** Después de despegar, unos pasos para que el filtro arranque */
const WARM = 0.25;

export interface SmoothSample {
  /** Ángulo del cable con la vertical (rad) */
  swing: number;
  /** Tensión medida y estática (t); estática ≤ 0 = no se mide (tándem: la parte ya sale de la tensión) */
  tension: number; static: number;
  /** Velocidad horizontal de la carga (m/s) */
  vx: number; vz: number;
}

/** Un paso con carga colgada */
export function smoothStep(r: SmoothRun, dt: number, s: SmoothSample) {
  const k = Math.min(1, dt / VEL_TAU);
  if (!r.smOn) {
    r.smVx = s.vx; r.smVz = s.vz; r.smOn = 1;
    return;
  }
  const vx = r.smVx + (s.vx - r.smVx) * k, vz = r.smVz + (s.vz - r.smVz) * k;
  const a = Math.hypot(vx - r.smVx, vz - r.smVz) / dt;
  r.smVx = vx; r.smVz = vz;
  r.smT += dt;
  if (r.smT < WARM) return;
  const sw = (s.swing * 180) / Math.PI;
  r.smSw += sw * dt;
  r.smSwMax = Math.max(r.smSwMax, sw);
  r.smAc += a * dt;
  r.smAcMax = Math.max(r.smAcMax, a);
  if (s.static > 0) r.smJk = Math.max(r.smJk, s.tension / s.static - 1);
}

/** La carga dejó de colgar: el próximo izaje empieza de cero en el filtro */
export function smoothRest(r: SmoothRun) { r.smOn = 0; }

export type Medal = 'oro' | 'plata' | 'bronce' | null;

/** Umbrales provisionales: penalización por cada unidad sobre lo que no cuenta */
export const SMOOTH = {
  /** Segundos de carga colgada para que haya nota */
  minT: 5,
  /** Balanceo medio libre (°) y puntos por grado de más */
  swFree: 1.5, swK: 6,
  /** Tirón libre (fracción) y puntos por cada 1 % de más */
  jkFree: 0.06, jkK: 1.2,
  /** Aceleración media libre (m/s²) y puntos por cada 0,1 m/s² de más */
  acFree: 0.15, acK: 4,
  oro: 85, plata: 70, bronce: 50,
};

export interface SmoothScore {
  score: number; medal: Medal;
  /** Balanceo medio y máximo (°), peor tirón (%), aceleración media (m/s²) */
  swing: number; swingMax: number; jerk: number; acc: number;
}

/** Nota del turno; null si casi no se colgó nada */
export function smoothScore(r: SmoothRun): SmoothScore | null {
  const T = r.smT - WARM;
  if (r.smT < SMOOTH.minT || T <= 0) return null;
  const swing = r.smSw / T, acc = r.smAc / T, jerk = Math.max(0, r.smJk);
  const S = SMOOTH;
  const pen = S.swK * Math.max(0, swing - S.swFree)
    + S.jkK * 100 * Math.max(0, jerk - S.jkFree)
    + S.acK * 10 * Math.max(0, acc - S.acFree);
  const score = Math.max(0, Math.min(100, Math.round(100 - pen)));
  return { score, medal: medalFor(score), swing, swingMax: r.smSwMax, jerk: jerk * 100, acc };
}

export const medalFor = (score: number): Medal =>
  score >= SMOOTH.oro ? 'oro' : score >= SMOOTH.plata ? 'plata' : score >= SMOOTH.bronce ? 'bronce' : null;

const MEDAL_N = { oro: 3, plata: 2, bronce: 1 } as const;
/** 0 sin medalla … 3 oro (para comparar) */
export const medalRank = (m: Medal) => (m ? MEDAL_N[m] : 0);
