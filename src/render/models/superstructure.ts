import type { WheeledSpec } from '../../crane/cranes';
import type { Parts } from './builder';
import { stackPlates, type Layout } from './layout';

// Superestructura y pluma telescópica (port de craneModel() de la referencia).
// Superestructura: marco con origen en el centro de giro; las alturas son las del chasis (y absoluta).
// Pluma: marco con origen en el pie, x a lo largo de la pluma, y normal hacia arriba, z lateral.

/** Tramos telescópicos además del base (la referencia dibuja 3) */
export const TELE_N = 3;

/** Poleas de la cabeza: número y radio. El radio de la referencia (0,45 + 0,25·ancho) se limita para que, con
 *  la pluma tumbada y recogida, las poleas no bajen de la parte inferior del tramo base (no tocan la cabina). */
export function sheaves(T: WheeledSpec, L: Layout) {
  const n = T.structMax > 100 ? 6 : 4;
  const r = Math.min(0.45 + T.boom.w * 0.25, 0.45 * L.hu + 0.03);
  return { n, r, y: -0.05 * L.hu, x: 0 };
}

/** Partes fijas de la superestructura. */
export function buildSuper(T: WheeledSpec, L: Layout, P: Parts) {
  const yd = L.yd, bw = T.boom.w, ft = T.foot, cw = L.cw, wide = L.wide;
  P.cyl('dark', [0, yd, 0], [0, yd + 0.12, 0], L.ringR, 20);
  // placa base con ranura bajo el pie de pluma (por ahí baja la cola de la pluma al levantarla)
  const [s0, s1] = L.slot, pr = cw.x - cw.len / 2 + 0.2, zs = bw / 2 + 0.08;
  P.box('dark', pr, s0, yd + 0.12, L.plateTop, -wide, wide);
  P.box('dark', s1, L.front, yd + 0.12, L.plateTop, -wide, wide);
  for (const s of [-1, 1]) P.box('dark', s0, s1, yd + 0.12, L.plateTop, s * zs, s * wide);
  if (L.rearBlock) { const b = L.rearBlock; P.box('yellowDark', b.x0, b.x1, b.y0, b.y1, b.z0, b.z1); }
  // capó del motor de la superestructura (a la derecha) con rejillas, filete y escape
  if (L.housing) {
    const h = L.housing;
    P.box('yellow', h.x0, h.x1, h.y0, h.y1, h.z0, h.z1);
    P.box('yellowShade', h.x0, h.x1, h.y1 - 0.08, h.y1, h.z1, h.z1 + 0.02);
    for (let i = 0; i < 6; i++) {
      const x = h.x0 + 0.4 + i * 0.3;
      if (x + 0.12 > h.x1 - 0.3) break;
      P.box('black', x, x + 0.12, yd + 0.6, yd + 1.1, h.z1, h.z1 + 0.025);
    }
    const ex = Math.min(h.x1 - 0.3, ft + 2.0);
    if (ex > h.x0 + 0.2) P.cyl('dark', [ex, h.y1, h.z1 - 0.3], [ex, h.y1 + 0.95, h.z1 - 0.3], 0.11, 8);
  }
  // soportes del pie de pluma y bulón
  for (const s of [-1, 1]) {
    const a = s * (bw / 2 + 0.1), b = s * (bw / 2 + 0.36);
    P.box('yellowShade', ft - 0.9, ft + 1.1, L.plateTop, T.pivH + 0.4, Math.min(a, b), Math.max(a, b));
  }
  P.cyl('steel', [ft, T.pivH, -(bw / 2 + 0.45)], [ft, T.pivH, bw / 2 + 0.45], 0.12 + 0.06 * bw, 12);
  // contrapeso: placas apiladas o torre de placas redondas
  if (T.cwStyle === 'stack') {
    P.box('dark', cw.x - cw.len / 2 - 0.2, cw.x + cw.len / 2 + 0.2, cw.y0, cw.y0 + 0.4, -cw.w - 0.2, cw.w + 0.2);
    // torre de placas rectangulares (la referencia las dibuja redondas). Con lastre crecen con el montaje: van
    // aparte (CraneModel, ballastPlates)
    const np = L.ballast ? 0 : stackPlates(cw.hgt);
    for (let i = 0; i < np; i++) {
      const y = cw.y0 + 0.4 + i * 0.42;
      P.box(i % 2 ? 'greyDark' : 'greyDeep', cw.x - cw.len / 2, cw.x + cw.len / 2, y, y + 0.37, -cw.w, cw.w);
    }
  } else {
    const n = T.ballast ? 1 : 3, sh = cw.hgt / n;
    for (let i = 0; i < n; i++) {
      P.box(i % 2 ? 'greyDeep' : 'dark', cw.x - cw.len / 2, cw.x + cw.len / 2, cw.y0 + i * sh, cw.y0 + (i + 1) * sh - (i < n - 1 ? 0.07 : 0), -cw.w, cw.w);
    }
  }
  // cabrestante principal sobre el frente del contrapeso (delante de la torre de lastre)
  const d = L.drum;
  for (const s of [-1, 1]) {
    const a = s * (d.hl + 0.05), b = s * (d.hl + 0.15);
    P.box('black', d.x - 0.55, d.x + 0.55, d.y0, d.y + 0.3, Math.min(a, b), Math.max(a, b));
  }
  P.cyl('drum', [d.x, d.y, -d.hl], [d.x, d.y, d.hl], d.r, 14);
  // cabina del operador (izquierda), con ménsula, cristales, techo y rotativo
  const c = L.opCab;
  P.box('dark', c.x0, c.x1, yd + 0.12, c.y0, c.z0, c.z1);
  P.box('cabin', c.x0, c.x1, c.y0, c.y1, c.z0, c.z1);
  P.box('glass', c.x1, c.x1 + 0.04, c.y0 + 0.65, c.y1 - 0.15, c.z0 + 0.1, c.z1 - 0.1);
  P.box('glass', c.x0 + 0.35, c.x1 - 0.2, c.y0 + 0.75, c.y1 - 0.2, c.z0 - 0.04, c.z0);
  P.box('dark', c.x0 - 0.05, c.x1 + 0.05, c.y1, c.y1 + 0.08, c.z0, c.z1);
  P.box('glass', c.x0 + 0.4, c.x1 - 0.3, c.y1 + 0.08, c.y1 + 0.1, c.z0 + 0.12, c.z1 - 0.12);
  P.cyl('beacon', [(c.x0 + c.x1) / 2 - 0.3, c.y1 + 0.08, (c.z0 + c.z1) / 2], [(c.x0 + c.x1) / 2 - 0.3, c.y1 + 0.25, (c.z0 + c.z1) / 2], 0.1, 8);
}

