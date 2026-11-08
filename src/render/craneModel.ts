import * as THREE from 'three';
import type { WheeledSpec } from '../crane/cranes';
import { carrierLift, type CraneState } from '../crane/kinematics';
import { suspensionPose, type Pose } from '../crane/pose';
import { axleSteer } from '../crane/drive';

// Modelo simplificado (cajas y cilindros). Las cotas principales vienen de la referencia
// (chasis, ejes, llantas, centro de giro, pie de pluma, contrapeso, pluma). Cabinas,
// anchura de llanta, número de tramos y cilindro de elevación son aproximaciones visuales.

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
// buje hexagonal: así se ve girar la rueda
const hex = new THREE.CylinderGeometry(1, 1, 1, 6);
const WHEEL_BASE_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _qs = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const TELE_N = 3; // tramos telescópicos además del base
const SECTION_LEN = 10;

const _base = new THREE.Vector3();
const _top = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q0 = new THREE.Quaternion();

export class CraneModel {
  readonly root = new THREE.Group();
  private sup = new THREE.Group();
  private boom = new THREE.Group();
  private sections: THREE.Mesh[] = [];
  private head = new THREE.Group();
  private luffBarrel: THREE.Mesh;
  private luffRod: THREE.Mesh;
  // Estabilizadores (4 esquinas): viga, cilindro del gato, vástago y zapata
  private outBeam: THREE.InstancedMesh;
  private outJack: THREE.InstancedMesh;
  private outRod: THREE.InstancedMesh;
  private outPad: THREE.InstancedMesh;
  private padMat: THREE.MeshLambertMaterial;
  // Llantas: en un grupo que deshace la suspensión (el chasis se balancea, las ruedas no)
  private wheelGroup = new THREE.Group();
  private wheels: THREE.InstancedMesh;
  private hubs: THREE.InstancedMesh;
  private wheelW = 0.6;
  /** Cabina del conductor: se oculta en la vista de cabina */
  readonly cab: THREE.Object3D[] = [];

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
    add(this.root, dark, L0 + 0.3, L1 - 0.3, T.deckLo, T.deckHi - 0.45, -0.6, 0.6); // bastidor
    add(this.root, yellow, L0, L1, T.deckHi - 0.45, T.deckHi, -hf, hf); // plataforma / guardabarros
    // cabina del conductor: delante a la izquierda, baja para que la pluma descanse encima
    this.cab.push(
      add(this.root, yellow, L1 - 2.05, L1, 1.0, 2.2, -hf, -0.15),
      add(this.root, glass, L1 - 0.02, L1 + 0.01, 1.45, 2.1, -hf + 0.1, -0.25),
    );
    // cajas de estabilizadores en out.xf / out.xr (como la referencia), con franjas de advertencia
    const stripes = new THREE.MeshLambertMaterial({ map: stripeTexture() });
    for (const x of [T.out.xf, T.out.xr]) {
      add(this.root, dark, x - 0.55, x + 0.55, T.deckLo + 0.05, T.deckLo + 1.1, -hf - 0.04, hf + 0.04);
      add(this.root, stripes, x - 0.5, x + 0.5, T.deckLo + 0.2, T.deckLo + 0.95, -hf - 0.06, hf + 0.06);
    }
    // piezas móviles de los estabilizadores (se colocan en update)
    const chrome = new THREE.MeshLambertMaterial({ color: '#c9ced3' });
    this.padMat = new THREE.MeshLambertMaterial({ color: '#7d858f' });
    this.outBeam = new THREE.InstancedMesh(box, steel, 4);
    this.outJack = new THREE.InstancedMesh(cyl, dark, 4);
    this.outRod = new THREE.InstancedMesh(cyl, chrome, 4);
    this.outPad = new THREE.InstancedMesh(cyl, this.padMat, 4);
    for (const m of [this.outBeam, this.outJack, this.outRod, this.outPad]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
    }

    // Llantas con instancing (ejes × 2 lados); se orientan y giran en update()
    const nW = T.axles.length * 2;
    this.wheels = new THREE.InstancedMesh(cyl, tire, nW);
    this.hubs = new THREE.InstancedMesh(hex, steel, nW);
    this.wheels.castShadow = this.wheels.receiveShadow = true;
    for (const m of [this.wheels, this.hubs]) { m.frustumCulled = false; this.wheelGroup.add(m); }
    this.root.add(this.wheelGroup);

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

