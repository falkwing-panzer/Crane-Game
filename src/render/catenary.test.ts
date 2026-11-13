import { describe, expect, it } from 'vitest';
import { catenary, polyLength } from './catenary';
import { RopeSim } from './ropeSim';

// Fase 15, parte C: el cable flojo se dibuja como catenaria; tenso, recto.
describe('catenaria del cable flojo', () => {
  const a = { x: 0, y: 20, z: 0 };

  it('tenso: la recta', () => {
    const b = { x: 3, y: 2, z: 4 };
    const p = catenary(a, b, Math.hypot(3, 18, 4), 8);
    for (let i = 0; i <= 8; i++) expect(p[i].y).toBeCloseTo(20 - 18 * i / 8, 9);
  });

  it('flojo: pasa por los extremos, mide lo que el cable y cuelga por debajo de la recta', () => {
    for (const [b, len] of [[{ x: 10, y: 20, z: 0 }, 14], [{ x: 6, y: 5, z: 8 }, 25], [{ x: -2, y: 30, z: 1 }, 15]] as const) {
      const p = catenary(a, b, len, 400);
      expect(p[0]).toEqual(a);
      expect(p[400].x).toBeCloseTo(b.x, 9);
      expect(p[400].y).toBeCloseTo(b.y, 9);
      expect(p[400].z).toBeCloseTo(b.z, 9);
      expect(polyLength(p)).toBeCloseTo(len, 2);
      // en la mitad, por debajo de la recta
      expect(p[200].y).toBeLessThan((a.y + b.y) / 2);
    }
  });

  it('casi vertical y flojo: cuelga en U debajo del extremo bajo, sin pasar del suelo', () => {
    const b = { x: 0, y: 1, z: 0 };
    const p = catenary(a, b, 30, 64, 0);
    expect(Math.min(...p.map((v) => v.y))).toBeGreaterThanOrEqual(0);
    expect(p.every((v) => Number.isFinite(v.x + v.y + v.z))).toBe(true);
    expect(p[64].y).toBeCloseTo(1, 9);
  });

  it('reutiliza los puntos', () => {
    const out = catenary(a, { x: 5, y: 10, z: 0 }, 14, 8);
    expect(catenary(a, { x: 5, y: 10, z: 0 }, 16, 8, -Infinity, out)).toBe(out);
    expect(out.length).toBe(9);
  });

  it('cable flojo simulado: cae por su peso, se apoya en el suelo, no se estira y tenso queda recto', () => {
    const r = new RopeSim(16), head = { x: 0, y: 10, z: 0 }, hook = { x: 0.3, y: 1, z: 0 };
    let p = r.update(head, hook, 9.2, 0.5, 0.016);
    for (let i = 0; i < 300; i++) p = r.update(head, hook, 20, 0.5, 1 / 60);
    expect(p[0]).toEqual(head);
    expect(p[16]).toEqual(hook);
    expect(Math.min(...p.map((v) => v.y))).toBeGreaterThanOrEqual(0.5); // no atraviesa el suelo
    expect(p.filter((v) => v.y < 0.55).length).toBeGreaterThan(3); // lo que sobra queda en el suelo
    expect(polyLength(p)).toBeLessThanOrEqual(20 + 1e-3); // no se estira
    // tenso: la recta
    p = r.update(head, hook, Math.hypot(0.3, 9), 0.5, 1 / 60);
    expect(p[8].y).toBeCloseTo(5.5, 6);
  });
});
