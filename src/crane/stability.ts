// Modelo analítico de estabilidad y LMI, portado de referencia/crane-v20.html
// (KF, yNoGuy, reach, structCap, supportRect, craneMasses, tipUtil, lmiStatic, ratedCap).
// Las fórmulas son las de la referencia; las pruebas comparan ambas con tolerancia 1e-6.
//
// Diferencia con la referencia: allí el estado de montaje se guardaba dentro del objeto de la grúa
// (T.mCw, T.yOn, T.jib, T.jibRel, T.superlift.r). Aquí va aparte, en CraneConfig, y los datos no se modifican.
//
// Marco del chasis: x hacia el frente, y lateral. La referencia usa y = +sin(slew); en el mundo 3D la
// izquierda es −z. Como el rectángulo de apoyo es simétrico, el signo lateral no cambia ningún resultado.

import type { CraneSpec, JibDef, SupportRect } from './cranes';

/** Modo de apoyo: estabilizadores, neumáticos parado, neumáticos en marcha, orugas parado / en marcha. */
export type SupportMode = 'out' | 'tire' | 'move' | 'crawler' | 'crawlMove';

/** Factores de estabilidad: utilización máxima admitida de cada modo (100 % de LMI = KF del momento de vuelco). */
export const KF: Record<SupportMode, number> = { out: 0.85, tire: 0.66, move: 0.45, crawler: 0.75, crawlMove: 0.62 };

/** Estado de montaje que afecta a la estabilidad. */
export interface CraneConfig {
  /** Masa del contrapeso actual (base + lastre montado) */
  mCw: number;
  /** Arriostramiento en Y tensado */
  yOn: boolean;
  /** Plumín montado (o null) */
  jib: JibDef | null;
  /** Ángulo del plumín respecto de la pluma (rad) */
  jibRel: number;
  /** Radio actual del lastre superlift (m) */
  slR: number;
}

/** Configuración al cargar un nivel (como loadLevel de la referencia): sin lastre, sin Y-guy, sin plumín. */
export function baseConfig(T: CraneSpec): CraneConfig {
  return {
    mCw: T.ballast ? T.cwBase ?? T.mCw : T.mCw,
    yOn: false,
    jib: null,
    jibRel: 0,
    slR: T.superlift ? T.superlift.r0 : 0,
  };
}

/** Reducción de capacidad sin arriostramiento en Y según el largo de pluma. */
export const yNoGuy = (Lb: number) => (Lb <= 25 ? 1 : Math.max(0.25, 1 - ((Lb - 25) / 25) * 0.8));

const jibAbs = (C: CraneConfig, ang: number) => ang - (C.jibRel || 0);

/** Radio medido desde el eje de giro: pie de pluma + pluma + plumín abatible. */
export function reach(T: CraneSpec, C: CraneConfig, Lb: number, ang: number) {
  return T.foot + Lb * Math.cos(ang) + (C.jib ? C.jib.len * Math.cos(jibAbs(C, ang)) : 0);
}

/** Capacidad estructural (t) para un largo de pluma: lineal entre structMax y structMin, Y-guy, torre y plumín. */
export function structCap(T: CraneSpec, C: CraneConfig, Lb: number) {
  let c =
    (T.boom.max === T.boom.min
      ? T.structMax
      : T.structMax - ((Lb - T.boom.min) / (T.boom.max - T.boom.min)) * (T.structMax - T.structMin)) *
    (T.yguy && !C.yOn ? yNoGuy(Lb) : 1);
  if (T.tower) c = Lb <= 13.2 ? T.structMax : (132 - (Lb - 13.2) * 0.641) / Lb;
  return C.jib ? Math.min(c, C.jib.cap) : c;
}

export function supportRect(T: CraneSpec, md: SupportMode): SupportRect {
  const r = T.crawler ? T.track : md === 'out' ? T.out : T.tire;
  if (!r) throw new Error(`${T.name}: sin rectángulo de apoyo para el modo ${md}`);
  return r;
}

/** Masa puntual en el marco del chasis: [m, x, y, soloEstabiliza]. */
export type PointMass = [m: number, x: number, y: number, onlyRestore?: 1];

