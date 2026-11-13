import { describe, expect, it } from 'vitest';
import { mixInto, nlerp } from './interp';
import { AdaptiveScale } from '../ui/adaptive';
import { Loop } from './loop';

// Fase 15: el dibujo mezcla los dos últimos pasos; la calidad adaptativa baja y sube la resolución.
describe('interpolación del dibujo', () => {
  it('mezcla los números (también anidados) y no las decisiones', () => {
    const a = { x: 0, slew: 1, v: { ang: 0 }, outT: 0, turnKey: false };
    const b = { x: 2, slew: 2, v: { ang: 4 }, outT: 1, turnKey: true };
    const o = mixInto({} as typeof a, a, b, 0.25);
    expect(o).toEqual({ x: 0.5, slew: 1.25, v: { ang: 1 }, outT: 1, turnKey: true });
  });

  it('giros por el camino corto y unitarios', () => {
    const q = nlerp({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0, w: -1 }, 0.5, { x: 0, y: 0, z: 0, w: 0 });
    expect(q.w).toBeCloseTo(1, 9);
    const r = nlerp({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, 0.5, { x: 0, y: 0, z: 0, w: 0 });
    expect(Math.hypot(r.x, r.y, r.z, r.w)).toBeCloseTo(1, 9);
  });

  it('el bucle da la fracción del paso que sobra (a 144 Hz, entre 0 y 1)', () => {
    let steps = 0;
    const alphas: number[] = [];
    const loop = new Loop(() => steps++, () => alphas.push(loop.alpha));
    for (let i = 0; i <= 144; i++) loop.frame(i * 1000 / 144);
    expect(steps).toBe(60);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...alphas)).toBeLessThan(1);
    // con varios valores distintos: los cuadros sin paso no repiten la misma imagen
    expect(new Set(alphas.map((a) => a.toFixed(2))).size).toBeGreaterThan(5);
  });
});

describe('calidad adaptativa', () => {
  const feed = (a: AdaptiveScale, dt: number, s: number) => { for (let t = 0; t < s; t += dt) a.update(dt); };

  it('40 fps con la pantalla sincronizada (cuadros de 16 y 33 ms alternados) también es lento', () => {
    const a = new AdaptiveScale();
    for (let i = 0; i < 300; i++) a.update(i % 2 ? 1 / 30 : 1 / 60);
    expect(a.scale).toBeLessThan(1);
  });

  it('a 60 fps no cambia nada', () => {
    const a = new AdaptiveScale();
    feed(a, 1 / 60, 30);
    expect(a.scale).toBe(1);
  });

  it('a 40 fps sostenidos baja hasta el mínimo, y un tirón suelto no cuenta', () => {
    const a = new AdaptiveScale();
    a.update(0.2);
    feed(a, 1 / 60, 1);
    expect(a.scale).toBe(1);
    feed(a, 1 / 40, 3);
    expect(a.scale).toBeLessThan(1);
    feed(a, 1 / 40, 30);
    expect(a.scale).toBe(a.min);
  });

  it('con margen vuelve a subir; si la subida no aguanta, espera más para probar', () => {
    const a = new AdaptiveScale();
    feed(a, 1 / 40, 4);
    const low = a.scale;
    expect(low).toBeLessThan(1);
    feed(a, 1 / 60, 10);
    expect(a.scale).toBeGreaterThan(low); // probó a subir
    feed(a, 1 / 40, 4); // y no aguantó
    const back = a.scale;
    feed(a, 1 / 60, 10);
    expect(a.scale).toBe(back); // ahora espera el doble (16 s)
    feed(a, 1 / 60, 10);
    expect(a.scale).toBeGreaterThan(back);
    feed(a, 1 / 60, 200);
    expect(a.scale).toBe(1); // nunca pasa de la calidad elegida
  });
});
