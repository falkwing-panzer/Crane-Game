import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { supportMode, dynamicStability } from '../crane/ops';
import { carrierPose, worldToCarrier } from '../crane/pose';
import { baseConfig, lmiStatic } from '../crane/stability';
import { FIXED_DT, Physics } from '../physics/world';
import { TANDEM_IDS, TEST_COLUMN, placeTandem } from './tandemSetup';

// La prueba libre del tándem (?tandem=1): las dos grúas se arman sin chocar, enganchan cada una su orejeta,
// levantan la columna de 400 t y cada una lleva su parte por palanca, dentro de su capacidad.
describe('prueba libre del tándem', () => {
  beforeAll(async () => { await RAPIER.init(); });

  const build = () => {
    const units = TANDEM_IDS.map((id) => { const T = CRANES[id]; return { T, S: initialState(T), C: baseConfig(T) }; });
    placeTandem(units[0], units[1]);
    const poses = units.map((u) => carrierPose(u.T, u.S, supportMode(u.S, u.T)));
    const A = new Physics(units[0].T, units[0].S, poses[0], { testLoad: false });
    const B = new Physics(units[1].T, units[1].S, poses[1], { site: A });
    const c = TEST_COLUMN;
    const col = A.addLoad(c.label, c.mass, c.half, c.pos, { lugs: c.lugs });
    const list = [{ phys: A, ...units[0], pose: poses[0] }, { phys: B, ...units[1], pose: poses[1] }];
    const step = (s: number, hoist: [number, number] = [0, 0]) => {
      for (let i = 0; i < Math.round(s / FIXED_DT); i++) {
        list.forEach((u, k) => { u.S.cable = Math.max(1, u.S.cable + hoist[k] * FIXED_DT); });
        Physics.stepCrew(list);
      }
    };
    return { list, A, B, col, step };
  };

  it('las grúas empiezan sin tocar nada', () => {
    const { list, step } = build();
    step(0.1);
    for (const u of list) {
      expect(u.phys.carrierBlocked(u.S.x, u.S.z, u.S.h), u.T.name).toBeNull();
      expect(u.phys.tailBlocked(u.S, u.S.slew, u.S.cw), u.T.name).toBeNull();
      expect(u.phys.trayBlocked(u.S.x, u.S.z, u.S.h, u.S.slew, u.C.slR), u.T.name).toBeNull();
    }
  });

  it('levantan la columna entre las dos y cada una lleva su parte', () => {
    const { list, A, B, col, step } = build();
    step(1);
    expect(A.toggleHook()).toContain('por la cabeza');
    expect(B.toggleHook()).toContain('por el pie');
    step(8, [-0.25, -0.25]);
    step(5);
    expect(col.body.translation().y).toBeGreaterThan(3.5);
    const sa = A.slingShare()!, sb = B.slingShare()!;
    // palanca: cabeza en x = +21,5 y pie en x = −18 → 400·18/39,5 y 400·21,5/39,5
    expect(sa + sb).toBeGreaterThan(395);
    expect(sa + sb).toBeLessThan(405);
    expect(Math.abs(sa - 400 * 18 / 39.5)).toBeLessThan(5);
    expect(Math.abs(sb - 400 * 21.5 / 39.5)).toBeLessThan(5);
    // la columna no toca nada (ni los ganchos): toda la carga va por las eslingas
    let touching = 0;
    A.world.contactPairsWith(col.collider, (o) => A.world.contactPair(col.collider, o, (m) => { touching += m.numContacts(); }));
    expect(touching).toBe(0);
    // cada grúa, con su parte, por debajo del 100 % de LMI
    for (const u of list) {
      const md = supportMode(u.S, u.T);
      const dyn = dynamicStability(u.T, u.C, u.S, md, u.phys.tension, worldToCarrier(u.S, u.phys.gp));
      expect(dyn.lmi, u.T.name).toBeLessThan(1);
      expect(lmiStatic(u.T, u.C, md, u.S.Lb, u.S.ang, u.S.slew, u.T.hookM + u.phys.slingShare()!), u.T.name).toBeLessThan(1);
    }
  });
});
