import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Effects, DUST_SPEED, type EffectUnit } from './effects';
import { Particles } from './particles';
import { CRANES } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';
import type { Pose } from '../crane/pose';
import { distanceGain, REF_ENGINE } from '../ui/audio';

// Fase 16: partículas (solo dibujo) y sonido 3D.

const pose: Pose = { t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } } as Pose;
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 900);
const state = (o: Partial<CraneState>) => ({ vd: 0, h: 0, out: 0, ...o }) as CraneState;

function run(fx: Effects, u: () => EffectUnit, s: number) {
  for (let i = 0; i < Math.round(s * 60); i++) fx.update(1 / 60, [u()], cam, 1080);
}

describe('partículas (fase 16)', () => {
  it('una partícula vive su vida, sube si es humo y se desvanece', () => {
    const p = new Particles(4, { color: '#555', alpha: 0.5, grow: 2, lift: 1, drag: 1 });
    p.emit(0, 1, 0, 0, 0, 0, 1, 0.5);
    p.update(0.5);
    expect(p.alive).toBe(1);
    const y = (p.points.geometry.attributes.position as THREE.BufferAttribute).getY(0);
    expect(y).toBeGreaterThan(1);
    p.update(0.6);
    p.update(0.01);
    expect(p.alive).toBe(0);
    expect(p.points.visible).toBe(false);
  });

  it('polvo al conducir, no parado', () => {
    const fx = new Effects(new THREE.Scene());
    run(fx, () => ({ T: CRANES.medium, S: state({ vd: 0 }), pose, work: 0 }), 1);
    expect(fx.dust.alive).toBe(0);
    run(fx, () => ({ T: CRANES.medium, S: state({ vd: DUST_SPEED + 2 }), pose, work: 0 }), 1);
    expect(fx.dust.alive).toBeGreaterThan(10);
  });

  it('las orugas también levantan polvo', () => {
    const fx = new Effects(new THREE.Scene());
    run(fx, () => ({ T: CRANES.crawler, S: state({ vd: 1.5 }), pose, work: 0 }), 1);
    expect(fx.dust.alive).toBeGreaterThan(5);
  });

  it('polvo de las zapatas al tocar el suelo', () => {
    const fx = new Effects(new THREE.Scene());
    let out = 0.3;
    run(fx, () => ({ T: CRANES.medium, S: state({ out: (out += 0.01) }), pose, work: 0 }), 0.5);
    expect(fx.dust.alive).toBeGreaterThanOrEqual(4 * 14);
  });

  it('humo del escape al acelerar, más que al ralentí', () => {
    const idle = new Effects(new THREE.Scene());
    run(idle, () => ({ T: CRANES.medium, S: state({ vd: 0 }), pose, work: 0 }), 1);
    const fx = new Effects(new THREE.Scene());
    let v = 0;
    run(fx, () => ({ T: CRANES.medium, S: state({ vd: (v += 0.03) }), pose, work: 0 }), 1);
    expect(fx.smoke.alive).toBeGreaterThan(idle.smoke.alive + 10);
  });

  it('lluvia: una malla que se pone y se quita', () => {
    const scene = new THREE.Scene(), fx = new Effects(scene);
    const n = scene.children.length;
    fx.setRain(true);
    expect(scene.children.length).toBe(n + 1);
    fx.setRain(false);
    expect(scene.children.length).toBe(n);
  });
});

describe('sonido 3D (fase 16)', () => {
  it('entero de cerca, más bajo de lejos', () => {
    expect(distanceGain(3, REF_ENGINE)).toBe(1);
    expect(distanceGain(REF_ENGINE * 2, REF_ENGINE)).toBeCloseTo(0.5, 6);
    expect(distanceGain(200, REF_ENGINE)).toBeLessThan(0.15);
  });
});
