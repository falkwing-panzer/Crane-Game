import * as THREE from 'three';
import type { WheeledSpec } from '../crane/cranes';
import { carrierLift, type CraneState } from '../crane/kinematics';
import { suspensionPose, type Pose } from '../crane/pose';
import { axleSteer } from '../crane/drive';
import { Parts } from './models/builder';
import { palette } from './models/materials';
import { layout, type Layout } from './models/layout';
import { buildCarrier } from './models/carrier';
import { buildBoomBase, buildHead, buildSection, buildSuper, sectionTip, sheaves, TELE_N } from './models/superstructure';

// Grúa de ruedas (fase 4): el modelo sale de cranes.ts con las fórmulas de craneModel() de la referencia
// (ver models/). Cada grupo rígido (chasis, cabina, superestructura, cada tramo de pluma, cabeza) se fusiona
// por material; llantas y estabilizadores van con InstancedMesh.

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
// buje hexagonal: así se ve girar la rueda
const hex = new THREE.CylinderGeometry(1, 1, 1, 6);
const WHEEL_BASE_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _qs = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qspin = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _o = new THREE.Vector3();
const _q0 = new THREE.Quaternion();

/** Ojo para la vista de cabina, en el marco del chasis: posición y dirección de la mirada. */
export interface Eye { x: number; y: number; z: number; fx: number; fz: number }

export class CraneModel {
  readonly root = new THREE.Group();
  readonly L: Layout;
  private sup = new THREE.Group();
  private boom = new THREE.Group();
  private sections: THREE.Group[] = [];
  private head = new THREE.Group();
  private luffBarrel: THREE.Mesh;
  private luffRod: THREE.Mesh;
  private ropeA: THREE.Mesh;
  private ropeB: THREE.Mesh;
  // Estabilizadores (4 esquinas): viga, cilindro del gato, vástago y zapata
  private outBeam: THREE.InstancedMesh;
  private outJack: THREE.InstancedMesh;
  private outRod: THREE.InstancedMesh;
  private outPad: THREE.InstancedMesh;
  private padMat: THREE.MeshLambertMaterial;
  // Llantas: en un grupo que deshace la suspensión (el chasis se balancea, las ruedas no)
  private wheelGroup = new THREE.Group();
  private tires: THREE.InstancedMesh;
  private rims: THREE.InstancedMesh;
  private hubs: THREE.InstancedMesh;
  /** Piezas que se ocultan en la vista de cabina (la cabina desde la que se mira) */
  readonly cab: THREE.Object3D[] = [];

  constructor(private T: WheeledSpec) {
    const L = (this.L = layout(T));
    const pal = palette(T);

    // --- Chasis y cabina del conductor ---
    const carrier = new Parts(), cabP = new Parts();
    buildCarrier(T, L, carrier, cabP);
    carrier.build(this.root, pal);
    const cabMeshes = cabP.build(this.root, pal);

    // estabilizadores (se colocan en update)
    this.padMat = new THREE.MeshLambertMaterial({ color: '#7d858f' });
    this.outBeam = new THREE.InstancedMesh(box, pal.grey, 4);
    this.outJack = new THREE.InstancedMesh(cyl, pal.greyDeep, 4);
    this.outRod = new THREE.InstancedMesh(cyl, pal.chrome, 4);
    this.outPad = new THREE.InstancedMesh(cyl, this.padMat, 4);
    for (const m of [this.outBeam, this.outJack, this.outRod, this.outPad]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
    }

    // llantas: neumático, llanta (disco exterior) y buje
    const nW = T.axles.length * 2;
    this.tires = new THREE.InstancedMesh(tireGeo, pal.tire, nW);
    this.rims = new THREE.InstancedMesh(cyl, pal.rim, nW);
    this.hubs = new THREE.InstancedMesh(hex, pal.greyDeep, nW);
    this.tires.castShadow = this.tires.receiveShadow = true;
    for (const m of [this.tires, this.rims, this.hubs]) { m.frustumCulled = false; this.wheelGroup.add(m); }
    this.root.add(this.wheelGroup);

    // --- Superestructura (gira en x = piv) ---
    this.sup.position.set(T.piv, 0, 0);
    this.root.add(this.sup);
    const supP = new Parts();
    buildSuper(T, L, supP);
    const supMeshes = supP.build(this.sup, pal);
    // en la RT se conduce desde la cabina de la superestructura: es la que se oculta
    this.cab.push(...(L.noCab ? supMeshes.filter((m) => m.material === pal.cabin || m.material === pal.glass) : cabMeshes));

    // cilindro de elevación y cable de elevación (se orientan en cada cuadro)
    this.luffBarrel = new THREE.Mesh(cyl, pal.greyDeep);
    this.luffRod = new THREE.Mesh(cyl, pal.chrome);
    this.ropeA = new THREE.Mesh(cyl, pal.black);
    this.ropeB = new THREE.Mesh(cyl, pal.black);
    for (const m of [this.luffBarrel, this.luffRod, this.ropeA, this.ropeB]) { m.castShadow = true; this.sup.add(m); }

    // --- Pluma telescópica: tramo base, tramos interiores y cabeza ---
    this.boom.position.set(T.foot, T.pivH, 0);
    this.sup.add(this.boom);
    const base = new Parts();
    buildBoomBase(T, L, base);
    base.build(this.boom, pal);
    for (let k = 1; k <= TELE_N; k++) {
      const g = new THREE.Group(), p = new Parts();
      buildSection(T, L, k, p);
      p.build(g, pal);
      this.boom.add(g);
      this.sections.push(g);
    }
    const hp = new Parts();
    buildHead(T, L, hp);
    hp.build(this.head, pal);
    this.boom.add(this.head);
  }

