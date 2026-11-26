import { describe, expect, it } from 'vitest';
import { CRANES } from './cranes';
import { baseConfig, lmiStatic, ratedCap, reach, type CraneConfig, type SupportMode } from './stability';
import { SLEW_SAMPLES, angleFor, cellPose, chartMark, loadChart, niceSteps } from './loadChart';

const D = Math.PI / 180;

/** Configuraciones de prueba: la de salida y, si la grúa los tiene, lastre, Y-guy, plumín y superlift */
function configs(id: string): [string, CraneConfig, SupportMode][] {
  const T = CRANES[id as keyof typeof CRANES];
  const C = baseConfig(T);
  const md: SupportMode = T.crawler ? 'crawler' : 'out';
  const out: [string, CraneConfig, SupportMode][] = [['base', C, md]];
  if (!T.crawler) out.push(['tire', C, 'tire']);
  if (T.ballast) out.push(['lastre', { ...C, mCw: (T.cwBase ?? T.mCw) + T.ballast.m, yOn: !!T.yguy }, md]);
  if (T.jibDef) out.push(['plumín', { ...C, jib: T.jibDef, jibRel: 20 * D }, md]);
  if (T.superlift) out.push(['superlift', { ...C, slR: T.superlift.rMax }, md]);
  return out;
}

describe('tabla de cargas', () => {
  for (const id of Object.keys(CRANES)) {
    const T = CRANES[id as keyof typeof CRANES];
    for (const [name, C, md] of configs(id)) {
      it(`${T.name} (${name}): cada casilla es ratedCap y con esa masa el LMI da 1`, () => {
        const slew = 37 * D;
        const ch = loadChart(T, C, md, slew);
        expect(ch.radii.length).toBeGreaterThan(1);
        let cells = 0;
        ch.radii.forEach((R, i) => ch.cols.forEach((col, j) => {
          const c = ch.cap[i][j];
          const p = cellPose(T, C, ch.kind, col, R);
          if (c === null) { expect(p).toBeNull(); return; }
          cells++;
          expect(p).not.toBeNull();
          // el radio de la casilla es el de verdad
          expect(reach(T, C, p!.Lb, p!.ang)).toBeCloseTo(R, 6);
          expect(c).toBe(ratedCap(T, C, md, p!.Lb, p!.ang, slew));
          // con la capacidad de la tabla el LMI queda justo por debajo de 1 (o manda la estructura)
          if (c > 0) {
            expect(lmiStatic(T, C, md, p!.Lb, p!.ang, slew, c)).toBeLessThan(1);
            expect(lmiStatic(T, C, md, p!.Lb, p!.ang, slew, c * 1.001 + 1e-6)).toBeGreaterThanOrEqual(1 - 1e-6);
          }
        }));
        expect(cells).toBeGreaterThan(3);
      });
    }
  }

  it('la tabla de 360° es la peor de todos los giros y nunca supera la del giro actual', () => {
    const T = CRANES.medium, C = baseConfig(T);
    const all = loadChart(T, C, 'out', null), here = loadChart(T, C, 'out', 0);
    all.cap.forEach((row, i) => row.forEach((c, j) => {
      if (c === null) return;
      const p = cellPose(T, C, 'boom', all.cols[j], all.radii[i])!;
      expect(c).toBe(Math.min(...SLEW_SAMPLES.map((s) => ratedCap(T, C, 'out', p.Lb, p.ang, s))));
      expect(c).toBeLessThanOrEqual(here.cap[i][j]! + 1e-9);
      // giros fuera de las muestras (cada 2,5°) no bajan más de un 1 %
      if (i % 2) return;
      for (let s = 0; s < 360; s += 2.5) expect(ratedCap(T, C, 'out', p.Lb, p.ang, s * D)).toBeGreaterThanOrEqual(c * 0.99 - 1e-6);
    }));
  }, 30_000);

  it('largo limitado: sin Y-guy la AT 500-8 no da casillas por encima de 35 m', () => {
    const T = CRANES.xl;
    const ch = loadChart(T, baseConfig(T), 'out', null, T.yguy!.teleMax);
    ch.cols.forEach((col, j) => { if (col > T.yguy!.teleMax) expect(ch.cap.every((r) => r[j] === null)).toBe(true); });
  });

  it('angleFor invierte reach (también con plumín)', () => {
    const T = Object.values(CRANES).find((c) => c.jibDef)!;
    const C = { ...baseConfig(T), jib: T.jibDef!, jibRel: 30 * D };
    for (const R of [20, 35, 50]) {
      const a = angleFor(T, C, 40, R);
      if (a !== null) expect(reach(T, C, 40, a)).toBeCloseTo(R, 6);
    }
    expect(angleFor(CRANES.medium, baseConfig(CRANES.medium), 20, 500)).toBeNull();
  });

  it('marca de la posición actual y pasos redondos', () => {
    expect(niceSteps(11, 42, 8)).toEqual([11, 15, 20, 25, 30, 35, 40, 42]);
    const T = CRANES.medium, C = baseConfig(T);
    const ch = loadChart(T, C, 'out', null);
    const m = chartMark(ch, reach(T, C, 20, 50 * D), 20, 50 * D);
    expect(ch.cols[m.col]).toBe(20);
    expect(Math.abs(ch.radii[m.row] - reach(T, C, 20, 50 * D))).toBeLessThanOrEqual(Math.max(...ch.radii.slice(1).map((r, i) => r - ch.radii[i])) / 2 + 1e-9);
  });

  it('se calcula rápido (360°, la grúa más cara)', () => {
    let worst = 0;
    for (const T of Object.values(CRANES)) {
      const C = baseConfig(T), t0 = performance.now();
      loadChart(T, C, T.crawler ? 'crawler' : 'out', null);
      worst = Math.max(worst, performance.now() - t0);
    }
    console.log(`tabla de 360°: peor ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(400);
  });
});
