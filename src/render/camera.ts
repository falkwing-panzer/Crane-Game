import * as THREE from 'three';
import type { CraneState } from '../crane/kinematics';
import { apply, type Pose } from '../crane/pose';
import type { SceneCtx } from './scene';
import type { Eye } from './craneModel';
import { t } from '../i18n';

// Cámaras (tecla V): orbital libre que acompaña a la grúa, seguimiento por detrás y cabina del conductor.
// En el tándem hay una cuarta: cámara libre fija en la obra, que no sigue a ninguna grúa ni salta con Tab.
// También mueve la luz con sombras para que su encuadre siga a lo que se ve.
//
// Fase 16:
// - la cámara no atraviesa el suelo, los obstáculos, las cargas ni la grúa: si algo se pone entre el punto al que mira
//   y la cámara, se acerca (rayo de Rapier) y vuelve despacio cuando se despeja. OrbitControls sigue trabajando con la
//   posición pedida (la que no se acercó), así el zoom del jugador no cambia;
// - al cambiar de modo con V, la cámara se desliza en ~0,6 s en vez de saltar;
// - el encuadre de sombras se ajusta a lo que se ve (de cerca, más pequeño y más nítido), por escalones y con el centro
//   ajustado a los texels del mapa para que las sombras no tiemblen al moverse.

export type CamMode = 'orbita' | 'seguir' | 'cabina' | 'libre';
const ORDER: CamMode[] = ['orbita', 'seguir', 'cabina', 'libre'];
const TEXT: Record<CamMode, string> = t.camera;
const SUN_OFFSET = new THREE.Vector3(30, 50, 20);
/** Duración de la transición entre modos (s) */
export const BLEND_T = 0.6;
/** Altura mínima de la cámara sobre el suelo (m) */
export const MIN_Y = 0.4;
/** Separación que deja la cámara delante de lo que la tapa (m) */
const PULL_GAP = 0.6;
/** Distancia desde el punto de mira a la que empieza el rayo de choques (m) */
const RAY_START = 2.5;
/** Escalones del medio lado del encuadre de sombras (m) */
export const SHADOW_STEPS = [20, 28, 40, 56, 80, 112];

/** Rayo contra el mundo: distancia a lo primero que toca, o null (`Physics.rayHit`) */
export type RayFn = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) => number | null;

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _o = new THREE.Vector3();

/** Medio lado del encuadre de sombras para una cámara a `dist` m de lo que mira (con `cur` = el escalón actual) */
export function shadowStep(dist: number, max: number, cur = 0) {
  const need = 0.9 * dist + 8;
  const pick = (n: number) => Math.min(SHADOW_STEPS.find((s) => s >= n) ?? max, max);
  const h = pick(need);
  // histéresis: para bajar de escalón hace falta un 15 % de margen (no salta al acercar un poco el ratón)
  return cur > h ? Math.min(cur, Math.max(h, pick(need * 1.15))) : h;
}

export class CameraRig {
  mode: CamMode = 'orbita';
  private last = new THREE.Vector3();
  private yaw = 0;
  private look = new THREE.Vector3();
  /** Seguimiento: posición suavizada (la que se pide; la mostrada puede acercarse) */
  private fpos = new THREE.Vector3();
  /** Posición del sol respecto del centro del encuadre de sombras */
  private sunOffset = SUN_OFFSET.clone();
  /** Tándem: centro de la vista libre (entre las grúas); sin él no hay modo 'libre' */
  private freeCenter: (() => { x: number; z: number }) | null = null;
  /** Rayo contra el mundo para no atravesar nada (lo pone la presentación) */
  ray: RayFn | null = null;
  /** Altura del suelo (fase 18: terreno); sin esto, plano en y = 0 */
  groundY: ((x: number, z: number) => number) | null = null;
  /** Posición pedida en el último cuadro y la que se mostró (acercada o en transición) */
  private want = new THREE.Vector3();
  private shown = new THREE.Vector3(NaN, 0, 0);
  /** Distancia permitida por los choques (se acerca enseguida y se aleja despacio) */
  private allow = Infinity;
  /** Transición entre modos: de dónde sale y cuánto lleva (≥ 1: terminada) */
  private from = new THREE.Vector3();
  private fromQ = new THREE.Quaternion();
  private blend = 1;
  /** Encuadre de sombras: el máximo de la grúa y el escalón actual */
  private shadowMax: number;
  private shadowHalf = 0;

