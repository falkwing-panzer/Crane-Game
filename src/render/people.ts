import * as THREE from 'three';
import { workerGeo } from './decorView';
import { workerAt, EXCL_R, type SiteWorker } from '../levels/people';
import type { Signal } from '../game/signals';

// Gente en la obra (fase 23): trabajadores que caminan (un InstancedMesh, con el círculo de su zona de exclusión en el
// suelo) y el señalero, con los brazos articulados en los hombros para hacer las señales. Solo dibujo.

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

export class WorkersView {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, private workers: SiteWorker[]) {
    this.mesh = new THREE.InstancedMesh(workerGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), workers.length);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.35, depthWrite: false });
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(EXCL_R - 0.15, EXCL_R, 40).rotateX(-Math.PI / 2), this.ringMat, workers.length);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    this.root.add(this.mesh, this.rings);
    this.root.name = 'trabajadores-obra';
    scene.add(this.root);
  }

  /** t = reloj del turno (las reglas usan el mismo); alarm = la carga está encima de alguien */
  update(t: number, alarm: boolean) {
    this.workers.forEach((w, i) => {
      const p = workerAt(w, t);
      const bob = p.moving ? Math.abs(Math.sin(t * 7 + i)) * 0.04 : 0;
      _q.setFromAxisAngle(_up, p.h);
      this.mesh.setMatrixAt(i, _m.compose(_p.set(p.x, bob, p.z), _q, _s));
      this.rings.setMatrixAt(i, _m.compose(_p.set(p.x, 0.03, p.z), _q.identity(), _s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.ringMat.color.setHex(alarm ? 0xff4a3a : 0xf5c542);
    this.ringMat.opacity = alarm ? 0.6 + 0.3 * Math.sin(performance.now() / 90) : 0.35;
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of [this.mesh, this.rings]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); }
  }
}

/** Postura de un brazo: separación lateral y elevación hacia delante (rad) */
interface Arm { abd: number; fwd: number }
const DOWN: Arm = { abd: 0.08, fwd: 0 };
const D = Math.PI / 180;

/** Brazos (derecho, izquierdo) para cada señal; `wave` = cuánto y cómo se mueve */
const POSES: Record<Signal, { r: Arm; l: Arm; wave?: { arm: 'r' | 'l' | 'both'; k: 'abd' | 'fwd'; amp: number; hz: number } }> = {
  sube: { r: { abd: 175 * D, fwd: 0 }, l: DOWN, wave: { arm: 'r', k: 'fwd', amp: 0.18, hz: 2 } },
  baja: { r: { abd: 15 * D, fwd: 25 * D }, l: DOWN, wave: { arm: 'r', k: 'abd', amp: 0.15, hz: 2 } },
  despacio: { r: { abd: 10 * D, fwd: 70 * D }, l: { abd: 10 * D, fwd: 85 * D } },
  giraIzq: { r: DOWN, l: { abd: 90 * D, fwd: 0 }, wave: { arm: 'l', k: 'fwd', amp: 0.12, hz: 1 } },
  giraDer: { r: { abd: 90 * D, fwd: 0 }, l: DOWN, wave: { arm: 'r', k: 'fwd', amp: 0.12, hz: 1 } },
  subePluma: { r: { abd: 90 * D, fwd: 0 }, l: DOWN, wave: { arm: 'r', k: 'abd', amp: 0.2, hz: 1.2 } },
  bajaPluma: { r: { abd: 80 * D, fwd: 0 }, l: DOWN, wave: { arm: 'r', k: 'abd', amp: -0.2, hz: 1.2 } },
  sacaPluma: { r: { abd: 25 * D, fwd: 80 * D }, l: { abd: 25 * D, fwd: 80 * D }, wave: { arm: 'both', k: 'abd', amp: 0.2, hz: 1.2 } },
  metePluma: { r: { abd: 10 * D, fwd: 80 * D }, l: { abd: 10 * D, fwd: 80 * D }, wave: { arm: 'both', k: 'abd', amp: -0.15, hz: 1.2 } },
  carroFuera: { r: { abd: 20 * D, fwd: 85 * D }, l: { abd: 20 * D, fwd: 85 * D }, wave: { arm: 'both', k: 'abd', amp: 0.35, hz: 1 } },
  carroDentro: { r: { abd: 20 * D, fwd: 85 * D }, l: { abd: 20 * D, fwd: 85 * D }, wave: { arm: 'both', k: 'abd', amp: -0.3, hz: 1 } },
  para: { r: { abd: 90 * D, fwd: 0 }, l: DOWN, wave: { arm: 'r', k: 'fwd', amp: 0.5, hz: 1.4 } },
  espera: { r: { abd: 90 * D, fwd: 0 }, l: { abd: 90 * D, fwd: 0 }, wave: { arm: 'both', k: 'fwd', amp: 0.5, hz: 1.6 } },
  engancha: { r: { abd: 160 * D, fwd: 0 }, l: { abd: 160 * D, fwd: 0 } },
  suelta: { r: { abd: 40 * D, fwd: 30 * D }, l: DOWN },
};

/** Señalero: cuerpo de trabajador (chaleco naranja) y dos brazos que giran en los hombros */
export class RiggerView {
  readonly root = new THREE.Group();
  private arms: THREE.Group[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene, at: { x: number; y: number; z: number }) {
    const body = workerGeo();
    this.geos.push(body);
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const vest = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x3a1500 });
    const skin = new THREE.MeshLambertMaterial({ color: 0x3f4a5a });
    this.mats.push(bodyMat, vest, skin);
    const b = new THREE.Mesh(body, bodyMat);
    b.castShadow = true;
    // chaleco naranja encima del amarillo (para distinguirlo de los demás)
    const vg = new THREE.BoxGeometry(0.3, 0.5, 0.5);
    this.geos.push(vg);
    const v = new THREE.Mesh(vg, vest);
    v.position.set(0, 1.17, 0);
    const ag = new THREE.BoxGeometry(0.13, 0.66, 0.13).translate(0, -0.33, 0);
    this.geos.push(ag);
    for (const z of [0.31, -0.31]) {
      const g = new THREE.Group();
      g.position.set(0, 1.42, z);
      const a = new THREE.Mesh(ag, skin);
      a.castShadow = true;
      g.add(a);
      this.arms.push(g);
      this.root.add(g);
    }
    this.root.add(b, v);
    this.root.position.set(at.x, at.y, at.z);
    this.root.scale.setScalar(1.15); // un poco más grande para verlo desde lejos
    this.root.name = 'señalero';
    scene.add(this.root);
  }

  /** Mira hacia (x, z) y hace la señal */
  update(sig: Signal, lookX: number, lookZ: number, time: number) {
    this.root.rotation.y = Math.atan2(-(lookZ - this.root.position.z), lookX - this.root.position.x);
    const p = POSES[sig], w = p.wave;
    const osc = w ? w.amp * Math.sin(time * w.hz * 2 * Math.PI) : 0;
    const arm = (g: THREE.Group, a: Arm, side: 'r' | 'l') => {
      const moved = w && (w.arm === side || w.arm === 'both');
      const abd = a.abd + (moved && w!.k === 'abd' ? osc : 0), fwd = a.fwd + (moved && w!.k === 'fwd' ? osc : 0);
      // el derecho está en +z (mirando hacia +x, la izquierda es −z): separarlo es girar en −x; el izquierdo, en +x
      g.rotation.set(side === 'r' ? -abd : abd, 0, fwd, 'ZXY');
    };
    arm(this.arms[0], p.r, 'r');
    arm(this.arms[1], p.l, 'l');
  }

  dispose() {
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
