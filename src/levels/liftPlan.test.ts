import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { OUT_LIFT, headPos, initialState, tipPos } from '../crane/kinematics';
import { supportMode } from '../crane/ops';
import { carrierPose } from '../crane/pose';
import { lmiStatic, reach } from '../crane/stability';
import { Physics } from '../physics/world';
import { LEVELS } from './levels';
import { crateBases, levelBounds, placeCrane, populate } from './setup';
import { PLAN_MARGIN, RIG_H, crateNeedH, liftPlan, planMode, siteProblem, toCrane, toWorld, usefulContour, usefulRadius, planConfigs, type Ghost } from './liftPlan';

const D = Math.PI / 180;
const startGhost = (id: keyof typeof CRANES, i: number): Ghost => {
  const T = CRANES[id], S = initialState(T);
  placeCrane(T, S, LEVELS[i]);
  return { x: S.x, z: S.z, h: S.h };
};

describe('plan de izaje: geometría', () => {
  it('toCrane da el radio y el giro de headPos', () => {
    const T = CRANES.medium, g: Ghost = { x: 30, z: 20, h: 0.7 };
    for (const [Lb, ang, slew] of [[20, 40 * D, 0.3], [30, 10 * D, -2.1], [11, 70 * D, 3]]) {
      const hp = headPos(T, { Lb, ang, slew });
      const [x, z] = toWorld(g, hp.x, hp.z);
      const r = toCrane(T, g, x, z);
      expect(r.R).toBeCloseTo(reach(T, { mCw: 0, yOn: false, jib: null, jibRel: 0, slR: 0 }, Lb, ang), 6);
      expect(Math.cos(r.slew - slew)).toBeCloseTo(1, 9);
    }
  });
});

describe('plan de izaje: cada nivel con cada grúa, desde la salida', () => {
  LEVELS.forEach((L, i) => {
    for (const id of L.cranes) {
      it(`${i + 1}. ${L.name} con ${CRANES[id].name}: verde y ámbar son izajes que el LMI permite`, () => {
        const T = CRANES[id], g = startGhost(id, i), md = planMode(T);
        const plan = liftPlan(T, L, g);
        const bases = crateBases(L);
        plan.crates.forEach((cp, k) => {
          for (const [p, needH] of [[cp.pick, bases[k] + cp.crate.h + RIG_H], ...(cp.place ? [[cp.place, L.zones.find((z) => z.label === cp.place!.label)!.y + cp.crate.h + RIG_H] as const] : [])] as const) {
            if (!p.lift) { expect(p.grade).toBe('no'); continue; }
            const { Lb, ang, C, cap } = p.lift, { slew } = toCrane(T, g, p.x, p.z);
            expect(reach(T, C, Lb, ang)).toBeCloseTo(p.R, 4);
            const tip = tipPos(T, { Lb, ang, slew, jg: C.jib ? 1 : 0, jibRel: C.jibRel, er: 1 });
            expect(tip.y + (md === 'out' ? OUT_LIFT : 0)).toBeGreaterThanOrEqual(needH - 1e-9);
            const lmi = lmiStatic(T, C, md, Lb, ang, slew, cp.need);
            if (p.grade === 'ok') { expect(cp.need).toBeLessThanOrEqual(cap * PLAN_MARGIN + 1e-9); expect(lmi).toBeLessThan(1); }
            if (p.grade === 'tight') { expect(cp.need).toBeLessThanOrEqual(cap + 1e-9); expect(lmi).toBeLessThan(1); }
            if (p.grade === 'no') expect(cap).toBeLessThan(cp.need);
          }
        });
      });
    }
  });

  it('en cada nivel, cada carga se puede recoger y dejar con la grúa recomendada (si no, el plan sería demasiado estricto)', () => {
    // por separado: en el pick & carry (nivel 7) se recoge en un sitio y se deja en otro
    const bad: string[] = [];
    LEVELS.forEach((L, i) => {
      const T = CRANES[L.rec], g0 = startGhost(L.rec, i), configs = planConfigs(T, L);
      const pick = L.crates.map(() => false), place = L.crates.map(() => false);
      const [W, Dp] = L.size ?? [84, 56];
      for (let x = 2; x < W; x += 2) for (let z = 1; z < Dp; z += 1) for (const h of [g0.h, g0.h + Math.PI / 2]) {
        const g = { x, z, h };
        if (siteProblem(T, L, g)) continue;
        liftPlan(T, L, g, configs).crates.forEach((c, k) => {
          if (c.pick.grade !== 'no') pick[k] = true;
          if (c.place && c.place.grade !== 'no') place[k] = true;
        });
        if (pick.every(Boolean) && place.every(Boolean)) return;
      }
      if (!pick.every(Boolean) || !place.every(Boolean)) bad.push(`${i + 1}. ${L.name}`);
    });
    expect(bad).toEqual([]);
  }, 120_000);
});