  /**
   * cab = piezas que se ocultan en la vista de cabina; eye(S) = ojo y mirada en el marco del chasis;
   * size = escala de las distancias de cámara (1 = AT 60); shadowHalf = medio lado máximo del encuadre de sombras (m).
   * Con un encuadre mayor que 45 m el sol se aleja en proporción, para que la pluma alta quede dentro.
   */
  constructor(private ctx: SceneCtx, private cab: THREE.Object3D[], private eye: (S: CraneState) => Eye, private size = 1, shadowHalf = 45) {
    const k = shadowHalf / 45, sc = ctx.sun.shadow.camera;
    this.shadowMax = shadowHalf;
    sc.far = 140 * Math.max(1, k * 1.15);
    this.setShadowHalf(shadowHalf);
    this.sunOffset.multiplyScalar(Math.max(1, k));
    ctx.controls.maxDistance = Math.max(200, 75 * size);
    if (size > 2) {
      // grúa colosal (LR 3000): vista inicial más lejos
      ctx.controls.target.set(0, 5 * size, 0);
      ctx.camera.position.set(22 * size, 16 * size, 26 * size);
      ctx.controls.update();
    }
  }

  private setShadowHalf(h: number) {
    if (h === this.shadowHalf) return;
    this.shadowHalf = h;
    const sc = this.ctx.sun.shadow.camera;
    sc.left = sc.bottom = -h;
    sc.right = sc.top = h;
    sc.updateProjectionMatrix();
  }

