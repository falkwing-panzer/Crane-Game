import type { CraneSpec } from './cranes';
import type { CraneConfig } from './stability';

// Lastre superlift de la LR 3000 (fase 6B). Bandeja de sl.d × sl.w apoyada en el suelo detrás de la
// superestructura, a la distancia C.slR del centro de giro; gira con ella. Solo restaura (craneMasses).
// K acerca y L aleja la bandeja a 0,5 m/s (×0,3 en fino), con el guard del LMI de la referencia y sin
// atravesar obstáculos (boomHit de la referencia). Sin three.js para poder probarlo.

/** Velocidad del carro del superlift (m/s): (inp.slo − inp.sli) · 0,5 en step() de la referencia */
export const SUPERLIFT_SPEED = 0.5;
const FINE = 0.3;
/** Margen alrededor de la bandeja al probar choques (0,2 m en boomHit de la referencia) */
export const TRAY_MARGIN = 0.2;

type V2 = [number, number];

/** Esquinas de la bandeja en el marco del chasis (x, z), con la superestructura girada `slew`. */
export function trayCorners(T: CraneSpec, slR: number, slew: number, margin = 0): V2[] {
  const sl = T.superlift!;
  const c = Math.cos(slew), s = Math.sin(slew);
  const hx = sl.d / 2 + margin, hz = sl.w / 2 + margin;
  return ([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as V2[]).map(([dx, dz]) => {
    const lx = -slR + dx;
    // marco de la superestructura → chasis: igual que eye() del modelo (−z = izquierda)
    return [T.piv + lx * c + dz * s, -lx * s + dz * c];
  });
}

/** ¿Se solapan dos polígonos convexos? (ejes separadores) */
function overlap(a: V2[], b: V2[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const nx = y2 - y1, ny = x1 - x2;
    const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}

/**
 * ¿La bandeja toca las orugas de su propia grúa? (no está en la referencia: con rMin = 15 m y la bandeja de
 * 7 × 10 m, girada unos 35° llega a pisar la esquina de las orugas, que están a 12,1 m del centro).
 */
export function trayHitsTracks(T: CraneSpec, slR: number, slew: number) {
  const r = T.track;
  if (!T.superlift || !r) return false;
  const tr: V2[] = [[r.xr, -r.hw], [r.xf, -r.hw], [r.xf, r.hw], [r.xr, r.hw]];
  return overlap(trayCorners(T, slR, slew, TRAY_MARGIN), tr);
}

export interface SuperliftCtx {
  /** LMI estático con la configuración actual (lee C.slR) */
  lmi: () => number;
  /** LMI al empezar el paso */
  L0: number;
  /** Choque de la bandeja con el radio y el giro dados (mensaje) o null */
  hit: (slR: number) => string | null;
}

/**
 * Un paso del radio del superlift (dir: +1 alejar con L, −1 acercar con K). Devuelve el aviso si se cortó
 * ('lmi' = corte del LMI) o null.
 */
export function stepSuperlift(T: CraneSpec, C: CraneConfig, dir: number, fine: boolean, dt: number, ctx: SuperliftCtx): string | null {
  const sl = T.superlift;
  if (!sl || !dir) return null;
  const o = C.slR;
  C.slR = Math.max(sl.rMin, Math.min(sl.rMax, o + dir * SUPERLIFT_SPEED * (fine ? FINE : 1) * dt));
  if (C.slR === o) return null;
  const n = ctx.lmi();
  if (n >= 1 && n > ctx.L0 + 1e-6) { C.slR = o; return 'lmi'; }
  const why = ctx.hit(C.slR);
  if (why) { C.slR = o; return why; }
  return null;
}
