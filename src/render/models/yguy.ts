import * as THREE from 'three';
import type { Parts, P3 } from './builder';
import type { Layout } from './layout';
import { lit, type Palette } from './materials';

// Arriostramiento en Y (yGuyModel() de la referencia), en el marco de la pluma: x a lo largo de la pluma desde el
// pie, y normal hacia arriba, z lateral. Va montado sobre el tramo base: soporte y mástil fijos; dos brazos que se
// levantan (0–50 %), se abren en V (50–80 %) y tensan los cables (80–100 %), con cabrestantes en las puntas y cables
// hacia la cabeza y hacia el pie del tramo base.

const D = Math.PI / 180;
/** Distancia del pie al mástil y largo de los brazos (referencia) */
const DM = 6.8, LA = 6.9;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (t: number) => t * t * (3 - 2 * t);

export interface Seg { a: P3; b: P3 }
export interface YGuyGeom {
  arms: Seg[];
  braces: Seg[];
  /** Tramos de cable (los que tienen comba van en dos tramos) y si están flojos */
  ropes: (Seg & { slack: boolean; thin?: boolean })[];
  /** Centros de los cabrestantes de las puntas */
  winches: P3[];
}

/** Parte superior de la pluma (la referencia usa ancho/2; aquí el alto del tramo base es 1,25 × ancho). */
const topOf = (L: Pick<Layout, 'hu'>) => L.hu / 2;

/** Soporte y mástil, fijos en el tramo base. */
export function buildYGuyBase(L: Layout, P: Parts) {
  const top = topOf(L);
  for (const s of [-0.55, 0.55]) P.cyl('dark', [DM - 0.9, top, s], [DM + 0.9, top, s], 0.17, 8);
  P.cyl('yellowDark', [DM, top, 0], [DM + 0.15, top + 1.3, 0], 0.35, 12);
}

/** Geometría móvil para el avance yg, con la pluma a largo Lb y ángulo ang (para la comba hacia abajo). */
export function yGuyGeom(L: Pick<Layout, 'hu'>, yg: number, Lb: number, ang: number): YGuyGeom {
  const top = topOf(L);
  const pA = ease(clamp(yg / 0.5, 0, 1)), pB = ease(clamp((yg - 0.5) / 0.3, 0, 1)), pC = clamp((yg - 0.8) / 0.2, 0, 1);
  const al = (8 + 87 * pA) * D, be = 31 * pB * D;
  // "abajo" del mundo en el marco de la pluma (la comba cuelga hacia el suelo)
  const down: P3 = [-Math.sin(ang), -Math.cos(ang), 0];
  const g: YGuyGeom = { arms: [], braces: [], ropes: [], winches: [] };
  const rope = (a: P3, b: P3, sag: number, thin = false) => {
    const slack = yg < 1; // (con yg = 1, pC da 0,9999… por redondeo)
    if (sag <= 0.02) { g.ropes.push({ a, b, slack, thin }); return; }
    const m: P3 = [(a[0] + b[0]) / 2 + down[0] * sag * 1.2, (a[1] + b[1]) / 2 + down[1] * sag * 1.2, (a[2] + b[2]) / 2];
    g.ropes.push({ a, b: m, slack, thin }, { a: m, b, slack, thin });
  };
  const tips: P3[] = [];
  for (const sg of [-1, 1]) {
    const r0: P3 = [DM + 0.15, top + 1.3, sg * 0.35];
    const dir: P3 = [-Math.cos(al) * Math.cos(be), Math.sin(al) * Math.cos(be), sg * Math.sin(be)];
    const at = (k: number): P3 => [r0[0] + dir[0] * k, r0[1] + dir[1] * k, r0[2] + dir[2] * k];
    const tip = at(LA), mid = at(LA * 0.45);
    tips.push(tip);
    g.arms.push({ a: r0, b: tip });
    // cilindros hidráulicos de elevación y apertura
    g.braces.push({ a: [DM - 1.6, top, sg * 0.6], b: mid }, { a: [DM + 1.6, top, sg * 0.6], b: mid });
    // cables: punta del brazo → cabeza de la pluma y → pie del tramo base (con comba hasta tensar)
    const sag = 1.6 * (1 - pC) * (0.3 + 0.7 * pA);
    // (la referencia lo ata 1,1 m detrás de la cabeza; con la pluma recogida eso queda dentro del tramo base:
    // aquí va a lo alto de las chapas laterales de la cabeza)
    rope(tip, [Lb + 0.1, 0.8 * top, sg * 0.35], sag);
    rope(tip, [1.4, top, sg * 0.6], sag * 0.6);
    g.winches.push(tip);
  }
  if (pB > 0.05) rope(tips[0], tips[1], 0.5 * (1 - pC), true);
  return g;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const box = new THREE.BoxGeometry(1, 1, 1);
/** Tramos de cable como máximo: 4 cables con comba (2 tramos) + el cable entre puntas */
const MAX_ROPES = 10;

/** Piezas móviles del Y-guy con InstancedMesh (4 draw calls), hijas del grupo de la pluma. */
export class YGuyView {
  private arms: THREE.InstancedMesh;
  private braces: THREE.InstancedMesh;
  private ropes: THREE.InstancedMesh;
  private winches: THREE.InstancedMesh;
  private last = '';

  constructor(parent: THREE.Object3D, private L: Layout, pal: Palette) {
    this.arms = new THREE.InstancedMesh(cyl, pal.yellowDark, 2);
    this.braces = new THREE.InstancedMesh(cyl, pal.chrome, 4);
    this.ropes = new THREE.InstancedMesh(cyl, lit({ color: '#ffffff' }), MAX_ROPES);
    this.winches = new THREE.InstancedMesh(box, pal.greyDeep, 2);
    for (const m of [this.arms, this.braces, this.ropes, this.winches]) {
      m.castShadow = true;
      m.frustumCulled = false;
      parent.add(m);
    }
  }

  update(yg: number, Lb: number, ang: number) {
    // solo se recoloca si algo cambió
    const key = `${yg.toFixed(4)} ${Lb.toFixed(3)} ${ang.toFixed(3)}`;
    if (key === this.last) return;
    this.last = key;
    const g = yGuyGeom(this.L, yg, Lb, ang);
    g.arms.forEach((s, i) => this.place(this.arms, i, s, 0.275));
    g.braces.forEach((s, i) => this.place(this.braces, i, s, 0.11));
    g.ropes.forEach((s, i) => {
      this.place(this.ropes, i, s, s.thin ? 0.04 : 0.06);
      this.ropes.setColorAt(i, _c.set(s.slack ? '#b9bdc2' : '#e6e8eb'));
    });
    this.ropes.count = g.ropes.length;
    g.winches.forEach((p, i) => {
      _m.compose(_p.set(...p), _q0, _s.set(0.8, 0.8, 0.9));
      this.winches.setMatrixAt(i, _m);
    });
    for (const m of [this.arms, this.braces, this.ropes, this.winches]) m.instanceMatrix.needsUpdate = true;
    if (this.ropes.instanceColor) this.ropes.instanceColor.needsUpdate = true;
  }

  private place(m: THREE.InstancedMesh, i: number, s: Seg, r: number) {
    _a.set(...s.a);
    _b.set(...s.b).sub(_a);
    const len = Math.max(0.01, _b.length());
    _q.setFromUnitVectors(_up, _b.normalize());
    _p.copy(_a).addScaledVector(_b, len / 2);
    _m.compose(_p, _q, _s.set(r, len, r));
    m.setMatrixAt(i, _m);
  }
}
