import type { CraneSpec } from '../../crane/cranes';
import { COUNTER_JIB, PEAK_H, TOWER_BASE_DY, towerGeom } from '../../crane/tower';
import { latticeSegs, type P3, type Seg } from './lattice';

// Grúa torre de la SK 60 (fase 8), sin three.js: piezas en el marco de la superestructura (origen en el centro de
// giro a la altura del suelo del chasis, x = dirección del giro, y arriba, −z izquierda), con la geometría de
// towerGeom() de la referencia y el dibujo de craneModel() (torre de celosía de 1,9 m, pluma de 1,4 × 0,7 m,
// contrapluma de 9 m con 3 bloques de lastre, cúspide de 6 m con tirantes, carro, cabina en la base).
//
// Ajustes al dibujo de la referencia (aproximación visual; la física y la estabilidad usan towerGeom tal cual):
// - La torre va articulada en su cordón inferior (delantero de pie): la celosía queda del lado de nd (arriba tumbada,
//   detrás de pie), no centrada en el eje; así tumbada no atraviesa la cubierta.
// - La pluma plegada va del otro lado del eje (debajo de la torre tumbada, delante de pie) y al desplegarse no cruza
//   la torre. Mientras la torre está tumbada todo se dibuja hasta 0,85 m más alto (se anula al levantarla) para que la
//   pluma plegada quede sobre la cubierta y la cabina del conductor.
// - La pluma se alarga al desplegarse más tarde que en la referencia (jlVis de towerGeom).
// - La contrapluma (en la referencia sale 9 m hacia delante de la torre tumbada) se pliega sobre la torre y se
//   despliega con la pluma; va articulada 2 m detrás de la punta de la torre.

/** Media anchura de la torre (exterior) y del tramo telescópico interior */
export const MAST_HALF = 0.95;
export const INNER_HALF = 0.75;
/** Pluma: media anchura y medio alto */
export const JIB_HW = 0.7;
export const JIB_HH = 0.35;
/** Contrapluma: medio alto y separación de su articulación detrás de la torre */
export const CJIB_HH = 0.4;
export const CJIB_GAP = 0.1;
/** Lo que se levanta el dibujo con la torre tumbada (se anula al levantarla) */
export const TRANSPORT_DY = 0.85;

type V2 = [number, number];
const v3 = (p: V2, z = 0): P3 => [p[0], p[1], z];
const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const ang2 = (a: number): V2 => [Math.cos(a), Math.sin(a)];

/** Caja orientada: centro, eje x (unitario, en el plano x-y), medidas a lo largo de x, de la normal y lateral */
export interface OBox { c: P3; ax: V2; size: P3; color: 'mast' | 'dark' | 'trolley' | 'tie' }
/**
 * Media placa de lastre de la contrapluma (fase 8B): como OBox (eje x = a lo largo de la contrapluma, hacia su extremo),
 * mitad side = +1 (+z) o −1, con la esquina exterior del extremo achaflanada (estilo de contrapeso-torres.png).
 */
export interface OPlate { c: P3; ax: V2; size: P3; side: 1 | -1; color: 'grey' | 'top' }

export interface TowerParts {
  chords: Seg[];
  diags: Seg[];
  boxes: OBox[];
  plates: OPlate[];
  /** Punta de la torre, dirección y largo de la pluma (para las pruebas) */
  top: V2;
  jd: V2;
  jl: number;
}

/** Bisagra de la torre en el marco de la superestructura (ver TRANSPORT_DY) */
export const towerBaseY = (T: CraneSpec, p1: number) => T.deckHi + TOWER_BASE_DY + TRANSPORT_DY * (1 - p1);

/**
 * Celosía en el plano de giro: origen o, eje u (unitario), normal n; sección rectangular de medias medidas hn
 * (normal) y hz (lateral) con el centro desplazado `off` a lo largo de n; cordones de d0 a d1.
 */
function lattice(out: TowerParts, o: V2, u: V2, n: V2, off: number, hn: number, hz: number, d0: number, d1: number,
  bay: number, rc: number, rd: number) {
  const L = latticeSegs({ d0, d1, hw: () => 1, bay, stop: d1 - bay * 0.3, rChord: rc, rDiag: rd });
  const map = (p: P3): P3 => {
    const q = add(add(o, u, p[0]), n, off + p[1] * hn);
    return [q[0], q[1], p[2] * hz];
  };
  for (const s of L.chords) out.chords.push({ a: map(s.a), b: map(s.b), r: s.r });
  for (const s of L.diags) out.diags.push({ a: map(s.a), b: map(s.b), r: s.r });
}

const box = (out: TowerParts, c: V2, ax: V2, size: P3, color: OBox['color'], z = 0) => out.boxes.push({ c: v3(c, z), ax, size, color });

/** Barra delgada de a a b (tirantes) */
function tie(out: TowerParts, a: V2, b: V2, r: number) {
  const d = [b[0] - a[0], b[1] - a[1]] as V2, len = Math.hypot(d[0], d[1]);
  if (len < 1e-6) return;
  box(out, add(a, d, 0.5), [d[0] / len, d[1] / len], [len, r, r], 'tie');
}

