import * as THREE from 'three';
import type { CraneState } from '../crane/kinematics';
import { apply, type Pose } from '../crane/pose';
import type { SceneCtx } from './scene';
import type { Eye } from './craneModel';

// Cámaras (tecla V): orbital libre que acompaña a la grúa, seguimiento por detrás y cabina del conductor.
// En el tándem hay una cuarta: cámara libre fija en la obra, que no sigue a ninguna grúa ni salta con Tab.
// También mueve la luz con sombras para que su encuadre (±45 m) siga a la grúa.

export type CamMode = 'orbita' | 'seguir' | 'cabina' | 'libre';
const ORDER: CamMode[] = ['orbita', 'seguir', 'cabina', 'libre'];
const TEXT: Record<CamMode, string> = {
  orbita: 'Cámara orbital libre (ratón)',
  seguir: 'Cámara de seguimiento',
  cabina: 'Vista desde la cabina del conductor',
  libre: 'Cámara libre: no sigue a ninguna grúa ni cambia con Tab (ratón; botón derecho para desplazarla)',
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
  private sunAt = new THREE.Vector3(1e9, 0, 0); // fuerza el primer centrado
  /** Posición del sol respecto del centro del encuadre de sombras */
  private sunOffset = SUN_OFFSET.clone();
  /** Tándem: centro de la vista libre (entre las grúas); sin él no hay modo 'libre' */
  private freeCenter: (() => { x: number; z: number }) | null = null;

  /**
   * cab = piezas que se ocultan en la vista de cabina; eye(S) = ojo y mirada en el marco del chasis;
   * size = escala de las distancias de cámara (1 = AT 60); shadowHalf = medio lado del encuadre de sombras (m).
   * Con un encuadre mayor que 45 m el sol se aleja en proporción, para que la pluma alta quede dentro.
   */
  constructor(private ctx: SceneCtx, private cab: THREE.Object3D[], private eye: (S: CraneState) => Eye, private size = 1, shadowHalf = 45) {
    const k = shadowHalf / 45, sc = ctx.sun.shadow.camera;
    sc.left = sc.bottom = -shadowHalf;
    sc.right = sc.top = shadowHalf;
    sc.far = 140 * Math.max(1, k * 1.15);
    sc.updateProjectionMatrix();
    this.sunOffset.multiplyScalar(Math.max(1, k));
    ctx.controls.maxDistance = Math.max(200, 75 * size);
    if (size > 2) {
      // grúa colosal (LR 3000): vista inicial más lejos y niebla más lejana
      if (ctx.scene.fog instanceof THREE.Fog) { ctx.scene.fog.near = 60 * size; ctx.scene.fog.far = 420 + 40 * size; }
      ctx.controls.target.set(0, 5 * size, 0);
      ctx.camera.position.set(22 * size, 16 * size, 26 * size);
      ctx.controls.update();
    }
  }

  /**
   * Tándem (fase 10): seguir a otra grúa (Tab). La vista orbital se desplaza lo mismo que va de una grúa a la otra;
   * en la cabina, se vuelven a mostrar las piezas de la anterior.
   */
  follow(cab: THREE.Object3D[], eye: (S: CraneState) => Eye) {
    for (const m of this.cab) m.visible = true;
    this.cab = cab;
    this.eye = eye;
    for (const m of this.cab) m.visible = this.mode !== 'cabina';
  }

  /** Tándem: activa la cámara libre (modo 'libre' en el ciclo de V), centrada al entrar en center() */
  enableFree(center: () => { x: number; z: number }) {
    this.freeCenter = center;
  }

  cycle(S: CraneState, pose: Pose): string {
    const order = this.freeCenter ? ORDER : ORDER.filter((m) => m !== 'libre');
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    const { controls, camera } = this.ctx;
    controls.enabled = this.mode === 'orbita' || this.mode === 'libre';
    for (const m of this.cab) m.visible = this.mode !== 'cabina';
    if (this.mode === 'orbita') {
      // vuelve a una vista libre desde fuera, mirando a la grúa
      const c = this.carrier(pose);
      const k = this.size;
      controls.target.set(c.x, 5 * k, c.z);
      camera.position.set(c.x + 22 * k, 16 * k, c.z + 26 * k);
      controls.update();
    }
    if (this.mode === 'libre') {
      // vista amplia entre las grúas; luego se queda donde el jugador la deje
      const c = this.freeCenter!();
      const k = this.size;
      controls.target.set(c.x, 5 * k, c.z);
      camera.position.set(c.x + 22 * k, 18 * k, c.z + 30 * k);
      controls.update();
    }
    if (this.mode === 'seguir') {
      this.yaw = S.h;
      this.look.copy(this.carrier(pose)).setY(5 * this.size);
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
    } else if (this.mode === 'libre') {
      controls.update(); // solo el ratón la mueve (amortiguación de OrbitControls)
    } else if (this.mode === 'seguir') {
      // rumbo suavizado; detrás y arriba del portador
      let dy = S.h - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-2.5 * dt));
      const k = 1 - Math.exp(-4 * dt);
      const z = this.size;
      const want = new THREE.Vector3(-26 * z * Math.cos(this.yaw), 14 * z, 26 * z * Math.sin(this.yaw)).add(c);
      camera.position.lerp(want, k);
      this.look.lerp(new THREE.Vector3(c.x + 3 * z * Math.cos(this.yaw), 5 * z, c.z - 3 * z * Math.sin(this.yaw)), k);
      camera.lookAt(this.look);
    } else {
      const e = this.eye(S);
      const eye = apply(pose, e);
      const at = apply(pose, { x: e.x + 20 * e.fx, y: e.y - 1.2, z: e.z + 20 * e.fz });
      camera.position.set(eye.x, eye.y, eye.z);
      camera.lookAt(at.x, at.y, at.z);
    }
    this.last.copy(c);

    if (this.sunAt.distanceTo(c) > SUN_RECENTER) {
      this.sunAt.copy(c);
      sun.target.position.copy(c);
      sun.position.copy(c).add(this.sunOffset);
      sun.target.updateMatrixWorld();
    }
  }
}
