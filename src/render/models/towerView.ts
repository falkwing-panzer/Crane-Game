import * as THREE from 'three';
import type { CraneSpec } from '../../crane/cranes';
import { Parts } from './builder';
import { ladder, operatorCab, railing } from './details';
import { lit, type Palette } from './materials';
import { towerDeck, towerParts, type OBox } from './tower';
import { plateColors, plateGeo } from './plates';
import type { Seg } from './lattice';

// Dibujo de la grúa torre de la SK 60 (fase 8) en el grupo de la superestructura: piezas fijas fusionadas
// (corona, plataforma, cabina del operador) y la parte móvil en 3 InstancedMesh (cordones, diagonales, cajas:
// cabezal, carro, bloques de lastre, cúspide y tirantes), recolocados solo cuando cambian el montaje, el ángulo
// de la pluma o el carro.

const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();
const _qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const MAX_SEGS = 900;
const MAX_BOXES = 16;

export class TowerView {
  private chords: THREE.InstancedMesh;
  private diags: THREE.InstancedMesh;
  private boxes: THREE.InstancedMesh;
  /** Placas de lastre de la contrapluma (achaflanadas, fase 8B) */
  private plates: THREE.InstancedMesh;
  private plateCol: Record<'grey' | 'top', string>;
  private key = '';
  private colors: Record<OBox['color'], string>;
  /** Cabina del operador (se oculta en su vista) */
  readonly cab: THREE.Mesh[] = [];

  constructor(parent: THREE.Object3D, private T: CraneSpec, pal: Palette) {
    const d = towerDeck(T), p = new Parts();
    p.cyl('greyDark', [0, d.ring.y0, 0], [0, d.ring.y1, 0], d.ring.r, 20);
    const pl = d.platform;
    p.box('dark', pl.x0, pl.x1, pl.y0, pl.y1, pl.z0, pl.z1);
    // articulación de la torre: dos orejetas a los lados de la bisagra
    for (const s of [-1, 1]) p.box('greyDeep', -0.35, 0.35, pl.y1, pl.y1 + 0.5, s * 0.97, s * 1.15);
    // armario eléctrico con dos puertas y asas, barandilla en el borde derecho y escalerilla (fase 8B)
    const k = d.cabinet, km = (k.x0 + k.x1) / 2;
    p.box('dark', k.x0, k.x1, k.y0, k.y1, k.z0, k.z1);
    for (const [a0, a1] of [[k.x0 + 0.05, km - 0.02], [km + 0.02, k.x1 - 0.05]]) {
      p.box('greyDark', a0, a1, k.y0 + 0.08, k.y1 - 0.08, k.z1, k.z1 + 0.015);
      p.box('greyDeep', (a0 + a1) / 2 - 0.03, (a0 + a1) / 2 + 0.03, (k.y0 + k.y1) / 2 - 0.1, (k.y0 + k.y1) / 2 + 0.1, k.z1 + 0.015, k.z1 + 0.04);
    }
    const r = d.rail;
    railing(p, 'dark', [[r.x0, r.z], [r.x1, r.z]], r.y, 0.9);
    ladder(p, 'dark', [2.2, pl.z1 + 0.05], [2.6, pl.z1 + 0.05], T.deckHi + 0.15, pl.y1);
    p.build(parent, pal);
    const c = d.cab, cp = new Parts();
    operatorCab(cp, c, -1, false); // cabina con frente inclinado (fase 8B), sin rotativo: la torre tumbada pasa encima
    this.cab.push(...cp.build(parent, pal));

    this.chords = new THREE.InstancedMesh(cyl, pal.yellow, MAX_SEGS);
    this.diags = new THREE.InstancedMesh(cyl, pal.yellowDark, MAX_SEGS);
    this.boxes = new THREE.InstancedMesh(boxG, lit({ color: '#ffffff' }), MAX_BOXES);
    this.plates = new THREE.InstancedMesh(plateGeo, lit({ color: '#ffffff' }), 6);
    const pc = plateColors(T);
    this.plateCol = { grey: pc.grey, top: pc.top };
    for (const m of [this.chords, this.diags, this.boxes, this.plates]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      parent.add(m);
    }
    this.colors = { mast: T.color, dark: '#3a3f45', trolley: '#2f353d', tie: '#d6d9dd' };
  }

  update(er: number, ang: number, Lb: number) {
    const key = `${er}|${ang}|${er >= 1 ? Lb : 0}`;
    if (key === this.key) return;
    this.key = key;
    const P = towerParts(this.T, er, ang, Lb);
    this.place(this.chords, P.chords);
    this.place(this.diags, P.diags);
    const b = this.boxes;
    P.boxes.forEach((o, i) => {
      _q.setFromAxisAngle(_z, Math.atan2(o.ax[1], o.ax[0]));
      _m.compose(_p.set(...o.c), _q, _s.set(...o.size));
      b.setMatrixAt(i, _m);
      b.setColorAt(i, _c.set(this.colors[o.color]));
    });
    b.count = P.boxes.length;
    // placas: la geometría tiene el chaflán en (−x, +z); se lleva al extremo (+x) de su lado girándola 180° en z (+z)
    // o en y (−z)
    P.plates.forEach((o, i) => {
      _q.setFromAxisAngle(_z, Math.atan2(o.ax[1], o.ax[0])).multiply(o.side > 0 ? _qz : _qy);
      _m.compose(_p.set(...o.c), _q, _s.set(...o.size));
      this.plates.setMatrixAt(i, _m);
      this.plates.setColorAt(i, _c.set(this.plateCol[o.color]));
    });
    this.plates.count = P.plates.length;
    this.plates.instanceMatrix.needsUpdate = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }

  private place(m: THREE.InstancedMesh, segs: Seg[]) {
    const n = Math.min(MAX_SEGS, segs.length);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      _d.set(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
      const len = _d.length();
      _q.setFromUnitVectors(_up, _d.normalize());
      _m.compose(_p.set((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2), _q, _s.set(s.r, Math.max(0.01, len), s.r));
      m.setMatrixAt(i, _m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }
}
