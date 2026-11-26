import { describe, expect, it } from 'vitest';
import { CRANES, type CraneId } from '../crane/cranes';
import { doable } from './generate';
import { SAFETY_LEVELS } from './safety';
import { EXCL_R, overWorker, workerAt } from './people';
import { WD, WW } from './levels';

describe('niveles de la fase 23', () => {
  it('cada grúa permitida tiene sitio y llega con la carga a la zona (plan de izaje); las que no, no', () => {
    for (const L of SAFETY_LEVELS) {
      for (const id of L.cranes) expect(doable(id, L), `${L.name}: ${id}`).toBe(true);
      expect(L.cranes).toContain(L.rec);
      for (const id of Object.keys(CRANES) as CraneId[]) if (!L.cranes.includes(id)) expect(L.why[id], `${L.name}: ${id}`).toBeTruthy();
    }
  });

  it('cesta: con cada grúa permitida la plataforma queda por debajo del 50 % de LMI (con margen)', async () => {
    const { liftPlan } = await import('./liftPlan');
    const { initialState } = await import('../crane/kinematics');
    const { placeCrane } = await import('./setup');
    const L = SAFETY_LEVELS[2];
    for (const id of L.cranes) {
      const T = CRANES[id], S = initialState(T);
      placeCrane(T, S, L);
      const c = liftPlan(T, L, { x: S.x, z: S.z, h: S.h }).crates[0];
      expect(c.need / c.place!.lift!.cap, id).toBeLessThan(0.45);
      expect(c.need / c.pick.lift!.cap, id).toBeLessThan(0.45);
    }
  });

  it('los trabajadores caminan dentro de la obra y fuera de las cajas, y vuelven', () => {
    for (const L of SAFETY_LEVELS) {
      for (const w of L.workers ?? []) {
        for (let t = 0; t < 120; t += 0.5) {
          const p = workerAt(w, t);
          expect(p.x).toBeGreaterThan(1); expect(p.x).toBeLessThan(WW - 1);
          expect(p.z).toBeGreaterThan(1); expect(p.z).toBeLessThan(WD - 1);
          for (const b of L.boxes) expect(Math.abs(p.x - b.x) < b.w / 2 + 0.3 && Math.abs(p.z - b.z) < b.d / 2 + 0.3, `${L.name} ${t}`).toBe(false);
        }
      }
    }
    const w = { pts: [[0, 0], [10, 0]] as [number, number][], speed: 1, wait: 2 };
    expect(workerAt(w, 1)).toMatchObject({ x: 0, moving: false });
    expect(workerAt(w, 7).x).toBeCloseTo(5, 6);
    expect(workerAt(w, 13)).toMatchObject({ x: 10, moving: false });
    expect(workerAt(w, 19).x).toBeCloseTo(5, 6);
    expect(workerAt(w, 24).x).toBeCloseTo(0, 6);
  });

  it('carga encima de alguien: en planta con su zona de exclusión, y solo si está en el aire', () => {
    const ws = [{ pts: [[10, 10], [10, 10]] as [number, number][], speed: 1 }];
    expect(overWorker({ x: 10 + EXCL_R + 0.9, z: 10, r: 1, bottom: 2 }, ws, 0)).toBe(0);
    expect(overWorker({ x: 10 + EXCL_R + 1.1, z: 10, r: 1, bottom: 2 }, ws, 0)).toBe(-1);
    expect(overWorker({ x: 10, z: 10, r: 1, bottom: 0.1 }, ws, 0)).toBe(-1);
  });
});