  /** Medio lado del encuadre de sombras en uso (m) */
  get shadow() { return this.shadowHalf; }

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
    // la transición sale de lo que se ve ahora
    this.from.copy(camera.position);
    this.fromQ.copy(camera.quaternion);
    this.blend = 0;
    this.allow = Infinity;
    this.shown.set(NaN, 0, 0);
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
      const c = this.carrier(pose);
      const z = this.size;
      this.look.copy(c).setY(5 * z);
      this.fpos.set(-26 * z * Math.cos(this.yaw), 14 * z, 26 * z * Math.sin(this.yaw)).add(c);
    }
    return TEXT[this.mode];
  }

  private carrier(pose: Pose) {
    return _v.set(pose.t.x, 0, pose.t.z);
  }

  update(dt: number, S: CraneState, pose: Pose) {
    const { camera, controls } = this.ctx;
    // lo que se mostró el cuadro anterior no es lo pedido: los controles siguen con lo pedido (si nadie movió la
    // cámara entre medias: el banco, warmUp o resetView la ponen a mano)
    if (camera.position.equals(this.shown)) camera.position.copy(this.want);
    const c = this.carrier(pose).clone();
    if (this.mode === 'orbita') {
      // el objetivo acompaña a la grúa: la cámara se desplaza lo mismo que el portador
      const d = c.clone().sub(this.last);
      camera.position.add(d);
      controls.target.add(d);
      controls.update();
      this.look.copy(controls.target);
    } else if (this.mode === 'libre') {
      controls.update(); // solo el ratón la mueve (amortiguación de OrbitControls)
      this.look.copy(controls.target);
    } else if (this.mode === 'seguir') {
      // rumbo suavizado; detrás y arriba del portador
      let dy = S.h - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-2.5 * dt));
      const k = 1 - Math.exp(-4 * dt);
      const z = this.size;
      const want = new THREE.Vector3(-26 * z * Math.cos(this.yaw), 14 * z, 26 * z * Math.sin(this.yaw)).add(c);
      this.fpos.lerp(want, k);
      this.look.lerp(new THREE.Vector3(c.x + 3 * z * Math.cos(this.yaw), 5 * z, c.z - 3 * z * Math.sin(this.yaw)), k);
      camera.position.copy(this.fpos);
      camera.lookAt(this.look);
    } else {
      const e = this.eye(S);
      const eye = apply(pose, e);
      const at = apply(pose, { x: e.x + 20 * e.fx, y: e.y - 1.2, z: e.z + 20 * e.fz });
      camera.position.set(eye.x, eye.y, eye.z);
      camera.lookAt(at.x, at.y, at.z);
      this.look.set(at.x, at.y, at.z);
    }
    this.last.copy(c);
    this.want.copy(camera.position);

    if (this.mode !== 'cabina') this.avoid(dt);
    if (this.blend < 1) {
      // transición: de la vista anterior a la nueva, con arranque y frenado suaves
      this.blend = Math.min(1, this.blend + dt / BLEND_T);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      _q.copy(camera.quaternion);
      camera.position.lerpVectors(this.from, camera.position, e);
      camera.quaternion.slerpQuaternions(this.fromQ, _q, e);
    }
    this.shown.copy(camera.position);
    this.fitShadow(this.mode === 'cabina' ? 15 : camera.position.distanceTo(this.look));
  }

  /** Acerca la cámara si algo la tapa (y no la deja bajo el suelo) */
  private avoid(dt: number) {
    const { camera } = this.ctx;
    _d.copy(camera.position).sub(this.look);
    const dist = _d.length();
    if (dist > 1e-3) {
      _d.divideScalar(dist);
      // el rayo sale un poco por delante del punto al que mira: si ese punto cae junto a la grúa (o dentro), sus
      // propias piezas no meten la cámara dentro de ella
      let hit: number | null = null;
      if (this.ray && dist > RAY_START) {
        const o = _o.copy(this.look).addScaledVector(_d, RAY_START);
        const h = this.ray(o, _d, dist - RAY_START);
        if (h !== null) hit = h + RAY_START;
      }
      const target = hit === null ? Infinity : Math.max(RAY_START, hit - PULL_GAP);
      // se acerca de golpe (si no, se vería a través de la pieza) y, despejado, vuelve despacio a la distancia pedida
      if (target < this.allow) this.allow = target;
      else if (this.allow < dist) {
        this.allow += (Math.min(target, dist) - this.allow) * (1 - Math.exp(-3 * dt));
        if (target >= dist && dist - this.allow < 0.05) this.allow = Infinity;
      } else this.allow = Infinity;
      if (this.allow < dist) camera.position.copy(this.look).addScaledVector(_d, this.allow);
    }
    const gy = (this.groundY?.(camera.position.x, camera.position.z) ?? 0) + MIN_Y;
    if (camera.position.y < gy) camera.position.y = gy;
  }

  /** Encuadre de sombras alrededor de lo que se ve, por escalones y ajustado a los texels (sin temblor) */
  private fitShadow(dist: number) {
    const { sun } = this.ctx;
    this.setShadowHalf(shadowStep(dist, this.shadowMax, this.shadowHalf));
    const f = _d.copy(this.sunOffset).normalize().negate();
    const r = new THREE.Vector3().crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    const c = _v.copy(this.look).setY(0);
    const texel = (2 * this.shadowHalf) / Math.max(256, sun.shadow.mapSize.x);
    const a = Math.round(c.dot(r) / texel) * texel, b = Math.round(c.dot(u) / texel) * texel, w = c.dot(f);
    c.copy(r).multiplyScalar(a).addScaledVector(u, b).addScaledVector(f, w);
    sun.target.position.copy(c);
    sun.position.copy(c).add(this.sunOffset);
    sun.target.updateMatrixWorld();
  }
}
