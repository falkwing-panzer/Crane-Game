import type { MatKey } from './materials';
import type { P3, Parts } from './builder';
import type { Box3 } from './layout';

// Detalles de forma comunes a todas las grúas (fase 8B, parte 2; aproximación visual, no están en la referencia):
// cabina del operador con frente inclinado y cristales grandes, escalerillas, barandillas y cristales inclinados.

type V2 = [number, number];

/**
 * Cristal (o chapa) delgado sobre el segmento a→b de un perfil (x, y), desplazado `off` hacia fuera
 * (a la derecha del sentido a→b) con grosor `t`, extruido de z0 a z1.
 */
export function slab(P: Parts, k: MatKey, a: V2, b: V2, z0: number, z1: number, t = 0.03, off = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const nx = dy / L, ny = -dx / L;
  const p = (q: V2, d: number): V2 => [q[0] + nx * d, q[1] + ny * d];
  P.ext(k, [p(a, off), p(b, off), p(b, off + t), p(a, off + t)], z0, z1);
}

/** Escalerilla vertical: largueros en p y q (puntos de abajo), de y0 a y1, peldaños cada ~0,3 m. */
export function ladder(P: Parts, k: MatKey, p: V2, q: V2, y0: number, y1: number, r = 0.022) {
  // p y q son (x, z); detalle pequeño (fase 16): no proyecta sombra y se oculta de lejos
  P.detail(() => {
    for (const [x, z] of [p, q]) P.cyl(k, [x, y0, z], [x, y1, z], r, 5);
    const n = Math.max(2, Math.floor((y1 - y0) / 0.3));
    for (let i = 1; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / (n + 0.5);
      P.cyl(k, [p[0], y, p[1]], [q[0], y, q[1]], r * 0.8, 5);
    }
  });
}

/** Barandilla sobre la polilínea `pts` (x, z) a la altura y0: postes, pasamanos arriba y a media altura. */
export function railing(P: Parts, k: MatKey, pts: V2[], y0: number, h = 0.9, r = 0.022) {
  const post = (x: number, z: number) => P.cyl(k, [x, y0, z], [x, y0 + h, z], r, 5);
  P.detail(() => {
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      post(x, z);
      if (i === 0) continue;
      const [xa, za] = pts[i - 1], L = Math.hypot(x - xa, z - za), n = Math.floor(L / 1.3);
      for (let j = 1; j <= n; j++) post(xa + ((x - xa) * j) / (n + 1), za + ((z - za) * j) / (n + 1));
      for (const y of [y0 + h, y0 + h / 2]) P.cyl(k, [xa, y, za] as P3, [x, y, z] as P3, r, 5);
    }
  });
}

/**
 * Cabina del operador dentro de la caja `c` (frente en x1): chapa con el frente inclinado hacia atrás y el techo
 * redondeado, parabrisas grande, ventana lateral en el lado de fuera (`outer`: −1 = z0, +1 = z1), cristal del
 * techo, puerta y rotativo. El cuerpo va en 'cabin' y los cristales en 'glass' (la vista de cabina de la RT y de las
 * orugas oculta esos dos materiales).
 */
export function operatorCab(P: Parts, c: Box3, outer: -1 | 1 = -1, beacon = true) {
  const h = c.y1 - c.y0, len = c.x1 - c.x0;
  const sl = Math.min(0.32, 0.16 * len); // lo que se inclina el frente
  const yb = c.y0 + 0.32 * h; // arranque del parabrisas
  const fa: V2 = [c.x1, yb], fb: V2 = [c.x1 - sl, c.y1 - 0.1];
  P.ext('cabin', [[c.x0, c.y0], [c.x1, c.y0], fa, fb, [c.x1 - sl - 0.1, c.y1], [c.x0, c.y1]], c.z0, c.z1);
  // parabrisas sobre el frente inclinado y franja oscura debajo
  const t = (u: number): V2 => [fa[0] + (fb[0] - fa[0]) * u, fa[1] + (fb[1] - fa[1]) * u];
  slab(P, 'glass', t(0.05), t(0.95), c.z0 + 0.08, c.z1 - 0.08);
  P.box('dark', c.x1, c.x1 + 0.03, yb - 0.1, yb, c.z0 + 0.04, c.z1 - 0.04);
  // ventana lateral grande (lado de fuera) que sigue el frente, y puerta detrás
  const zg = outer < 0 ? [c.z0 - 0.03, c.z0] : [c.z1, c.z1 + 0.03];
  const w0 = c.x0 + 0.38 * len, ylo = c.y0 + 0.4 * h, yhi = c.y1 - 0.18;
  const fx = (y: number) => c.x1 - 0.1 - (sl * (y - yb)) / (c.y1 - 0.1 - yb);
  P.ext('glass', [[w0, ylo], [fx(ylo), ylo], [fx(yhi), yhi], [w0, yhi]], zg[0], zg[1]);
  P.ext('glass', [[c.x0 + 0.12, c.y0 + 0.45 * h], [w0 - 0.1, c.y0 + 0.45 * h], [w0 - 0.1, yhi], [c.x0 + 0.12, yhi]], zg[0], zg[1]);
  P.box('dark', w0 - 0.08, w0 - 0.04, c.y0 + 0.08, c.y1 - 0.08, zg[0], zg[1]);
  // techo con cristal y visera
  P.box('dark', c.x0 - 0.04, c.x1 - sl - 0.05, c.y1, c.y1 + 0.06, c.z0, c.z1);
  P.box('glass', c.x0 + 0.35, c.x1 - sl - 0.25, c.y1 + 0.06, c.y1 + 0.08, c.z0 + 0.12, c.z1 - 0.12);
  // limpiaparabrisas sobre el cristal y rejilla de protección sobre el techo (fase 8B)
  const ux = fb[0] - fa[0], uy = fb[1] - fa[1], ul = Math.hypot(ux, uy), nx = uy / ul, ny = -ux / ul;
  const on = (u: number, z: number): P3 => { const q = t(u); return [q[0] + nx * 0.045, q[1] + ny * 0.045, z]; };
  const zc = (c.z0 + c.z1) / 2;
  P.detail(() => {
    P.cyl('dark', on(0.12, zc - 0.1), on(0.62, zc + 0.15), 0.013, 4);
    for (let x = c.x0 + 0.3; x < c.x1 - sl - 0.2; x += 0.3) P.box('dark', x, x + 0.03, c.y1 + 0.1, c.y1 + 0.13, c.z0 + 0.06, c.z1 - 0.06);
    for (const z of [c.z0 + 0.06, c.z1 - 0.09]) P.box('dark', c.x0 + 0.25, c.x1 - sl - 0.15, c.y1 + 0.1, c.y1 + 0.13, z, z + 0.03);
  });
  if (beacon) {
    const xm = c.x0 + 0.3, zm = (c.z0 + c.z1) / 2;
    P.cyl('beacon', [xm, c.y1 + 0.06, zm], [xm, c.y1 + 0.22, zm], 0.09, 8);
  }
}