  /** Ojo del conductor (vista de cabina) en el marco del chasis; en la RT, el del operador, que gira. */
  eye(S: CraneState): Eye {
    const e = this.L.eye;
    if (!this.L.noCab) return { ...e, fx: 1, fz: 0 };
    const c = Math.cos(S.slew), s = Math.sin(S.slew);
    // rotación de three alrededor de y: x' = x·c + z·s, z' = −x·s + z·c
    return { x: this.T.piv + e.x * c + e.z * s, y: e.y, z: -e.x * s + e.z * c, fx: c, fz: -s };
  }

  /** pose = pose del portador (elevación por estabilizadores, inclinación o cuerpo volcado de Rapier) */
  update(S: CraneState, pose: Pose) {
    const T = this.T, L = this.L;
    this.root.position.set(pose.t.x, pose.t.y, pose.t.z);
    this.root.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    this.updateOutriggers(S);
    this.updateWheels(S);
    this.sup.rotation.y = S.slew;
    this.boom.rotation.z = S.ang;
    for (let k = 1; k <= TELE_N; k++) this.sections[k - 1].position.x = sectionTip(T, k, S.Lb);
    this.head.position.x = S.Lb;

    const c = Math.cos(S.ang), s = Math.sin(S.ang);
    const boomPt = (d: number, u: number, v: THREE.Vector3) => v.set(T.foot + d * c - u * s, T.pivH + d * s + u * c, 0);

    // Cilindro de elevación: de la placa base al 45 % del tramo base, bajo la pluma (como la referencia).
    _a.set(L.luffBase.x, L.luffBase.y, 0);
    boomPt(T.boom.min * 0.45, -L.hu / 2, _b);
    this.placeCyl(this.luffBarrel, _a, _b, 0.25 * L.bw, 0, 0.55);
    this.placeCyl(this.luffRod, _a, _b, 0.13 * L.bw, 0.5, 1);

    // Cable de elevación: tambor → sobre el tramo base → poleas de la cabeza
    const sv = sheaves(T, L), d = L.drum;
    _a.set(d.x, d.y + d.r, 0);
    boomPt(1.0, L.hu / 2 + 0.05, _b);
    this.placeCyl(this.ropeA, _a, _b, 0.025, 0, 1);
    boomPt(S.Lb + sv.x, sv.y + sv.r, _o);
    this.placeCyl(this.ropeB, _b, _o, 0.025, 0, 1);
    this.root.updateMatrixWorld();
  }

  /** Eje lateral de la superestructura en el mundo (para repartir los ramales del gancho). */
  lateral(out: THREE.Vector3) {
    return out.setFromMatrixColumn(this.sup.matrixWorld, 2).normalize();
  }

  /** Cilindro de radio r a lo largo de a→b, entre las fracciones t0 y t1 del recorrido. */
  private placeCyl(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number, t0: number, t1: number) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    _dir.normalize();
    m.quaternion.setFromUnitVectors(_up, _dir);
    m.scale.set(r, Math.max(0.01, len * (t1 - t0)), r);
    m.position.copy(a).addScaledVector(_dir, (len * (t0 + t1)) / 2);
  }

  /** Ruedas: dirección por eje (como la referencia), giro según lo recorrido y sin el balanceo del chasis. */
  private updateWheels(S: CraneState) {
    const T = this.T, L = this.L, hw = L.tireHalf, wR = T.wheelR;
    const sp = suspensionPose(S); // el grupo aplica la inversa de la suspensión
    _qs.set(sp.q.x, sp.q.y, sp.q.z, sp.q.w).invert();
    this.wheelGroup.quaternion.copy(_qs);
    this.wheelGroup.position.set(-sp.t.x, -sp.t.y, -sp.t.z).applyQuaternion(_qs);
    _qspin.setFromAxisAngle(Z_AXIS, -S.spin);
    let i = 0;
    for (const ax of T.axles) {
      _qw.setFromAxisAngle(Y_AXIS, axleSteer(T, ax, S.steer)).multiply(_qspin).multiply(WHEEL_BASE_Q);
      for (const side of [-1, 1]) {
        _p.set(ax, wR, side * L.tireZ);
        _m4.compose(_p, _qw, _s.set(wR, 2 * hw, wR));
        this.tires.setMatrixAt(i, _m4);
        // el eje local y del cilindro es el eje de la rueda: hacia fuera = side·y
        _o.set(0, side * (hw - 0.01), 0).applyQuaternion(_qw).add(_p);
        _m4.compose(_o, _qw, _s.set(wR * 0.64, 0.06, wR * 0.64));
        this.rims.setMatrixAt(i, _m4);
        _o.set(0, side * (hw + 0.04), 0).applyQuaternion(_qw).add(_p);
        _m4.compose(_o, _qw, _s.set(wR * 0.26, 0.1, wR * 0.26));
        this.hubs.setMatrixAt(i, _m4);
        i++;
      }
    }
    for (const m of [this.tires, this.rims, this.hubs]) m.instanceMatrix.needsUpdate = true;
  }

  /**
   * Como el dibujo de la referencia: en la primera parte (outS·1,6) salen las vigas, luego bajan los gatos;
   * con outS > 0,5 las zapatas están en el suelo y el chasis sube (carrierLift). Coordenadas del chasis:
   * el suelo está en y = −lift.
   */
  private updateOutriggers(S: CraneState) {
    const T = this.T, o = T.out, hf = this.L.hf, dLo = T.deckLo;
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
