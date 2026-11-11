import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState, stepCrane } from '../crane/kinematics';
import { supportMode } from '../crane/ops';
import { carrierPose } from '../crane/pose';
import { baseConfig, lmiStatic } from '../crane/stability';
import { FIXED_DT, Physics } from '../physics/world';
import { LEVELS } from './levels';
import { allPlaced, levelBounds, populate } from './setup';
import { ALL_LEVELS, ROLL_MAX, SIDE_MAX, TANDEM_LEVEL, cableAngle, placeTandem, rollOf, tandemColumn } from './tandemSetup';

const L = TANDEM_LEVEL;
const idle = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false, sl: 0, jib: 0 };

describe('nivel de tándem: datos', () => {
  it('es el 14, después de los 13 de la referencia, que no cambian', () => {
    expect(ALL_LEVELS.length).toBe(14);
    expect(ALL_LEVELS.slice(0, 13)).toEqual(LEVELS);
    expect(ALL_LEVELS[13]).toBe(L);
  });

  it('columna de 40 m, Ø 5 m y 400 t con dos orejetas; obra de 120 × 80 m', () => {
    const c = L.crates[0];
    expect([c.w, c.d, c.h, c.m]).toEqual([40, 5, 5, 400]);
    expect(c.lugs).toHaveLength(2);
    expect(L.size).toEqual([120, 80]);
    for (const z of L.zones) {
      expect(z.x - z.w / 2).toBeGreaterThan(0);
      expect(z.x + z.w / 2).toBeLessThan(120);
      // la columna de pie (5 × 5 m) cabe en la cimentación
      expect(Math.min(z.w, z.d)).toBeGreaterThan(5);
    }
    expect(CRANES[L.tandem!.main.id].name).toBe('LR 3000');
    expect(CRANES[L.tandem!.tail.id].name).toBe('AT 500-8');
  });
});

