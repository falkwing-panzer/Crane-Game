// Reglas de los niveles sin three.js ni Rapier (fase 9, parte B), portadas de la referencia: viento con ráfagas
// (windAt, WINDK), distancia entre segmentos (segSeg) y distancia de la grúa a las líneas eléctricas.

import type { V3 } from '../crane/pose';
import type { Level, PowerLine } from './levels';

/** Coeficiente de empuje del viento: F (t·m/s²) = WINDK · v² · área (WINDK de la referencia) */
export const WINDK = 0.006;
/** Aterrizaje duro (m/s), como impact() de la referencia */
export const HARD_LANDING = 1.4;
/** Velocidad mínima para contar un apoyo (m/s) */
export const LANDING_MIN = 0.15;
/** Distancia a la línea a la que suena la alarma, además de la mínima (m) */
export const LINE_WARN = 2;

/** Viento (m/s) en el instante t (windAt de la referencia): base que varía lento más ráfagas */
export function windAt(L: Pick<Level, 'wind'>, t: number) {
  const [base, gust] = L.wind;
  if (!base && !gust) return 0;
  const n = (Math.sin(0.31 * t) + 0.6 * Math.sin(0.83 * t + 1) + 0.3 * Math.sin(2.1 * t + 2)) / 1.9;
  return Math.max(0, base * (0.8 + 0.2 * Math.sin(0.07 * t)) + gust * n);
}

/** Área expuesta al viento (m²): la carga enganchada (lado mayor × alto × 0,75) o el gancho solo (0,4) */
export const windArea = (load: { w: number; d: number; h: number } | null) => (load ? Math.max(load.w, load.d) * load.h * 0.75 : 0.4);

/** Fuerza del viento (t·m/s², en x y z del mundo): dirección del nivel en grados (0 = +x, 90 = +z) */
export function windForce(L: Pick<Level, 'wind'>, t: number, area: number) {
  const v = windAt(L, t), f = WINDK * v * v * area, a = (L.wind[2] * Math.PI) / 180;
  return { v, x: Math.cos(a) * f, z: Math.sin(a) * f };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Distancia mínima entre los segmentos p1–q1 y p2–q2 (segSeg de la referencia) */
export function segSeg(p1: V3, q1: V3, p2: V3, q2: V3) {
  const d1 = [q1.x - p1.x, q1.y - p1.y, q1.z - p1.z], d2 = [q2.x - p2.x, q2.y - p2.y, q2.z - p2.z], r = [p1.x - p2.x, p1.y - p2.y, p1.z - p2.z];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  return Math.hypot(p1.x + d1[0] * s - (p2.x + d2[0] * t), p1.y + d1[1] * s - (p2.y + d2[1] * t), p1.z + d1[2] * s - (p2.z + d2[2] * t));
}

/** Lo que se compara con las líneas: pie → cabeza → punta → gancho, y la carga como segmento vertical con su radio */
export interface CraneLineGeom {
  foot: V3; head: V3; tip: V3; hook: V3;
  load?: { bottom: V3; top: V3; r: number };
}

/**
 * Margen hasta la distancia mínima de la línea más cercana (m; negativo = invadida), como la referencia: pluma,
 * plumín, cable y carga contra cada conductor, menos su distancia mínima (`clear`).
 */
export function lineMargin(lines: PowerLine[], g: CraneLineGeom) {
  let dmin = Infinity;
  for (const l of lines) {
    const A = { x: l.a[0], y: l.y, z: l.a[1] }, B = { x: l.b[0], y: l.y, z: l.b[1] };
    let d = Math.min(segSeg(g.foot, g.head, A, B), segSeg(g.head, g.tip, A, B), segSeg(g.tip, g.hook, A, B));
    if (g.load) d = Math.min(d, segSeg(g.load.bottom, g.load.top, A, B) - g.load.r);
    dmin = Math.min(dmin, d - l.clear);
  }
  return dmin;
}
