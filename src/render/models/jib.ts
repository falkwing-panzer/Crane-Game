import * as THREE from 'three';
import type { JibDef, WheeledSpec } from '../../crane/cranes';
import type { Seg, P3 } from './lattice';
import type { Layout } from './layout';
import type { Palette } from './materials';
import { Parts } from './builder';

// Plumín abatible de celosía (AT 650-8, fase 7), como el dibujo de craneModel() en la referencia:
// - Montaje (jg de 0 a 1): 5 tramos que aparecen en el suelo delante de la cabeza (hasta 45 %); bulonado a la
//   cabeza y apoyado en el suelo (45 %); puntales que se levantan (60–85 %); tirantes que se tensan (85–100 %).
// - Montado: celosía de 1,5 a 0,9 m desde la cabeza con el ángulo absoluto ang − jibRel, dos puntales (78° y
//   ≥ 100° por encima del plumín) y tirantes punta–puntal delantero–puntal trasero–pluma.
// Cotas en el marco de la superestructura (x hacia la pluma, y arriba, z lateral). La geometría (jibGeom) no usa
// three.js para poder probarla.
// Diferencia con la referencia: el plumín empieza en la cabeza (headPos), no 0,3 m más adelante, para que su punta
// coincida con la de la física y la estabilidad (tipPos).

const D = Math.PI / 180;
/** Ancho de la celosía en la raíz y en la punta (lattice(…, 1,5, 0,9) de la referencia) */
export const JIB_W0 = 1.5;
export const JIB_W1 = 0.9;
/** Tramos en el suelo durante el montaje */
export const JIB_SECTIONS = 5;
const sm = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Barras de la celosía en el marco del plumín (x a lo largo), ordenadas por tramo para poder mostrar solo una parte. */
export function jibLattice(J: number) {
  const bay = Math.max(1.6, JIB_W0 * 1.1);
  const hw = (d: number) => (JIB_W0 + ((JIB_W1 - JIB_W0) * d) / J) / 2;
  const CN: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const P = (d: number, a: number, b: number): P3 => [d, a * hw(d), b * hw(d)];
  const chords: Seg[] = [], diags: Seg[] = [], ends: number[] = [];
  for (let d = 0, i = 0; d < J - 1e-6; d += bay, i++) {
    const d2 = Math.min(J, d + bay), z = i % 2;
    for (let f = 0; f < 4; f++) {
      const [a1, b1] = CN[f], [a2, b2] = CN[(f + 1) % 4];
      chords.push({ a: P(d, a1, b1), b: P(d2, a1, b1), r: 0.07 });
      diags.push({ a: P(d, z ? a1 : a2, z ? b1 : b2), b: P(d2, z ? a2 : a1, z ? b2 : b1), r: 0.035 });
    }
    ends.push(d2);
  }
  return { chords, diags, bay, ends };
}

export interface JibGeom {
  visible: boolean;
  /** Origen del plumín (marco de la superestructura) y ángulo sobre la horizontal */
  at: [number, number];
  angle: number;
  /** Largo de celosía que se ve (los tramos ya colocados en el suelo) */
  shown: number;
  /** Puntales (de la cabeza a cada punta, a ±0,45 m) y tirantes (con comba mientras se tensan) */
  struts: Seg[];
  ties: Seg[];
  /** Punta del plumín (para el cable de elevación), null si todavía no está bulonado */
  tip: P3 | null;
}

/**
 * Geometría del plumín. jg: avance del montaje; ang, Lb, jibRel: estado de la pluma; ground: y del suelo en el marco
 * de la superestructura (−elevación por estabilizadores).
 */
export function jibGeom(T: WheeledSpec, L: Pick<Layout, 'bw'>, jd: JibDef, jg: number, ang: number, Lb: number, jibRel: number, ground: number): JibGeom {
  const J = jd.len;
  const H: [number, number] = [T.foot + Lb * Math.cos(ang), T.pivH + Lb * Math.sin(ang)];
  const empty: JibGeom = { visible: false, at: H, angle: 0, shown: 0, struts: [], ties: [], tip: null };
  if (jg <= 0) return empty;
  const dirAt = (a: number, l: number): [number, number] => [H[0] + Math.cos(a) * l, H[1] + Math.sin(a) * l];
  const yC = ground + JIB_W0 / 2; // eje de la celosía apoyada en el suelo
  if (jg < 0.45) {
    // tramos apoyados en el suelo, delante de la cabeza
    const shown = Math.min(JIB_SECTIONS, Math.ceil(clamp(jg / 0.45, 0, 1) * JIB_SECTIONS)) * (J / JIB_SECTIONS);
    return { ...empty, visible: true, at: [H[0] + 1.5, yC], angle: 0, shown };
  }
  const mounted = jg >= 1;
  // bulonado: de la cabeza al extremo de los tramos en el suelo; montado: el ángulo de la referencia
  const angle = mounted ? ang - jibRel : Math.atan2(yC - H[1], H[0] + 1.5 + J - 1.5 - H[0]);
  const tip = dirAt(angle, J);
  const ps = mounted ? 1 : sm(clamp((jg - 0.6) / 0.25, 0, 1));
  const sF = dirAt(angle + ps * 78 * D, 9);
  const sB = mounted ? dirAt(Math.max(angle + 100 * D, ang + 55 * D), 10.5) : dirAt(angle + ps * 105 * D, 10.5);
  const struts: Seg[] = [];
  for (const z of [-0.45, 0.45]) {
    struts.push({ a: [H[0], H[1], z], b: [sF[0], sF[1], z], r: 0.2 }, { a: [H[0], H[1], z], b: [sB[0], sB[1], z], r: 0.2 });
  }
  const ties: Seg[] = [];
  if (jg >= 0.85) {
    // tirantes con comba (2,5 m) que se tensan; al pie de pluma por encima del tramo base (bp(2, 0,63·ancho))
    const sag = mounted ? 0 : (1 - clamp((jg - 0.85) / 0.15, 0, 1)) * 2.5;
    const c = Math.cos(ang), s = Math.sin(ang), u = L.bw * 0.63;
    const foot: [number, number] = [T.foot + 2 * c - u * s, T.pivH + 2 * s + u * c];
    for (const [a, b] of [[sF, tip], [sB, sF], [sB, foot]] as [number, number][][]) {
      const m: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, 0];
      if (sag > 1e-3) ties.push({ a: [a[0], a[1], 0], b: m, r: 0.04 }, { a: m, b: [b[0], b[1], 0], r: 0.04 });
      else ties.push({ a: [a[0], a[1], 0], b: [b[0], b[1], 0], r: 0.04 });
    }
  }
  return { visible: true, at: H, angle, shown: J, struts, ties, tip: [tip[0], tip[1], 0] };
}

