import { describe, expect, it } from 'vitest';
import { bow, catenary, dips, polyLength } from './catenary';

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

  it('gancho apoyado debajo de la cabeza: el ramal se arquea de lado con el largo del cable (hasta la flecha máxima)', () => {
    const b = { x: 0, y: 1, z: 0 }, side = { x: 0, y: 0, z: 1 };
    expect(dips(catenary(a, b, 21, 32), 1)).toBe(true); // la catenaria bajaría del gancho
    const p = bow(a, b, 21, 64, side, 5);
    expect(polyLength(p)).toBeCloseTo(21, 0);
    expect(Math.max(...p.map((v) => v.z))).toBeGreaterThan(1);
    expect(Math.min(...p.map((v) => v.y))).toBeGreaterThanOrEqual(1);
    // con mucho cable sobrante, la flecha no pasa del máximo
    expect(Math.max(...bow(a, b, 80, 64, side, 1.5).map((v) => v.z))).toBeCloseTo(1.5, 6);
  });
});