/** Tramo base de la pluma (marco de la pluma). */
export function buildBoomBase(T: WheeledSpec, L: Layout, P: Parts) {
  const min = T.boom.min, bw = T.boom.w, hu = L.hu;
  P.box('yellow', -L.tail, min, -hu / 2, hu / 2, -bw / 2, bw / 2);
  P.box('yellowShade', min - 0.45, min, -hu / 2 - 0.04, hu / 2 + 0.04, -bw / 2 - 0.04, bw / 2 + 0.04);
  P.box('dark', 0.5, min - 0.8, hu / 2, hu / 2 + 0.03, -bw * 0.18, bw * 0.18);
}

/** Tramo interior k (1 = el más grueso). Origen en su extremo delantero. */
export function buildSection(T: WheeledSpec, L: Layout, k: number, P: Parts) {
  const len = T.boom.min - 1.2, f = 1 - 0.13 * k, w = T.boom.w * f, h = L.hu * f;
  P.box(k % 2 ? 'yellow' : 'yellowDark', -len, 0, -h / 2, h / 2, -w / 2, w / 2);
  P.box('yellowShade', -0.35, -0.05, -h / 2 - 0.03, h / 2 + 0.03, -w / 2 - 0.03, w / 2 + 0.03);
}

/** Extremo delantero del tramo k con la pluma a largo Lb (fórmula de la referencia). */
export function sectionTip(T: WheeledSpec, k: number, Lb: number) {
  return T.boom.min + ((Lb - T.boom.min) * k) / TELE_N;
}

/** Cabeza con poleas. Origen en la cabeza (punto de suspensión del cable, headPos). */
export function buildHead(T: WheeledSpec, L: Layout, P: Parts) {
  const hu = L.hu, sv = sheaves(T, L), zp = sv.n * 0.065 + 0.06;
  for (const s of [-1, 1]) P.box('yellow', -1.05, 0.3, -0.5 * hu, 0.4 * hu, s * zp - 0.04, s * zp + 0.04);
  for (let i = 0; i < sv.n; i++) {
    const z = (i - (sv.n - 1) / 2) * 0.13;
    P.cyl(i % 2 ? 'chrome' : 'steel', [sv.x, sv.y, z - 0.05], [sv.x, sv.y, z + 0.05], sv.r, 18);
  }
  P.cyl('greyDeep', [sv.x, sv.y, -(zp + 0.06)], [sv.x, sv.y, zp + 0.06], 0.12, 8);
}
