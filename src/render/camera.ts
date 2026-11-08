import * as THREE from 'three';
import type { CraneState } from '../crane/kinematics';
import { apply, type Pose } from '../crane/pose';
import type { SceneCtx } from './scene';

// Cámaras (tecla V): orbital libre que acompaña a la grúa, seguimiento por detrás y cabina del conductor.
// También mueve la luz con sombras para que su encuadre (±45 m) siga a la grúa.

export type CamMode = 'orbita' | 'seguir' | 'cabina';
const ORDER: CamMode[] = ['orbita', 'seguir', 'cabina'];
const TEXT: Record<CamMode, string> = {
  orbita: 'Cámara orbital libre (ratón)',
  seguir: 'Cámara de seguimiento',
  cabina: 'Vista desde la cabina del conductor',
};
/** Distancia a la que se vuelve a centrar la luz: a saltos, para que la sombra no tiemble al moverse */
const SUN_RECENTER = 15;
const SUN_OFFSET = new THREE.Vector3(30, 50, 20);

const _v = new THREE.Vector3();

export class CameraRig {
  mode: CamMode = 'orbita';
  private last = new THREE.Vector3();
  private yaw = 0;
  private look = new THREE.Vector3();
  private sunAt = new THREE.Vector3();

  constructor(private ctx: SceneCtx, private cab: THREE.Object3D[], private eyeLocal: { x: number; y: number; z: number }) {}

  cycle(S: CraneState, pose: Pose): string {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    const { controls, camera } = this.ctx;
    controls.enabled = this.mode === 'orbita';
    for (const m of this.cab) m.visible = this.mode !== 'cabina';
    if (this.mode === 'orbita') {
      // vuelve a una vista libre desde fuera, mirando a la grúa
      const c = this.carrier(pose);
      controls.target.set(c.x, 5, c.z);
      camera.position.set(c.x + 22, 16, c.z + 26);
      controls.update();
    }
    if (this.mode === 'seguir') {
      this.yaw = S.h;
      this.look.copy(this.carrier(pose)).setY(5);
    }
    return TEXT[this.mode];
  }

  private carrier(pose: Pose) {
    return _v.set(pose.t.x, 0, pose.t.z);
  }

  update(dt: number, S: CraneState, pose: Pose) {
    const { camera, controls, sun } = this.ctx;
    const c = this.carrier(pose).clone();
    if (this.mode === 'orbita') {
      // el objetivo acompaña a la grúa: la cámara se desplaza lo mismo que el portador
      const d = c.clone().sub(this.last);
      camera.position.add(d);
      controls.target.add(d);
      controls.update();
    } else if (this.mode === 'seguir') {
      // rumbo suavizado; detrás y arriba del portador
      let dy = S.h - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-2.5 * dt));
      const k = 1 - Math.exp(-4 * dt);
      const want = new THREE.Vector3(-26 * Math.cos(this.yaw), 14, 26 * Math.sin(this.yaw)).add(c);
      camera.position.lerp(want, k);
      this.look.lerp(new THREE.Vector3(c.x + 3 * Math.cos(this.yaw), 5, c.z - 3 * Math.sin(this.yaw)), k);
      camera.lookAt(this.look);
    } else {
      const e = this.eyeLocal;
      const eye = apply(pose, e);
      const at = apply(pose, { x: e.x + 20, y: e.y - 1.2, z: e.z });
      camera.position.set(eye.x, eye.y, eye.z);
      camera.lookAt(at.x, at.y, at.z);
    }
    this.last.copy(c);

    if (this.sunAt.distanceTo(c) > SUN_RECENTER) {
      this.sunAt.copy(c);
      sun.target.position.copy(c);
      sun.position.copy(c).add(SUN_OFFSET);
      sun.target.updateMatrixWorld();
    }
  }
}
