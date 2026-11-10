import type { WheeledSpec } from '../../crane/cranes';
import type { Parts } from './builder';
import type { Layout } from './layout';
import { ladder, operatorCab, railing } from './details';

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
  // contrapeso: placas instanciadas en CraneModel (ballastPlates: contrapeso fijo y torres de lastre, fase 8B)
  // cabrestante principal sobre el frente del contrapeso (delante de la torre de lastre)
  const d = L.drum;
  for (const s of [-1, 1]) {
    const a = s * (d.hl + 0.05), b = s * (d.hl + 0.15);
    P.box('black', d.x - 0.55, d.x + 0.55, d.y0, d.y + 0.3, Math.min(a, b), Math.max(a, b));
  }
  P.cyl('drum', [d.x, d.y, -d.hl], [d.x, d.y, d.hl], d.r, 14);
  // cabina del operador (izquierda), con ménsula; frente inclinado y cristales grandes (fase 8B)
  const c = L.opCab;
  P.box('dark', c.x0, c.x1, yd + 0.12, c.y0, c.z0, c.z1);
  operatorCab(P, c, -1);
  // barandilla sobre el capó y escalerilla en su costado (fase 8B, aproximación visual)
  if (L.housing) {
    const h = L.housing, zr = h.z1 - 0.06;
    railing(P, 'dark', [[h.x0 + 0.1, h.z0 + 0.1], [h.x0 + 0.1, zr], [h.x1 - 0.3, zr]], h.y1, 0.8);
    const lx = h.x0 + 0.35;
    ladder(P, 'dark', [lx, h.z1 + 0.05], [lx + 0.4, h.z1 + 0.05], yd + 0.15, h.y1);
  }
}

/**
 * Sección de la pluma (z, y) con los cantos de abajo achaflanados, como las plumas reales (fase 8B; antes una caja).
 * Cabe en el rectángulo ancho × alto, así que las pruebas de choques con la caja siguen valiendo.
 */
export function boomSection(w: number, h: number, grow = 0): [number, number][] {
  const c = Math.min(0.35 * w, 0.35 * h), a = w / 2 + grow, b = h / 2 + grow;
  return [[-a, b], [-a, -b + c], [-a + 0.8 * c, -b], [a - 0.8 * c, -b], [a, -b + c], [a, b]];
}

/** Tramo base de la pluma (marco de la pluma). */
export function buildBoomBase(T: WheeledSpec, L: Layout, P: Parts) {
  const min = T.boom.min, bw = T.boom.w, hu = L.hu;
  P.extX('yellow', boomSection(bw, hu), -L.tail, min);
  P.extX('yellowShade', boomSection(bw, hu, 0.04), min - 0.45, min);
  P.box('dark', 0.5, min - 0.8, hu / 2, hu / 2 + 0.03, -bw * 0.18, bw * 0.18);
}

/** Tramo interior k (1 = el más grueso). Origen en su extremo delantero. */
export function buildSection(T: WheeledSpec, L: Layout, k: number, P: Parts) {
  const len = T.boom.min - 1.2, f = 1 - 0.13 * k, w = T.boom.w * f, h = L.hu * f;
  P.extX(k % 2 ? 'yellow' : 'yellowDark', boomSection(w, h), -len, 0);
  P.extX('yellowShade', boomSection(w, h, 0.03), -0.35, -0.05);
}

/** Extremo delantero del tramo k con la pluma a largo Lb (fórmula de la referencia). */
export function sectionTip(T: WheeledSpec, k: number, Lb: number) {
  return T.boom.min + ((Lb - T.boom.min) * k) / TELE_N;
}

/** Cabeza con poleas. Origen en la cabeza (punto de suspensión del cable, headPos). */
export function buildHead(T: WheeledSpec, L: Layout, P: Parts) {
  const hu = L.hu, sv = sheaves(T, L), zp = sv.n * 0.065 + 0.06;
  // chapas laterales con el frente redondeado alrededor de las poleas (sin bajar del fondo de la pluma)
  const R = sv.r + 0.1, prof: [number, number][] = [[-1.05, -0.5 * hu], [-1.05, 0.4 * hu]];
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI / 2 - (i * Math.PI) / 8;
    prof.push([sv.x + Math.max(0.3, R) * Math.cos(t), Math.max(-0.5 * hu, Math.min(0.4 * hu, sv.y + R * Math.sin(t)))]);
  }
  for (const s of [-1, 1]) P.ext('yellow', prof, s * zp - 0.04, s * zp + 0.04);
  for (let i = 0; i < sv.n; i++) {
    const z = (i - (sv.n - 1) / 2) * 0.13;
    P.cyl(i % 2 ? 'chrome' : 'steel', [sv.x, sv.y, z - 0.05], [sv.x, sv.y, z + 0.05], sv.r, 18);
  }
  P.cyl('greyDeep', [sv.x, sv.y, -(zp + 0.06)], [sv.x, sv.y, zp + 0.06], 0.12, 8);
}