describe('plan de izaje: radio útil', () => {
  it('dentro del radio útil se puede, un poco más afuera no', () => {
    const T = CRANES.medium, C = planConfigs(T, LEVELS[0]), md = planMode(T);
    for (const slew of [0, 90 * D, 180 * D]) {
      const R = usefulRadius(T, C, slew, 5);
      expect(R).toBeGreaterThan(5);
      const ok = (r: number) => C.some((c) => { for (let Lb = T.boom.min; Lb <= T.boom.max; Lb += 1) {
        const a = Math.acos((r - T.foot) / Lb);
        if (a <= T.boom.angMax && a >= T.boom.angMin && lmiStatic(T, c, md, Lb, a, slew, 5) < 1) return true;
      } return false; });
      expect(ok(R - 0.05)).toBe(true);
      expect(ok(R + 1.5)).toBe(false);
    }
    // dentro del contorno (con la altura de la carga), la recogida y el destino se pueden
    for (const i of [0, 1, 2, 7]) {
      const Li = LEVELS[i], Ti = CRANES[Li.rec], Ci = planConfigs(Ti, Li);
      for (let x = 6; x < 84; x += 9) for (let z = 5; z < 56; z += 8) {
        const g = { x, z, h: 0.4 }, plan = liftPlan(Ti, Li, g, Ci);
        plan.crates.forEach((cp, k) => {
          for (const p of [cp.pick, cp.place]) {
            if (!p) continue;
            const { slew } = toCrane(Ti, g, p.x, p.z);
            const Rok = usefulRadius(Ti, Ci, slew, cp.need, PLAN_MARGIN, crateNeedH(Li, k));
            if (p.R < Rok - 0.1 && p.R > 3) expect(p.grade, `${Li.name} ${cp.crate.label} R ${p.R.toFixed(1)} < ${Rok.toFixed(1)}`).toBe('ok');
          }
        });
      }
    }
    const ring = usefulContour(T, C, 5);
    expect(ring.length).toBe(36);
    expect(ring[9].R).toBeCloseTo(ring[27].R, 9); // simétrico a los lados
  });
});

describe('plan de izaje: el sitio coincide con los choques de la física', () => {
  beforeAll(async () => { await RAPIER.init(); });
  for (const i of [0, 2, 4, 8, 10]) {
    const L = LEVELS[i];
    it(`${i + 1}. ${L.name} con ${CRANES[L.rec].name}`, () => {
      const T = CRANES[L.rec], S = initialState(T);
      placeCrane(T, S, L);
      const P = new Physics(T, S, carrierPose(T, S, supportMode(S, T)), { testLoad: false, bounds: levelBounds(L) });
      populate(P, L);
      const pose = carrierPose(T, S, supportMode(S, T));
      for (let k = 0; k < 3; k++) P.step(S, pose); // las consultas usan el árbol del último paso
      let n = 0, diff: string[] = [];
      const [W, Dp] = L.size ?? [84, 56];
      for (let x = 2; x < W; x += 3.7) for (let z = 2; z < Dp; z += 3.3) for (const h of [0, 0.6, 1.9]) {
        const g = { x, z, h };
        const mine = siteProblem(T, L, g) === null;
        const phys = P.carrierBlocked(x, z, h) === null && (!T.out || P.padsBlocked({ ...S, x, z, h }) === null);
        n++;
        // justo en el borde (a 2 cm cambia la respuesta) los dos pueden decir una cosa u otra
        const edge = [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]].some(([dx, dz]) => (siteProblem(T, L, { x: x + dx, z: z + dz, h }) === null) !== mine);
        if (mine !== phys && !edge) diff.push(`(${x.toFixed(1)}, ${z.toFixed(1)}, ${h}) plan ${mine} física ${phys}`);
      }
      expect(n).toBeGreaterThan(300);
      expect(diff).toEqual([]);
    });
  }
});

describe('plan de izaje: tiempo', () => {
  it('cada recálculo al mover el fantasma y cada contorno son rápidos', () => {
    let worst = 0, worstRing = 0, where = '';
    LEVELS.forEach((L, i) => {
      for (const id of L.cranes) {
        const T = CRANES[id], g = startGhost(id, i), configs = planConfigs(T, L);
        let t0 = performance.now();
        liftPlan(T, L, g, configs);
        const dt = performance.now() - t0;
        if (dt > worst) { worst = dt; where = `${i + 1} ${T.name}`; }
        t0 = performance.now();
        usefulContour(T, configs, L.crates[0].m + T.hookM);
        worstRing = Math.max(worstRing, performance.now() - t0);
      }
    });
    console.log(`plan: peor ${worst.toFixed(1)} ms (${where}); contorno: peor ${worstRing.toFixed(1)} ms`);
    expect(worst).toBeLessThan(150);
    expect(worstRing).toBeLessThan(400);
  });
});
