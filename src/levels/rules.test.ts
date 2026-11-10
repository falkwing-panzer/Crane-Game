import { describe, expect, it } from 'vitest';
import { loadRulesReference } from '../crane/reference';
import { LEVELS } from './levels';
import { lineMargin, segSeg, windAt, windForce } from './rules';

const v = (a: number[]) => ({ x: a[0], y: a[1], z: a[2] });

describe('reglas de los niveles contra la referencia', () => {
  it('windAt: igual en todos los niveles durante 10 minutos', () => {
    for (const L of LEVELS) {
      const R = loadRulesReference(L);
      for (let t = 0; t < 600; t += 0.37) expect(windAt(L, t)).toBeCloseTo(R.windAt(t), 12);
    }
  });

  it('segSeg: igual en segmentos al azar, paralelos y degenerados', () => {
    const R = loadRulesReference(LEVELS[0]);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
    const cases: number[][][] = [
      [[0, 0, 0], [10, 0, 0], [0, 5, 0], [10, 5, 0]], // paralelos
      [[1, 1, 1], [1, 1, 1], [0, 0, 0], [5, 0, 0]], // punto y segmento
      [[2, 2, 2], [2, 2, 2], [3, 3, 3], [3, 3, 3]], // dos puntos
    ];
    for (let i = 0; i < 500; i++) cases.push([[rnd(), rnd(), rnd()], [rnd(), rnd(), rnd()], [rnd(), rnd(), rnd()], [rnd(), rnd(), rnd()]]);
    for (const [a, b, c, d] of cases) expect(segSeg(v(a), v(b), v(c), v(d))).toBeCloseTo(R.segSeg(a, b, c, d), 9);
  });

  it('viento: sin viento no empuja; la fuerza va hacia la dirección del nivel', () => {
    expect(windForce(LEVELS[0], 12, 5).x).toBe(0);
    const L = LEVELS[5]; // fachada de vidrio: 6 m/s hacia 200°
    const f = windForce(L, 30, 5.76);
    expect(f.v).toBeGreaterThan(0);
    expect(Math.atan2(f.z, f.x) * 180 / Math.PI + 360).toBeCloseTo(200, 6);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(0.006 * f.v * f.v * 5.76, 9);
  });

  it('líneas: margen = distancia − mínima; la carga cuenta con su radio', () => {
    const lines = LEVELS[2].lines!; // 34,5 kV a 11 m sobre z = 22 (mín. 3) y 115 kV a 13 m sobre x = 70 (mín. 5)
    const g = { foot: v([20, 3, 40]), head: v([20, 20, 30]), tip: v([20, 20, 30]), hook: v([20, 10, 30]) };
    // lo más cerca de la línea de 34,5 kV es el cable, a la altura de la línea y 8 m de ella
    expect(lineMargin(lines, g)).toBeCloseTo(8 - 3, 6);
    const near = { ...g, hook: v([20, 11, 25]), load: { bottom: v([20, 7, 25]), top: v([20, 10, 25]), r: 1 } };
    expect(lineMargin(lines, near)).toBeCloseTo(Math.hypot(3, 1) - 1 - 3, 6); // la carga: −0,84 m (invadida)
  });
});
