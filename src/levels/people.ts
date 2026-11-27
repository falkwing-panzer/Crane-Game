// Gente en la obra (fase 23): trabajadores que caminan (zona de exclusión bajo la carga) y el señalero. Sin three.js
// ni Rapier. Las posiciones son función del reloj del turno: deterministas y sin estado (van solas en las
// instantáneas). Aproximación del juego: la referencia no tiene gente.

/** Un trabajador: va y vuelve por una línea quebrada, parando `wait` s en cada punta */
export interface SiteWorker { pts: [number, number][]; speed: number; wait?: number; phase?: number }

/** Radio de la zona de exclusión alrededor de una persona (m) */
export const EXCL_R = 2.5;
/** La carga cuenta "encima" si su fondo está a más de esto del suelo (m): apoyada al lado no cuenta */
export const EXCL_H = 0.3;
/** Segundos seguidos con la carga encima de alguien antes de fallar (como la línea eléctrica: aviso, alarma y fallo) */
export const EXCL_T = 3;
/** Velocidad al caminar (m/s) */
export const WALK = 1.1;

const len = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Dónde está y hacia dónde mira (rumbo en el plano: atan2(−dz, dx), como las grúas) en el instante t */
export function workerAt(w: SiteWorker, t: number): { x: number; z: number; h: number; moving: boolean } {
  const segs = w.pts.slice(1).map((p, i) => len(w.pts[i], p));
  const L = segs.reduce((a, b) => a + b, 0);
  if (L < 1e-6) return { x: w.pts[0][0], z: w.pts[0][1], h: 0, moving: false };
  const wait = w.wait ?? 4, walk = L / w.speed, cycle = 2 * (walk + wait);
  let s = (((t + (w.phase ?? 0)) % cycle) + cycle) % cycle;
  let back = false, moving = true;
  if (s < wait) { s = 0; moving = false; }
  else if (s < wait + walk) s -= wait;
  else if (s < 2 * wait + walk) { s = walk; moving = false; back = true; }
  else { s = walk - (s - 2 * wait - walk); back = true; }
  let d = s * w.speed;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const a = w.pts[i], b = w.pts[i + 1], k = Math.min(1, d / segs[i]);
      const dx = (b[0] - a[0]) * (back ? -1 : 1), dz = (b[1] - a[1]) * (back ? -1 : 1);
      return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, h: Math.atan2(-dz, dx), moving };
    }
    d -= segs[i];
  }
  return { x: w.pts[0][0], z: w.pts[0][1], h: 0, moving: false };
}

/**
 * La carga (centro x, z, radio en planta r y fondo) está encima de algún trabajador: devuelve su índice o −1.
 * Cuenta la planta de la carga más la zona de exclusión de la persona.
 */
export function overWorker(load: { x: number; z: number; r: number; bottom: number }, workers: SiteWorker[], t: number) {
  if (load.bottom < EXCL_H) return -1;
  for (let i = 0; i < workers.length; i++) {
    const p = workerAt(workers[i], t);
    if (Math.hypot(p.x - load.x, p.z - load.z) < EXCL_R + load.r) return i;
  }
  return -1;
}

/** Distancia en planta de la carga al trabajador más cercano, menos los radios (negativa = dentro) */
export function workerMargin(load: { x: number; z: number; r: number }, workers: SiteWorker[], t: number) {
  let m = Infinity;
  for (const w of workers) {
    const p = workerAt(w, t);
    m = Math.min(m, Math.hypot(p.x - load.x, p.z - load.z) - EXCL_R - load.r);
  }
  return m;
}