  /** pose = pose del portador (elevación por estabilizadores, inclinación o cuerpo volcado de Rapier) */
  update(S: CraneState, pose: Pose) {
    const T = this.T;
    this.root.position.set(pose.t.x, pose.t.y, pose.t.z);
    this.root.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    this.updateOutriggers(S);
    this.updateWheels(S);
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

  /** Ruedas: dirección por eje (como la referencia), giro según lo recorrido y sin el balanceo del chasis. */
  private updateWheels(S: CraneState) {
    const T = this.T, w = this.wheelW, wz = T.half - w / 2;
    const sp = suspensionPose(S); // el grupo aplica la inversa de la suspensión
    _qs.set(sp.q.x, sp.q.y, sp.q.z, sp.q.w).invert();
    this.wheelGroup.quaternion.copy(_qs);
    this.wheelGroup.position.set(-sp.t.x, -sp.t.y, -sp.t.z).applyQuaternion(_qs);
    const spin = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -S.spin);
    let i = 0;
    for (const ax of T.axles) {
      _qw.setFromAxisAngle(Y_AXIS, axleSteer(T, ax, S.steer)).multiply(spin).multiply(WHEEL_BASE_Q);
      for (const side of [-1, 1]) {
        _m4.compose(_p.set(ax, T.wheelR, side * wz), _qw, _s.set(T.wheelR, w, T.wheelR));
        this.wheels.setMatrixAt(i, _m4);
        _m4.compose(_p.set(ax, T.wheelR, side * (wz + 0.02)), _qw, _s.set(T.wheelR * 0.5, w, T.wheelR * 0.5));
        this.hubs.setMatrixAt(i, _m4);
        i++;
      }
    }
    this.wheels.instanceMatrix.needsUpdate = this.hubs.instanceMatrix.needsUpdate = true;
  }

  /**
   * Como el dibujo de la referencia: en la primera parte (outS·1,6) salen las vigas, luego bajan los gatos;
   * con outS > 0,5 las zapatas están en el suelo y el chasis sube (carrierLift). Coordenadas del chasis:
   * el suelo está en y = −lift.
   */
  private updateOutriggers(S: CraneState) {
    const T = this.T, o = T.out, hf = T.half, dLo = T.deckLo;
    const e = Math.min(1, S.out * 1.6);
    const ground = -carrierLift(S);
    const padY = S.out >= 0.5 ? ground : dLo * 0.8 * (1 - S.out / 0.5);
    this.padMat.color.set(S.out >= 1 ? '#f2b632' : '#7d858f');
    _q0.identity();
    let i = 0;
    for (const x of [o.xf, o.xr]) for (const s of [-1, 1]) {
      const z = s * (hf + 0.3 + (o.hw - hf - 0.3) * e); // eje del gato
      // viga: del cajón al gato
      const z0 = s * (hf - 0.2);
      _m4.compose(_p.set(x, dLo + 0.6, (z0 + z) / 2), _q0, _s.set(0.56, 0.5, Math.abs(z - z0)));
      this.outBeam.setMatrixAt(i, _m4);
      _m4.compose(_p.set(x, dLo + 0.75, z), _q0, _s.set(0.3, 1.0, 0.3));
      this.outJack.setMatrixAt(i, _m4);
      const r0 = padY + 0.2, r1 = dLo + 0.3;
      _m4.compose(_p.set(x, (r0 + r1) / 2, z), _q0, _s.set(0.16, Math.max(0.01, r1 - r0), 0.16));
      this.outRod.setMatrixAt(i, _m4);
      const pr = 0.46 + 0.26 * e;
      _m4.compose(_p.set(x, padY + 0.1, z), _q0, _s.set(pr, 0.2, pr));
      this.outPad.setMatrixAt(i, _m4);
      i++;
    }
    for (const m of [this.outBeam, this.outJack, this.outRod, this.outPad]) m.instanceMatrix.needsUpdate = true;
  }
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#1d2125' : '#f2b632'; g.fillRect(i * 16, 0, 16, 16); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
