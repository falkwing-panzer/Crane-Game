import { describe, expect, it } from 'vitest';
import { dailySite, doable, generateSite, hashSeed, todayUTC } from './generate';
import { WD, WW } from './levels';

describe('obras generadas (fase 22)', () => {
  it('la misma fecha da la misma obra; otra fecha, otra', () => {
    const a = dailySite('2026-11-26'), b = dailySite('2026-11-26'), c = dailySite('2026-11-27');
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('fija: si cambia la generación, cambian los retos de todos (esta prueba lo avisa)', () => {
    expect(hashSeed('reto-2026-01-01')).toBe(1376702886);
    const L = dailySite('2026-01-01')!;
    expect({ rec: L.rec, n: L.crates.length, start: L.start, first: [L.crates[0].x, L.crates[0].z, L.crates[0].m] }).toMatchSnapshot();
  });

  it('30 días seguidos: todas se pueden hacer con la grúa recomendada, dentro de la obra', () => {
    for (let d = 1; d <= 30; d++) {
      const date = `2026-12-${String(d).padStart(2, '0')}`;
      const L = dailySite(date);
      expect(L, date).not.toBeNull();
      expect(doable(L!.rec, L!)).toBe(true);
      expect(L!.cranes).toContain(L!.rec);
      for (const c of [...L!.crates, ...L!.zones]) {
        expect(c.x - c.w / 2).toBeGreaterThan(0); expect(c.x + c.w / 2).toBeLessThan(WW);
        expect(c.z - c.d / 2).toBeGreaterThan(0); expect(c.z + c.d / 2).toBeLessThan(WD);
      }
    }
  }, 60_000);

  it('con opciones: solo las grúas pedidas y masas escaladas', () => {
    const L = generateSite(1234, { cranes: ['small'], massK: 0.5, crates: [2, 2] })!;
    expect(L.rec).toBe('small');
    expect(L.crates).toHaveLength(2);
    expect(Math.max(...L.crates.map((c) => c.m))).toBeLessThanOrEqual(2.5);
  });

  it('hoy en UTC', () => {
    expect(todayUTC(Date.UTC(2026, 10, 26, 23, 30))).toBe('2026-11-26');
  });
});

describe('reto diario en la URL (fase 22)', () => {
  it('?reto=fecha monta esa obra como trabajo, con el tiempo del rival; con una grúa que no sirve, la recomendada', async () => {
    const { sessionDef } = await import('../game/session');
    const d = sessionDef('?reto=2026-11-26&t=200&grua=sk');
    expect(d.job).toMatchObject({ kind: 'reto', key: 'reto-2026-11-26', rival: 200, date: '2026-11-26' });
    expect(d.L).toBe(d.job!.L);
    expect(d.li).toBe(-1);
    expect(d.ids).toEqual([d.L!.rec]);
    expect(sessionDef('?nivel=3').job).toBeNull();
  });
});