describe('nivel de tándem en Rapier', () => {
  beforeAll(async () => { await RAPIER.init(); });

  const build = () => {
    const units = [L.tandem!.main.id, L.tandem!.tail.id].map((id) => { const T = CRANES[id]; return { T, S: initialState(T), C: baseConfig(T) }; });
    placeTandem(units[0], units[1], L.tandem!, tandemColumn(L));
    const poses = units.map((u) => carrierPose(u.T, u.S, supportMode(u.S, u.T)));
    const A = new Physics(units[0].T, units[0].S, poses[0], { testLoad: false, bounds: levelBounds(L) });
    const B = new Physics(units[1].T, units[1].S, poses[1], { site: A });
    populate(A, L);
    const list = [{ phys: A, ...units[0], pose: poses[0] }, { phys: B, ...units[1], pose: poses[1] }];
    /** Avanza: la grúa `who` con los mandos `inp` (la otra quieta), como el juego */
    const step = (s: number, who = 0, inp = idle) => {
      for (let i = 0; i < Math.round(s / FIXED_DT); i++) {
        list.forEach((u, k) => {
          stepCrane(u.T, u.S, k === who ? inp : idle, FIXED_DT);
          u.pose = carrierPose(u.T, u.S, supportMode(u.S, u.T));
        });
        Physics.stepCrew(list);
      }
    };
    return { list, A, B, col: A.loads[0], step };
  };

  it('las grúas empiezan montadas, dentro de la obra y sin tocar nada; la columna, quieta en el transportador', () => {
    const { list, col, step } = build();
    const home = { ...col.home };
    step(2);
    for (const u of list) {
      expect(u.phys.carrierBlocked(u.S.x, u.S.z, u.S.h), u.T.name).toBeNull();
      expect(u.phys.padsBlocked(u.S), u.T.name).toBeNull();
      expect(u.phys.tailBlocked(u.S, u.S.slew, u.S.cw), u.T.name).toBeNull();
      expect(u.phys.trayBlocked(u.S.x, u.S.z, u.S.h, u.S.slew, u.C.slR), u.T.name).toBeNull();
    }
    const t = col.body.translation();
    expect(Math.hypot(t.x - home.x, t.y - home.y, t.z - home.z)).toBeLessThan(0.05);
    expect(home.y).toBeCloseTo(1.8 + 2.5, 6); // sobre el transportador de 1,8 m
    expect(rollOf(col.body.rotation())).toBeLessThan(0.01);
  });

  it('cada grúa engancha su orejeta; al separarla del transportador se reparten por palanca con los cables verticales', () => {
    const { list, A, B, col, step } = build();
    step(1);
    expect(A.toggleHook()).toContain('por la cabeza');
    expect(B.toggleHook()).toContain('por el pie');
    // como en el juego: iza una, luego la otra (Tab), de a poco
    let maxSide = 0;
    for (let k = 0; k < 6; k++) {
      for (const who of [0, 1]) {
        for (let i = 0; i < 60; i++) {
          step(FIXED_DT, who, { ...idle, hoist: -1 });
          list.forEach((u) => { if (u.phys.slingShare()! > 5) maxSide = Math.max(maxSide, cableAngle(u.phys.headWorld(), u.phys.hookTop())); });
        }
      }
    }
    step(4);
    expect(col.body.translation().y - col.home.y).toBeGreaterThan(1);
    const sa = A.slingShare()!, sb = B.slingShare()!;
    // palanca: cabeza en x = −21,5 y pie en x = +18 → 400·18/39,5 y 400·21,5/39,5
    expect(Math.abs(sa - 400 * 18 / 39.5)).toBeLessThan(8);
    expect(Math.abs(sb - 400 * 21.5 / 39.5)).toBeLessThan(8);
    // izar así no da tiro lateral ni ladea la columna
    expect(maxSide).toBeLessThan(SIDE_MAX);
    expect(rollOf(col.body.rotation())).toBeLessThan(ROLL_MAX / 4);
    // las dos, por debajo del 100 % con su parte
    for (const u of list) {
      expect(lmiStatic(u.T, u.C, supportMode(u.S, u.T), u.S.Lb, u.S.ang, u.S.slew, u.T.hookM + u.phys.slingShare()!), u.T.name).toBeLessThan(1);
    }
  });

  it('la LR 3000 puede llevar las 400 t hasta la cimentación (a unos 30 m)', () => {
    const { list } = build();
    const lr = list[0], z = L.zones[0];
    const r = Math.hypot(z.x - (lr.S.x + lr.T.piv), z.z - lr.S.z);
    expect(r).toBeGreaterThan(25);
    expect(r).toBeLessThan(35);
    // pluma para ese radio: la de 108 m entre 70° y 80°
    const ang = 74 * Math.PI / 180, md = supportMode(lr.S, lr.T);
    expect(lmiStatic(lr.T, lr.C, md, lr.S.Lb, ang, -Math.PI / 2, lr.T.hookM + 400)).toBeLessThan(0.6);
  });

  it('victoria: la columna de pie en la cimentación, sin ganchos; tumbada o fuera, no', () => {
    const { A, col, step } = build();
    const z = L.zones[0];
    const placed = () => allPlaced(A.loads.map((l) => A.placed(l)), L.zones);
    step(0.5);
    expect(placed()).toBe(false);
    // de pie: el eje x de la columna hacia arriba (giro de 90° alrededor de z)
    const s = Math.SQRT1_2;
    col.body.setRotation({ x: 0, y: 0, z: s, w: s }, true);
    col.body.setTranslation({ x: z.x, y: z.y + 20 + 0.01, z: z.z }, true);
    col.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    col.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    step(1);
    expect(A.placed(col)!.tilt).toBeLessThan(0.05);
    expect(placed()).toBe(true);
    expect(rollOf(col.body.rotation())).toBeLessThan(0.01);
  });

  it('el ladeo mide el giro sobre el eje largo, no el ponerla de pie', () => {
    const s = Math.SQRT1_2, r = 12 * Math.PI / 180;
    expect(rollOf({ x: 0, y: 0, z: s, w: s })).toBeLessThan(1e-9); // de pie
    expect(rollOf({ x: Math.sin(r / 2), y: 0, z: 0, w: Math.cos(r / 2) })).toBeCloseTo(r, 9); // tumbada, ladeada 12°
    expect(rollOf({ x: Math.sin(r / 2), y: 0, z: 0, w: Math.cos(r / 2) })).toBeGreaterThan(ROLL_MAX);
  });
});