/** Masas de la grúa (sin gancho ni carga) en el marco del chasis. */
export function craneMasses(T: CraneSpec, C: CraneConfig, Lb: number, ang: number, slew: number): PointMass[] {
  const c = Math.cos(slew), s = Math.sin(slew);
  const at = (d: number): [number, number] => [T.piv + d * c, d * s];
  const ms: PointMass[] = [
    [T.mCar, T.xCar, 0],
    [T.mSup, ...at(T.xSup)],
    [C.mCw, ...at(T.xCw)],
    T.tower ? [T.tower.jibM, ...at((T.tower.J / 2) * Math.cos(ang))] : [T.boom.kg * Lb, ...at(T.foot + (Lb / 2) * Math.cos(ang))],
  ];
  if (C.jib) ms.push([C.jib.kg * C.jib.len, ...at(T.foot + Lb * Math.cos(ang) + (C.jib.len / 2) * Math.cos(jibAbs(C, ang)))]);
  if (T.derrick) ms.push([T.derrick.kg * T.derrick.len, ...at(T.derrick.foot - (T.derrick.len / 2) * Math.cos(T.derrick.ang))]);
  // el lastre superlift apoya en el suelo: solo aporta momento estabilizador
  if (T.superlift) ms.push([T.superlift.m, ...at(-C.slR), 1]);
  return ms;
}

/** Utilización al vuelco: máximo, por arista del apoyo, de momento volcador / momento estabilizador. */
export function tipUtil(T: CraneSpec, md: SupportMode, ms: PointMass[]) {
  const r = supportRect(T, md);
  const E: [number, number, number][] = [[1, 0, r.xf], [-1, 0, -r.xr], [0, 1, r.hw], [0, -1, r.hw]];
  let u = 0;
  for (const [nx, ny, e] of E) {
    let o = 0, i = 0;
    for (const [m, x, y, onlyRestore] of ms) {
      const d = nx * x + ny * y - e;
      if (d > 0) { if (!onlyRestore) o += m * d; } else i -= m * d;
    }
    u = Math.max(u, o / Math.max(i, 1e-6));
  }
  return u;
}

/**
 * Como tipUtil, pero dice también por qué arista vuelca (no está en la referencia).
 * Aristas: 0 delantera (x = xf), 1 trasera (x = xr), 2 lado y+ de la referencia (= izquierda, −z en el mundo),
 * 3 lado y− (= derecha, +z).
 */
export function tipEdge(T: CraneSpec, md: SupportMode, ms: PointMass[]) {
  const r = supportRect(T, md);
  const E: [number, number, number][] = [[1, 0, r.xf], [-1, 0, -r.xr], [0, 1, r.hw], [0, -1, r.hw]];
  let u = 0, edge = 0;
  E.forEach(([nx, ny, e], k) => {
    let o = 0, i = 0;
    for (const [m, x, y, onlyRestore] of ms) {
      const d = nx * x + ny * y - e;
      if (d > 0) { if (!onlyRestore) o += m * d; } else i -= m * d;
    }
    const uk = o / Math.max(i, 1e-6);
    if (uk > u) { u = uk; edge = k; }
  });
  return { u, edge };
}

/** LMI (1 = 100 %) con una masa m colgada de la punta, en reposo. */
export function lmiStatic(T: CraneSpec, C: CraneConfig, md: SupportMode, Lb: number, ang: number, slew: number, m: number) {
  const ms = craneMasses(T, C, Lb, ang, slew), R = reach(T, C, Lb, ang);
  ms.push([m, T.piv + R * Math.cos(slew), R * Math.sin(slew)]);
  return Math.max(tipUtil(T, md, ms) / KF[md], m / structCap(T, C, Lb));
}

/** Capacidad nominal (t, incluye el gancho): la mayor masa con LMI < 1, por búsqueda binaria. */
export function ratedCap(T: CraneSpec, C: CraneConfig, md: SupportMode, Lb: number, ang: number, slew: number) {
  if (lmiStatic(T, C, md, Lb, ang, slew, 0) >= 1) return 0;
  let lo = 0, hi = structCap(T, C, Lb);
  if (lmiStatic(T, C, md, Lb, ang, slew, hi) < 1) return hi;
  for (let k = 0; k < 26; k++) {
    const m = (lo + hi) / 2;
    if (lmiStatic(T, C, md, Lb, ang, slew, m) < 1) lo = m; else hi = m;
  }
  return lo;
}