const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
const cylS = new THREE.CylinderGeometry(1, 1, 1, 10);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

function place(m: THREE.InstancedMesh, i: number, g: Seg) {
  _a.set(...g.a);
  _b.set(...g.b).sub(_a);
  const len = Math.max(0.01, _b.length());
  _q.setFromUnitVectors(_up, _b.normalize());
  _m.compose(_p.copy(_a).addScaledVector(_b, len / 2), _q, _s.set(g.r, len, g.r));
  m.setMatrixAt(i, _m);
}

/**
 * Plumín en el grupo de la superestructura: celosía (2 InstancedMesh colocados una vez en su grupo; durante el
 * montaje se ven solo los tramos ya puestos), raíz y poleas de la punta, puntales y tirantes (2 InstancedMesh que
 * se recolocan cuando cambia algo). 6 draw calls con el plumín visible.
 */
export class JibView {
  private group = new THREE.Group();
  private chords: THREE.InstancedMesh;
  private diags: THREE.InstancedMesh;
  private struts: THREE.InstancedMesh;
  private ties: THREE.InstancedMesh;
  private ends: number[];
  /** Raíz y poleas de la punta: solo con el plumín bulonado */
  private fixed: THREE.Mesh[];
  private last = '';
  /** Punta del plumín (marco de la superestructura) o null */
  tip: P3 | null = null;

  constructor(parent: THREE.Object3D, private T: WheeledSpec, private L: Layout, pal: Palette) {
    const jd = T.jibDef!, lat = jibLattice(jd.len);
    this.ends = lat.ends;
    this.chords = new THREE.InstancedMesh(cyl, pal.lattice, lat.chords.length);
    this.diags = new THREE.InstancedMesh(cyl, pal.latticeDiag, lat.diags.length);
    lat.chords.forEach((g, i) => place(this.chords, i, g));
    lat.diags.forEach((g, i) => place(this.diags, i, g));
    // raíz (bulones) y poleas de la punta
    const p = new Parts();
    p.box('yellowShade', 0.2, 1.0, -0.42, 0.42, -0.42, 0.42);
    for (const z of [-0.2, 0, 0.2]) p.cyl('steel', [jd.len, 0, z - 0.05], [jd.len, 0, z + 0.05], 0.45, 14);
    p.cyl('greyDeep', [jd.len, 0, -0.3], [jd.len, 0, 0.3], 0.1, 8);
    this.fixed = p.build(this.group, pal);
    for (const m of [this.chords, this.diags]) { m.castShadow = true; m.computeBoundingSphere(); this.group.add(m); }
    parent.add(this.group);
    this.struts = new THREE.InstancedMesh(cylS, pal.lattice, 4);
    this.ties = new THREE.InstancedMesh(cyl, pal.pendant, 6);
    for (const m of [this.struts, this.ties]) { m.castShadow = true; m.frustumCulled = false; parent.add(m); }
    this.group.visible = this.struts.visible = this.ties.visible = false;
  }

  update(jg: number, ang: number, Lb: number, jibRel: number, ground: number) {
    const key = `${jg.toFixed(4)} ${ang.toFixed(4)} ${Lb.toFixed(3)} ${jibRel.toFixed(4)} ${ground.toFixed(3)}`;
    if (key === this.last) return;
    this.last = key;
    const g = jibGeom(this.T, this.L, this.T.jibDef!, jg, ang, Lb, jibRel, ground);
    this.tip = g.tip;
    this.group.visible = this.struts.visible = this.ties.visible = g.visible;
    if (!g.visible) return;
    for (const m of this.fixed) m.visible = jg >= 0.45;
    this.group.position.set(g.at[0], g.at[1], 0);
    this.group.rotation.z = g.angle;
    // tramos a la vista: 4 barras de cada clase por tramo de la celosía
    const nb = this.ends.filter((e) => e <= g.shown + 1e-6).length;
    this.chords.count = this.diags.count = 4 * nb;
    g.struts.forEach((s, i) => place(this.struts, i, s));
    g.ties.forEach((s, i) => place(this.ties, i, s));
    this.struts.count = g.struts.length;
    this.ties.count = g.ties.length;
    this.struts.instanceMatrix.needsUpdate = this.ties.instanceMatrix.needsUpdate = true;
  }
}
