import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BLEND_T, CameraRig, MIN_Y, SHADOW_STEPS, shadowStep } from './camera';
import type { SceneCtx } from './scene';
import type { CraneState } from '../crane/kinematics';
import type { Pose } from '../crane/pose';

// Fase 16: cámara que no atraviesa nada, transiciones entre modos y encuadre de sombras según lo que se ve.

/** Escena mínima sin DOM: los controles orbitales solo miran al objetivo (como OrbitControls sin ratón) */
function ctx(): SceneCtx {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 900);
  const target = new THREE.Vector3(0, 5, 0);
  const controls = { target, enabled: true, maxDistance: 200, update: () => camera.lookAt(target) };
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(2048, 2048);
  camera.position.set(22, 16, 26);
  controls.update();
  return { camera, controls, sun, scene: new THREE.Scene(), renderer: null } as unknown as SceneCtx;
}

const S = { h: 0 } as CraneState;
const pose = { t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } } as Pose;
const eye = () => ({ x: 2, y: 3, z: 0, fx: 1, fz: 0 });

function run(rig: CameraRig, s: number) {
  for (let i = 0; i < Math.round(s * 60); i++) rig.update(1 / 60, S, pose);
}

describe('cámara (fase 16)', () => {
  it('se acerca si algo la tapa y vuelve a la distancia pedida cuando se despeja', () => {
    const c = ctx(), rig = new CameraRig(c, [], eye);
    const far = c.camera.position.distanceTo(c.controls.target);
    let wall: number | null = 12;
    // una pared a `wall` m del punto de mira (el rayo puede salir más adelante)
    rig.ray = (o, _d, max) => {
      if (wall === null) return null;
      const h = wall - Math.hypot(o.x, o.y - 5, o.z);
      return h >= 0 && h < max ? h : null;
    };
    run(rig, 0.1);
    const d1 = c.camera.position.distanceTo(c.controls.target);
    expect(d1).toBeLessThan(12);
    expect(d1).toBeGreaterThan(10);
    wall = null;
    run(rig, 0.2);
    // no salta: vuelve poco a poco
    const d2 = c.camera.position.distanceTo(c.controls.target);
    expect(d2).toBeGreaterThan(d1);
    expect(d2).toBeLessThan(far - 1);
    run(rig, 4);
    // los controles siguieron con la distancia pedida: el zoom del jugador no cambió
    expect(c.camera.position.distanceTo(c.controls.target)).toBeCloseTo(far, 3);
  });

  it('no baja del suelo', () => {
    const c = ctx(), rig = new CameraRig(c, [], eye);
    c.camera.position.set(20, -3, 0);
    c.controls.target.set(0, 0.2, 0);
    run(rig, 0.05);
    expect(c.camera.position.y).toBeGreaterThanOrEqual(MIN_Y);
  });

  it('al cambiar de modo se desliza en vez de saltar', () => {
    const c = ctx(), rig = new CameraRig(c, [], eye);
    run(rig, 0.1);
    const before = c.camera.position.clone();
    rig.cycle(S, pose); // seguir
    rig.update(1 / 60, S, pose);
    const step = c.camera.position.distanceTo(before);
    expect(step).toBeLessThan(1);
    run(rig, BLEND_T + 0.5);
    // detrás de la grúa (rumbo 0: hacia −x)
    expect(c.camera.position.x).toBeLessThan(-15);
  });

  it('encuadre de sombras: pequeño de cerca, el máximo de lejos, sin saltar por poco', () => {
    expect(shadowStep(8, 85)).toBe(SHADOW_STEPS[0]);
    expect(shadowStep(400, 85)).toBe(85);
    expect(shadowStep(400, 45)).toBe(45);
    const h = shadowStep(40, 85);
    expect(h).toBeGreaterThan(SHADOW_STEPS[0]);
    // acercarse un poco no baja de escalón (histéresis)
    expect(shadowStep(36, 85, h)).toBe(h);
    expect(shadowStep(10, 85, h)).toBe(SHADOW_STEPS[0]);
  });

  it('el sol sigue a lo que se ve, ajustado a los texels del mapa', () => {
    const c = ctx(), rig = new CameraRig(c, [], eye, 1, 60);
    c.camera.position.set(6, 5.5, 6);
    run(rig, 0.05);
    expect(rig.shadow).toBe(SHADOW_STEPS[0]);
    const a = c.sun.target.position.clone();
    // mover el objetivo menos de medio texel no mueve el sol de lado
    const texel = (2 * rig.shadow) / 2048;
    c.controls.target.x += texel * 0.2;
    c.camera.position.x += texel * 0.2;
    run(rig, 1 / 60);
    // (a lo largo de la luz sí puede moverse: eso no cambia dónde caen las sombras)
    const f = c.sun.position.clone().sub(c.sun.target.position).normalize();
    const moved = c.sun.target.position.clone().sub(a);
    expect(moved.sub(f.multiplyScalar(moved.dot(f))).length()).toBeLessThan(1e-9);
    expect(c.sun.target.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(texel * 2);
  });
});
