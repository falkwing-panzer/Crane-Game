import { describe, expect, it } from 'vitest';
import { CRANES, type WheeledSpec } from '../../crane/cranes';
import { foldedTowerBox, MAST_HALF, towerDeck, towerParts } from './tower';
import { layout } from './layout';
import { towerGeom } from '../../crane/tower';
import type { P3 } from './lattice';

// Fase 8: dibujo de la grúa torre de la SK 60 (models/tower.ts) en todo el montaje.

const D = Math.PI / 180;
const T = CRANES.sk as WheeledSpec;
const L = layout(T);
const deck = towerDeck(T);

/** Puntos de cada barra (cada 0,25 m) con su radio, y esquinas de cada caja */
function points(er: number, ang: number, Lb: number) {
  const P = towerParts(T, er, ang, Lb);
  const pts: { p: P3; r: number }[] = [];
  for (const s of [...P.chords, ...P.diags]) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]), n = Math.max(1, Math.ceil(len / 0.25));
    // lo que baja el cilindro de su eje: r·√(1 − u_y²) (de pie, nada)
    const uy = (s.b[1] - s.a[1]) / len, r = s.r * Math.sqrt(Math.max(0, 1 - uy * uy));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push({ p: [s.a[0] + (s.b[0] - s.a[0]) * k, s.a[1] + (s.b[1] - s.a[1]) * k, s.a[2] + (s.b[2] - s.a[2]) * k], r });
    }
  }
  for (const b of [...P.boxes, ...P.plates]) {
    if ('color' in b && b.color === 'tie') continue;
    const [ux, uy] = b.ax, nx = -uy, ny = ux;
    for (const a of [-0.5, 0.5]) for (const c of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
      pts.push({ p: [b.c[0] + ux * a * b.size[0] + nx * c * b.size[1], b.c[1] + uy * a * b.size[0] + ny * c * b.size[1], b.c[2] + z * b.size[2]], r: 0 });
    }
  }
  return { P, pts };
}

const ERS = Array.from({ length: 101 }, (_, i) => i / 100);

describe('grúa torre SK 60: dibujo', () => {
  it('la cabina del conductor queda bajo la torre plegada', () => {
    expect(L.cab.y1).toBeCloseTo(T.deckHi + 0.6, 9);
    expect(L.cab.x1).toBe(T.len[1]);
  });

  it('en todo el montaje nada baja de la plataforma ni de la cubierta del camión, ni entra en la cabina del operador', () => {
    const top = deck.platform.y1, c = deck.cab, bad: string[] = [];
    for (const er of ERS) {
      for (const { p, r } of points(er, 0, T.boom.min).pts) {
        if (p[1] - r < top - 1e-6) bad.push(`er ${er}: ${p[1] - r} bajo la plataforma`);
        if (p[0] > c.x0 && p[0] < c.x1 && p[1] < c.y1 && p[2] > c.z0 && p[2] < c.z1) bad.push(`er ${er}: en la cabina`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('montada, en todo el recorrido del carro y de la pluma nada baja a la cabina del operador', () => {
    const c = deck.cab, bad: string[] = [];
    for (const ang of [0, 15 * D, 30 * D]) for (const Lb of [3, 30, 60]) {
      for (const { p, r } of points(1, ang, Lb).pts) {
        if (p[0] + r > c.x0 && p[0] - r < c.x1 && p[2] + r > c.z0 && p[2] - r < c.z1 && p[1] - r <= c.y1) bad.push(`${ang} ${Lb}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('la pluma va siempre del lado contrario a la torre y la contrapluma por detrás de ella', () => {
    for (const er of ERS) {
      const g = towerGeom(T, { er, ang: 0, slew: 0 });
      const tA = (g.p1 * Math.PI) / 2, nd = [-Math.sin(tA), Math.cos(tA)];
      const { P } = points(er, 0, T.boom.min);
      const base = [0, P.top[1] - Math.sin(tA) * g.hgt];
      // distancia con signo al eje de la torre del lado de la celosía (nd)
      const side = (p: P3) => (p[0] - base[0]) * nd[0] + (p[1] - base[1]) * nd[1];
      // cordones: 4 de la torre, 4 del tramo interior, 4 de la pluma, 4 de la contrapluma
      const ch = P.chords;
      for (const s of ch.slice(0, 8)) expect(side(s.a)).toBeGreaterThan(-1e-6);
      // la pluma: en la parte que corre a lo largo de la torre (dentro de su largo), del otro lado
      const along = (p: P3) => (p[0] - base[0]) * Math.cos(tA) + (p[1] - base[1]) * Math.sin(tA);
      for (const s of ch.slice(8, 12)) for (const p of [s.a, s.b]) {
        if (along(p) > 0 && along(p) < g.hgt - 1.05) expect(side(p)).toBeLessThan(1e-6);
      }
      // contrapluma: más allá de la cara trasera de la torre (2·MAST_HALF) mientras corre a lo largo de ella
      for (const s of ch.slice(12, 16)) for (const p of [s.a, s.b]) {
        if (along(p) > 0 && along(p) < g.hgt - 1.05) expect(side(p)).toBeGreaterThan(2 * MAST_HALF);
      }
    }
  });

  it('plegada sobresale por delante del camión y su caja de choques la cubre', () => {
    const b = foldedTowerBox(T);
    expect(b.x1).toBeGreaterThan(T.len[1]);
    const { pts } = points(0, 0, T.boom.min);
    for (const { p } of pts) {
      const x = p[0] + T.piv; // marco del chasis
      expect(x).toBeLessThan(b.x1 + 1e-6);
      expect(p[1]).toBeGreaterThan(b.y0 - 1e-6);
      expect(p[1]).toBeLessThan(b.y1 + 0.85); // + bloques de lastre
    }
  });

  it('carro bajo la pluma en Lb, solo con la torre montada', () => {
    expect(points(0.99, 0, 10).P.boxes.some((b) => b.color === 'trolley')).toBe(false);
    const P = points(1, 0, 10).P, tr = P.boxes.find((b) => b.color === 'trolley')!;
    expect(tr.c[0]).toBeCloseTo(10, 6);
    expect(tr.c[1]).toBeLessThan(P.top[1]);
  });
});
