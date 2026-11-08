import * as THREE from 'three';
import type { WheeledSpec } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';

// Modelo simplificado (cajas y cilindros). Las cotas principales vienen de la referencia
// (chasis, ejes, llantas, centro de giro, pie de pluma, contrapeso, pluma). Cabinas,
// anchura de llanta, número de tramos y cilindro de elevación son aproximaciones visuales.

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);

const TELE_N = 3; // tramos telescópicos además del base
const SECTION_LEN = 10;

const _base = new THREE.Vector3();
const _top = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

export class CraneModel {
  readonly root = new THREE.Group();
  private sup = new THREE.Group();
  private boom = new THREE.Group();
  private sections: THREE.Mesh[] = [];
  private head = new THREE.Group();
  private luffBarrel: THREE.Mesh;
  private luffRod: THREE.Mesh;

  constructor(private T: WheeledSpec) {
    const yellow = new THREE.MeshLambertMaterial({ color: T.color });
    const yellowDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(T.color).multiplyScalar(0.8) });
    const dark = new THREE.MeshLambertMaterial({ color: '#34393f' });
    const steel = new THREE.MeshLambertMaterial({ color: '#8b9299' });
    const tire = new THREE.MeshLambertMaterial({ color: '#1d1f22' });
    const glass = new THREE.MeshLambertMaterial({ color: '#2b4a63' });

    const add = (parent: THREE.Object3D, mat: THREE.Material,
      x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const m = new THREE.Mesh(box, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.scale.set(x1 - x0, y1 - y0, z1 - z0);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // --- Chasis (portador). +x = frente, -z = izquierda ---
    const [L0, L1] = T.len, hf = T.half;
    const wheelW = 0.6;
    const wz = hf - wheelW / 2;
    add(this.root, dark, L0 + 0.3, L1 - 0.3, T.deckLo, T.deckHi - 0.45, -0.6, 0.6); // bastidor
    add(this.root, yellow, L0, L1, T.deckHi - 0.45, T.deckHi, -hf, hf); // plataforma / guardabarros
    // cabina del conductor: delante a la izquierda, baja para que la pluma descanse encima
    add(this.root, yellow, L1 - 2.05, L1, 1.0, 2.2, -hf, -0.15);
    add(this.root, glass, L1 - 0.02, L1 + 0.01, 1.45, 2.1, -hf + 0.1, -0.25);
    // cajas de estabilizadores (sin animar en la fase 0)
    for (const x of [T.axles[1] - 1.4, T.axles[2] - 1.2]) add(this.root, dark, x - 0.3, x + 0.3, T.deckLo, T.deckHi - 0.45, -hf, hf);

    // Llantas con instancing (3 ejes × 2 lados)
    const nW = T.axles.length * 2;
    const wheels = new THREE.InstancedMesh(cyl, tire, nW);
    const hubs = new THREE.InstancedMesh(cyl, steel, nW);
    wheels.castShadow = wheels.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    let i = 0;
    for (const ax of T.axles) for (const side of [-1, 1]) {
      m4.compose(new THREE.Vector3(ax, T.wheelR, side * wz), q, new THREE.Vector3(T.wheelR, wheelW, T.wheelR));
      wheels.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(ax, T.wheelR, side * (wz + 0.02)), q, new THREE.Vector3(T.wheelR * 0.5, wheelW, T.wheelR * 0.5));
      hubs.setMatrixAt(i, m4);
      i++;
    }
    this.root.add(wheels, hubs);

    // --- Superestructura (gira en x = piv) ---
    this.sup.position.set(T.piv, 0, 0);
    this.root.add(this.sup);
    const yd = T.deckHi;
    const ring = new THREE.Mesh(cyl, steel);
    ring.position.set(0, yd + 0.1, 0);
    ring.scale.set(1.2, 0.2, 1.2);
    this.sup.add(ring);
    add(this.sup, yellow, T.foot - 0.9, 1.3, yd + 0.2, yd + 0.85, -1.15, 1.15); // plataforma giratoria
    // contrapeso: x = xCw y largo cwLen de la referencia; ancho 1,45 y alto 1,7 son los valores por defecto de cwDims()
    add(this.sup, dark, T.xCw - T.cwLen / 2, T.xCw + T.cwLen / 2, yd + 0.2, yd + 1.9, -0.725, 0.725);
    // soportes del pie de pluma
    for (const s of [-1, 1]) add(this.sup, yellowDark, T.foot - 0.6, T.foot + 1.4, yd + 0.85, T.pivH + 0.35, s * 0.55, s * 0.75);
    const pin = new THREE.Mesh(cyl, steel);
    pin.position.set(T.foot, T.pivH, 0);
    pin.rotation.x = Math.PI / 2;
    pin.scale.set(0.16, 1.6, 0.16);
    this.sup.add(pin);
    // cabina del operador, a la izquierda de la pluma
    add(this.sup, yellow, -0.2, 1.6, yd + 0.85, yd + 2.4, -1.25, -0.8);
    add(this.sup, glass, 1.6, 1.62, yd + 1.3, yd + 2.3, -1.2, -0.85);

    // cilindro de elevación (se orienta en cada cuadro)
    this.luffBarrel = new THREE.Mesh(cyl, dark);
    this.luffRod = new THREE.Mesh(cyl, steel);
    this.luffBarrel.castShadow = this.luffRod.castShadow = true;
    this.sup.add(this.luffBarrel, this.luffRod);

    // --- Pluma telescópica ---
    this.boom.position.set(T.foot, T.pivH, 0);
    this.sup.add(this.boom);
    for (let s = 0; s <= TELE_N; s++) {
      const m = new THREE.Mesh(box, s % 2 ? yellowDark : yellow);
      m.castShadow = m.receiveShadow = true;
      m.scale.set(1, T.boom.w * 1.2 - 0.12 * s, T.boom.w - 0.1 * s);
      this.boom.add(m);
      this.sections.push(m);
    }
    add(this.head, yellowDark, -0.7, 0.25, -0.4, 0.35, -0.3, 0.3);
    const sheave = new THREE.Mesh(cyl, steel);
    sheave.rotation.x = Math.PI / 2;
    sheave.scale.set(0.38, 0.4, 0.38);
    this.head.add(sheave);
    this.boom.add(this.head);
  }

  update(S: CraneState) {
    const T = this.T;
    this.sup.rotation.y = S.slew;
    this.boom.rotation.z = S.ang;

    // Tramos: el base fijo; los interiores se reparten la extensión por igual.
    const e = S.Lb - T.boom.min;
    for (let s = 0; s <= TELE_N; s++) {
      let a: number, b: number;
      if (s === 0) { a = -0.8; b = T.boom.min - 0.25 * TELE_N; }
      else { b = T.boom.min - 0.25 * (TELE_N - s) + (e * s) / TELE_N; a = b - SECTION_LEN; }
      const m = this.sections[s];
      m.position.x = (a + b) / 2;
      m.scale.x = b - a;
    }
    this.head.position.x = S.Lb;

    // Cilindro de elevación: de la plataforma a 4,2 m del pie de pluma.
    _base.set(0.9, T.deckHi + 0.6, 0);
    const c = Math.cos(S.ang), s = Math.sin(S.ang), bx = 4.2, by = -0.55;
    _top.set(T.foot + bx * c - by * s, T.pivH + bx * s + by * c, 0);
    _dir.subVectors(_top, _base);
    const len = _dir.length();
    _dir.normalize();
    _q.setFromUnitVectors(_up, _dir);
    const barrelLen = Math.min(3.0, len);
    this.luffBarrel.quaternion.copy(_q);
    this.luffBarrel.scale.set(0.2, barrelLen, 0.2);
    this.luffBarrel.position.copy(_base).addScaledVector(_dir, barrelLen / 2);
    this.luffRod.quaternion.copy(_q);
    this.luffRod.scale.set(0.11, len, 0.11);
    this.luffRod.position.copy(_base).addScaledVector(_dir, len / 2);
  }
}
