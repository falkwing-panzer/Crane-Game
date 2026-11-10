import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES, type CrawlerSpec, type WheeledSpec } from '../../crane/cranes';
import { initialState, stepCrane, type CraneInput } from '../../crane/kinematics';
import { carrierPose } from '../../crane/pose';
import { Physics } from '../../physics/world';
import { blockPieces, cwPieces, fixedBlock, layout, towerOutline, WHEELED_IDS } from './layout';
import { crawlerLayout, cwBlock, trayBlock } from './crawlerLayout';
import { towerParts } from './tower';

// Fase 8B (parte 1): contrapeso de cada grúa en el estilo de contrapeso-torres.png. Solo dibujo: la planta de
// cwDims de la referencia no cambia.

const D = Math.PI / 180;
const idle = (): CraneInput => ({ slew: 0, luff: 0, tele: 0, hoist: 0, fine: false });

describe('grúas de ruedas: contrapeso fijo', () => {
  for (const id of WHEELED_IDS) {
    const T = CRANES[id] as WheeledSpec, L = layout(T), fb = fixedBlock(L);
    it(`${T.name}: dentro de la planta de cwDims, bajo el cabrestante y bajo el radio de cola`, () => {
      if (L.ballast?.kind === 'stack') { expect(fb).toBeNull(); return; } // la pieza base ya es parte de la torre
      const f = blockPieces(fb!), cw = L.cw;
      const boxes = [...f.plates.map((p) => p.box), ...f.frame.map((p) => p.box)];
      for (const b of boxes) {
        expect(b.x0).toBeGreaterThanOrEqual(cw.x - cw.len / 2 - 1e-9);
        expect(b.x1).toBeLessThanOrEqual(cw.front + 1e-9);
        expect(Math.max(Math.abs(b.z0), Math.abs(b.z1))).toBeLessThanOrEqual(cw.w + 1e-9);
        expect(b.y0).toBeGreaterThanOrEqual(cw.y0 - 1e-9);
      }
      // el cabrestante se apoya encima (o delante de la torre de lastre)
      for (const b of f.plates.map((p) => p.box)) expect(b.y1).toBeLessThanOrEqual(L.drum.y0 + 1e-9);
      for (const [x, z] of towerOutline(f.plan)) expect(L.tailR).toBeGreaterThanOrEqual(Math.hypot(x, z) - 1e-9);
    });
    if (!L.ballast) it(`${T.name}: placas achaflanadas, 2 de arriba en el color de la grúa, torres solo si caben`, () => {
      const f = blockPieces(fb!);
      const right = f.plates.filter((p) => p.side > 0);
      expect(right.length).toBe(Math.round(L.cw.hgt / 0.42));
      expect(right.filter((p) => p.color === 'top').length).toBe(2);
      expect(f.plan.chx).toBeGreaterThan(0);
      // AT 220 (3 m de largo): dos torres con hueco y bastidor; las cortas, un solo bloque
      if (L.cw.len >= 2.5) {
        expect(f.plan.zi).toBeGreaterThan(0.3);
        expect(f.frame.some((x) => x.color === 'frame')).toBe(true);
      } else expect(f.plan.zi).toBe(0);
      // el chaflán acorta el radio de cola respecto de la esquina sin recortar
      expect(Math.hypot(f.plan.xr, f.plan.zo)).toBeGreaterThan(Math.max(...towerOutline(f.plan).map(([x, z]) => Math.hypot(x, z))));
    });
    if (L.ballast?.kind === 'slab') it(`${T.name}: el contrapeso base va en placas rectas (las torres de lastre van detrás)`, () => {
      const f = blockPieces(fb!);
      expect(f.plates.length).toBe(0);
      expect(f.frame.length).toBeGreaterThan(1);
      expect(cwPieces(T, L, 1).plates.length).toBeGreaterThan(0);
    });
  }
});

