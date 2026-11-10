import * as THREE from 'three';
import type { CraneSpec } from '../../crane/cranes';
import { CHAMFER_X, CHAMFER_Z, type FramePart, type Plate } from './layout';

// Placas de contrapeso instanciadas (fase 7, generalizado en la fase 8B): 2 InstancedMesh por grupo, uno de placas
// achaflanadas y otro de cajas (bastidor, barandilla, argollas, placas rectas), con color por instancia.

/**
 * Placa de 1 × 1 × 1 centrada, con la esquina (−x, +z) achaflanada en planta (CHAMFER_X/Z del largo y del ancho),
 * como las de contrapeso-torres.png. Se escala por instancia.
 */
export const plateGeo = (() => {
  const s = new THREE.Shape();
  // contorno en (x, z): rotateX(90°) lleva (x, y, z) a (x, −z, y), así la y del contorno pasa a ser la z
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5 + CHAMFER_X, 0.5);
  s.lineTo(-0.5, 0.5 - CHAMFER_Z);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // la extrusión (de 0 a 1 en z) pasa a ser el alto (de 0 a −1 en y)
  g.translate(0, 0.5, 0);
  return g;
})();

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();

export type PieceColor = Plate['color'] | FramePart['color'];

/** Colores del contrapeso: gris de las placas, base oscura, las de arriba del color de la grúa */
export const plateColors = (T: CraneSpec): Record<PieceColor, string> =>
  ({ base: '#3a3f45', grey: '#a3a8ad', top: T.color, frame: '#4a5057', rail: '#c9ced3', lug: '#1d2125' });

export class PlateMeshes {
  readonly plates: THREE.InstancedMesh;
  readonly boxes: THREE.InstancedMesh;

  constructor(parent: THREE.Object3D, nPlates: number, nBoxes: number, private colors: Record<PieceColor, string>) {
    this.plates = new THREE.InstancedMesh(plateGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, nPlates));
    this.boxes = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, nBoxes));
    for (const m of [this.plates, this.boxes]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      parent.add(m);
    }
  }

  /** Coloca las placas y las cajas (desplazadas dx en x). */
  set(plates: Plate[], frame: FramePart[], dx = 0) {
    const m = this.plates, f = this.boxes;
    plates.forEach((pl, i) => {
      const b = pl.box;
      // la geometría tiene el chaflán en la esquina (−x, +z); la mitad izquierda se gira 180° alrededor de x
      // (no se refleja: una escala negativa daría la vuelta a las caras)
      _q.setFromAxisAngle(X_AXIS, pl.side > 0 ? 0 : Math.PI);
      _m4.compose(_p.set((b.x0 + b.x1) / 2 + dx, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), _q, _s.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
      m.setMatrixAt(i, _m4);
      m.setColorAt(i, _col.set(this.colors[pl.color]));
    });
    _q.identity();
    frame.forEach((fp, i) => {
      const b = fp.box;
      _m4.compose(_p.set((b.x0 + b.x1) / 2 + dx, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), _q, _s.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
      f.setMatrixAt(i, _m4);
      f.setColorAt(i, _col.set(this.colors[fp.color]));
    });
    m.count = Math.min(plates.length, m.instanceMatrix.count);
    f.count = Math.min(frame.length, f.instanceMatrix.count);
    for (const x of [m, f]) {
      x.instanceMatrix.needsUpdate = true;
      if (x.instanceColor) x.instanceColor.needsUpdate = true;
    }
  }
}