/** Piezas móviles de la torre con el avance er, el ángulo de la pluma y el carro en Lb. */
export function towerParts(T: CraneSpec, er: number, ang: number, Lb: number): TowerParts {
  const tw = T.tower!, g = towerGeom(T, { er, ang, slew: 0 });
  const tA = (g.p1 * Math.PI) / 2;
  const dir = ang2(tA), nd: V2 = [-dir[1], dir[0]]; // nd: arriba con la torre tumbada, atrás de pie
  const base: V2 = [0, towerBaseY(T, g.p1)];
  const top = add(base, dir, g.hgt);
  const out: TowerParts = { chords: [], diags: [], boxes: [], plates: [], top, jd: [0, 0], jl: 0 };

  // torre: tramo exterior (H0) e interior que sale al telescopar (aprox. visual: con H = 2·H0 no puede solaparse;
  // montada, el interior empieza justo encima del exterior)
  // (los cordones empiezan 5 cm sobre la bisagra: de pie se apoyan en la plataforma sin tocarla)
  lattice(out, base, dir, nd, MAST_HALF, MAST_HALF, MAST_HALF, 0.05, tw.H0, 1.9, 0.09, 0.045);
  const inner = tw.H0 - 0.05;
  lattice(out, base, dir, nd, MAST_HALF, INNER_HALF, INNER_HALF, g.hgt - inner, g.hgt, 1.5, 0.08, 0.04);
  // cabezal en la punta de la torre
  box(out, add(add(top, dir, -0.5), nd, MAST_HALF), dir, [1.0, 2 * MAST_HALF, 2 * MAST_HALF], 'dark');

  // pluma: del lado contrario a la torre (normal nj), del cabezal hacia jd
  const jd = ang2(g.phi), nj: V2 = [-jd[1], jd[0]];
  const jl = g.jlVis;
  out.jd = jd;
  out.jl = jl;
  lattice(out, top, jd, nj, JIB_HH, JIB_HH, JIB_HW, 0, jl, 1.4, 0.07, 0.035);
  // carro bajo la pluma (con la torre montada)
  if (g.ready) box(out, add(add(top, jd, Lb), nj, -0.2), jd, [0.9, 0.35, 1.1], 'trolley');

  // contrapluma: articulada detrás del cabezal; se pliega sobre la torre y se despliega con la pluma (−jd al final)
  const psi = tA + Math.PI + (ang - tA) * g.p3;
  const cd = ang2(psi), nc: V2 = [cd[1], -cd[0]];
  const hinge = add(top, nd, 2 * MAST_HALF + CJIB_GAP);
  lattice(out, hinge, cd, nc, CJIB_HH, CJIB_HH, JIB_HW, 0, COUNTER_JIB, 1.2, 0.07, 0.035);
  // lastre: 3 placas de 0,55 × 1,2 × 1,6 m (referencia: 3 bloques), cada una en dos mitades achaflanadas; la del extremo
  // en el color de la grúa
  for (let i = 0; i < 3; i++) {
    const c = add(add(hinge, cd, 7.2 + i * 0.6), nc, 0.6);
    for (const side of [1, -1] as const) out.plates.push({ c: v3(c, side * 0.4), ax: cd, size: [0.55, 1.2, 0.8], side, color: i === 2 ? 'top' : 'grey' });
  }

  // cúspide (sale al desplegar la pluma) y tirantes a la pluma y a la contrapluma
  if (g.p3 > 0.01) {
    const p0 = add(top, nd, MAST_HALF), peak = add(p0, dir, PEAK_H * g.p3);
    box(out, add(p0, dir, (PEAK_H * g.p3) / 2), dir, [PEAK_H * g.p3, 0.5, 0.5], 'mast');
    tie(out, peak, add(add(top, jd, 0.55 * jl), nj, 2 * JIB_HH), 0.07);
    tie(out, peak, add(add(hinge, cd, COUNTER_JIB), nc, 2 * CJIB_HH), 0.07);
  }
  return out;
}

/** Piezas fijas de la superestructura de la torre (corona, plataforma, cabina del operador), marco de la superestructura. */
export function towerDeck(T: CraneSpec) {
  const yd = T.deckHi;
  return {
    ring: { r: 1.5, y0: yd, y1: yd + 0.35 },
    // plataforma: bajo la torre de pie (que va de x = −1,9 a 0) y bajo la cabina
    platform: { x0: -2.1, x1: 2.9, y0: yd + 0.35, y1: yd + TOWER_BASE_DY, z0: -2.1, z1: 1.25 },
    // cabina del operador a la izquierda, por fuera de la torre tumbada (referencia: x 1,5–2,9, 1,0–2,1 m de lado)
    cab: { x0: 1.5, x1: 2.9, y0: yd + TOWER_BASE_DY, y1: yd + 2.3, z0: -2.1, z1: -(MAST_HALF + 0.1) },
    // (fase 8B, aproximación visual) armario eléctrico colgado del costado derecho de la plataforma y barandilla en
    // ese borde; todo a |z| > MAST_HALF + 0,1: la torre, la pluma y la contrapluma plegadas no pasan de MAST_HALF
    cabinet: { x0: 0.4, x1: 1.4, y0: yd + 0.15, y1: yd + 1.4, z0: 1.25, z1: 1.55 },
    rail: { x0: 0.15, x1: 2.8, z: 1.17, y: yd + TOWER_BASE_DY },
  };
}

/** Caja envolvente de la torre plegada en el marco del chasis (choques al conducir: sobresale por delante). */
export function foldedTowerBox(T: CraneSpec) {
  const y0 = towerBaseY(T, 0);
  return { x0: T.piv + 1.5, x1: T.piv + T.tower!.H0, y0: y0 - 2 * JIB_HH, y1: y0 + 2 * MAST_HALF + CJIB_GAP + 1.2, hz: MAST_HALF };
}