describe('orugas: contrapeso de la superestructura y bandeja del superlift', () => {
  for (const id of ['crawler', 'lr'] as const) {
    const T = CRANES[id] as CrawlerSpec, L = crawlerLayout(T);
    it(`${T.name}: dos torres dentro de cwDims, bastidor de todo el alto (tirantes) y bajo el radio de cola`, () => {
      const f = blockPieces(cwBlock(L)), cw = L.cw;
      expect(f.plan.zi).toBeGreaterThan(0.3);
      expect(f.plates.filter((p) => p.side > 0).length).toBe(Math.round(cw.hgt / 0.42)); // LR 300: 6, LR 3000: 14
      for (const p of f.plates) {
        expect(p.box.x0).toBeGreaterThanOrEqual(cw.x - cw.len / 2 - 1e-9);
        expect(p.box.x1).toBeLessThanOrEqual(cw.x + cw.len / 2 + 1e-9);
        expect(Math.abs(p.box.z1)).toBeLessThanOrEqual(cw.w + 1e-9);
        expect(p.box.y1).toBeLessThanOrEqual(cw.top + 1e-9);
      }
      const fr = f.frame.find((x) => x.color === 'frame')!.box;
      // tirante del caballete (LR 300, a yd + 2,8) o del derrick (LR 3000, a lo alto del contrapeso) en el bastidor
      expect(fr.y1).toBeGreaterThanOrEqual(T.derrick ? cw.top - 1e-9 : L.yd + 2.8);
      expect(fr.x0).toBeLessThan(cw.x);
      expect(fr.x1).toBeGreaterThan(cw.x);
      for (const [x, z] of towerOutline(f.plan)) expect(L.tailR).toBeGreaterThanOrEqual(Math.hypot(x, z) - 1e-9);
      // el cuerpo trasero empieza delante del contrapeso
      expect(L.rearBody.x0).toBeGreaterThanOrEqual(f.plan.xf - 1e-9);
    });
  }

  it('LR 3000: la bandeja lleva dos pilas achaflanadas y los amarres de los tirantes quedan sobre las placas', () => {
    const t = crawlerLayout(CRANES.lr as CrawlerSpec).tray!, f = blockPieces(trayBlock(t)), p = f.plan;
    expect(f.plates.filter((q) => q.side > 0).length).toBe(t.plates);
    expect(p.zi).toBeGreaterThan(0.3);
    for (const [x, z] of t.hangers) {
      const az = Math.abs(z);
      expect(az).toBeGreaterThan(p.zi + 0.2);
      expect(az).toBeLessThan(p.zo - 0.2);
      expect(x).toBeGreaterThan(p.xr);
      // fuera del chaflán de la esquina trasera exterior: del lado interior de la recta del chaflán
      const [ax, azc] = [p.xr + p.chx, p.zo], [bx, bz] = [p.xr, p.zo - p.chz];
      const cross = (bx - ax) * (az - azc) - (bz - azc) * (x - ax);
      expect(cross).toBeGreaterThan(0); // (el centro de la pila da > 0)
    }
  });
});

describe('SK 60: lastre de la contrapluma', () => {
  it('3 placas en dos mitades achaflanadas; la del extremo en el color de la grúa', () => {
    const P = towerParts(CRANES.sk, 1, 0, 3);
    expect(P.plates.length).toBe(6);
    expect(P.plates.filter((q) => q.color === 'top').length).toBe(2);
    expect(P.plates.filter((q) => q.side > 0).length).toBe(3);
  });
});

describe('choques del contrapeso al girar (fase 8B: todas las grúas)', () => {
  beforeAll(async () => { await RAPIER.init(); });

  for (const id of ['small', 'large', 'crawler'] as const) {
    const T = CRANES[id];
    it(`${T.name}: el giro se detiene antes de que el contrapeso toque un pilar`, () => {
      const S = initialState(T);
      if (T.out) S.out = 1;
      const pose = carrierPose(T, S, T.crawler ? 'crawler' : 'out');
      const P = new Physics(T, S, pose);
      const b = P.towerBox(0)!;
      expect(b).not.toBeNull();
      // pilar donde quedaría el contrapeso (torre derecha) con la superestructura girada 90° a la izquierda
      P.addObstacle({ label: 'Pilar', kind: 'block', half: { x: 0.4, y: 4, z: 0.4 }, pos: { x: T.piv + b.cz, y: 4, z: -b.cx }, rotY: 0 });
      P.step(S, pose);
      expect(P.tailBlocked(S, 0, 0)).toBeNull();
      expect(P.tailBlocked(S, 90 * D, 0)).toMatch(/contrapeso/);
      for (let i = 0; i < 60 * 60; i++) {
        stepCrane(T, S, { ...idle(), slew: 1 }, 1 / 60, {
          lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, slewBlocked: (s) => !!P.tailBlocked(s, s.slew, s.cw),
        });
      }
      expect(S.slew).toBeGreaterThan(20 * D);
      expect(S.slew).toBeLessThan(90 * D);
    });
  }
});
