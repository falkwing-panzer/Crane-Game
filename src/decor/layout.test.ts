import { describe, expect, it } from 'vitest';
import { decorFor, LEVEL_ENV, FENCE, SITE_HALF_DECOR, rectDist, type Rect } from './layout';
import { windYaw, sockDroop } from './wind';
import { ALL_LEVELS } from '../levels/tandemSetup';
import { SITE_HALF } from '../physics/world';
import type { Prim } from './kit';

const cases = [...ALL_LEVELS.map((L, i) => ({ n: i + 1, L })), { n: 0, L: null }];

/** Caja en planta de una primitiva */
function plan(p: Prim): Rect {
  if (p.k === 'cyl') {
    const r = Math.max(p.r0, p.r1);
    return { x0: Math.min(p.a[0], p.b[0]) - r, x1: Math.max(p.a[0], p.b[0]) + r, z0: Math.min(p.a[2], p.b[2]) - r, z1: Math.max(p.a[2], p.b[2]) + r };
  }
  const c = Math.abs(Math.cos(p.r)), s = Math.abs(Math.sin(p.r));
  const hx = (c * p.sx + s * p.sz) / 2, hz = (s * p.sx + c * p.sz) / 2;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

describe('decorado (fase 17)', () => {
  it('un entorno por nivel y el medio lado de la prueba libre es el de la física', () => {
    expect(LEVEL_ENV.length).toBe(ALL_LEVELS.length);
    expect(SITE_HALF_DECOR).toBe(SITE_HALF);
  });

  it('siempre sale igual (semilla por nivel)', () => {
    for (const { n, L } of cases) expect(JSON.stringify(decorFor(n, L))).toBe(JSON.stringify(decorFor(n, L)));
  });

  for (const { n, L } of cases) it(`${L ? `nivel ${n} (${L.name})` : 'prueba libre'}: nada dentro de la obra ni de las reservas`, () => {
    const D = decorFor(n, L);
    const inner: Rect = { x0: D.rect.x0 - FENCE + 0.5, x1: D.rect.x1 + FENCE - 0.5, z0: D.rect.z0 - FENCE + 0.5, z1: D.rect.z1 + FENCE - 0.5 };
    // ninguna pieza (salvo conos, que van junto al portón por fuera de la valla o sobre el camino) dentro de la valla
    for (const p of [...D.kit.near, ...D.kit.far, ...D.kit.detail]) expect(overlap(plan(p), inner), JSON.stringify(p)).toBe(false);
    for (const s of D.kit.solids) {
      const c = Math.abs(Math.cos(s.r)), sn = Math.abs(Math.sin(s.r));
      const hx = c * s.hx + sn * s.hz, hz = sn * s.hx + c * s.hz;
      const b: Rect = { x0: s.x - hx, x1: s.x + hx, z0: s.z - hz, z1: s.z + hz };
      expect(overlap(b, inner)).toBe(false);
    }
    // reservas extra (franja del plumín del nivel 11): ni piezas ni valla
    for (const q of D.keep.slice(1)) {
      for (const p of [...D.kit.near, ...D.kit.far, ...D.kit.detail]) expect(overlap(plan(p), q), JSON.stringify(p)).toBe(false);
    }
    // lo cercano tiene colisionadores; nada sólido lejos
    for (const s of D.kit.solids) expect(rectDist(D.rect, s.x, s.z)).toBeLessThan(80);
    expect(D.kit.solids.length).toBeGreaterThan(20);
    expect(D.kit.solids.length).toBeLessThan(1200);
    if (!D.city) expect(D.kit.fence.length).toBeGreaterThan(3); // en la ciudad, paneles con lona (cajas)
    expect(D.socks.length).toBe(1);
  });

  it('el nivel 11 deja libre la franja del plumín al oeste', () => {
    const D = decorFor(11, ALL_LEVELS[10]);
    expect(D.keep.length).toBe(2);
    expect(D.keep[1].x1).toBeLessThanOrEqual(0);
  });

  it('las líneas eléctricas del nivel 3 siguen fuera de la obra con sus torres', () => {
    const D = decorFor(3, ALL_LEVELS[2]);
    expect(D.wires.length).toBe(12);
    for (const [a, b] of D.wires) expect(a[1]).toBe(b[1]);
  });

  it('la manga apunta a sotavento', () => {
    for (const deg of [0, 90, 200, 270, 300]) {
      const r = windYaw(deg), a = (deg * Math.PI) / 180;
      // +x local girado r alrededor de y: (cos r, −sin r)
      expect(Math.cos(r)).toBeCloseTo(Math.cos(a), 9);
      expect(-Math.sin(r)).toBeCloseTo(Math.sin(a), 9);
    }
    expect(sockDroop(0)).toBeGreaterThan(1.2);
    expect(sockDroop(10)).toBe(0);
  });
});
