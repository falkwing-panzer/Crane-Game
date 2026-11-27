import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState, stepCrane, type CraneInput } from '../crane/kinematics';
import { baseConfig, lmiStatic } from '../crane/stability';
import { apply, carrierPose, rotate } from '../crane/pose';
import { supportMode } from '../crane/ops';
import { Physics, FIXED_DT } from '../physics/world';
import { levelBounds, populate } from './setup';
import { FLIP_LEVEL } from './flip';
import { ALL_LEVELS, ROLL_MAX, SIDE_MAX, SIDE_LOAD, SIDE_T, cableAngle, placeTandem, rollOf, tandemColumn } from './tandemSetup';

// Fase 26: nivel 23, voltear un depósito con dos grúas. Un guion que maneja las dos por turnos (como Tab) lo pone de
// pie y lo deja en la cimentación sin pasar los límites del nivel (LMI, tiro lateral, ladeo).

const L = FLIP_LEVEL;
const idle: CraneInput = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false };
const clamp = (v: number, m = 1) => Math.max(-m, Math.min(m, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function build() {
  const units = [L.tandem!.main.id, L.tandem!.tail.id].map((id) => { const T = CRANES[id]; return { T, S: initialState(T), C: baseConfig(T) }; });
  placeTandem(units[0], units[1], L.tandem!, tandemColumn(L));
  const poses = units.map((u) => carrierPose(u.T, u.S, supportMode(u.S, u.T)));
  const A = new Physics(units[0].T, units[0].S, poses[0], { testLoad: false, bounds: levelBounds(L) });
  const B = new Physics(units[1].T, units[1].S, poses[1], { site: A });
  populate(A, L);
  const list = [{ phys: A, ...units[0], pose: poses[0] }, { phys: B, ...units[1], pose: poses[1] }];
  return { list, A, B, col: A.loads[0] };
}

describe('nivel 23: volteo de un depósito', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('es el nivel 23, de tándem con la AT 500-8 y la AT 220', () => {
    expect(ALL_LEVELS.indexOf(L)).toBe(22);
    expect(CRANES[L.tandem!.main.id].name).toBe('AT 500-8');
    expect(CRANES[L.tandem!.tail.id].name).toBe('AT 220');
  });

  it('las grúas empiezan montadas, dentro de la obra y sin tocar nada', () => {
    const { list, col } = build();
    for (let i = 0; i < 120; i++) Physics.stepCrew(list);
    for (const u of list) {
      expect(u.phys.carrierBlocked(u.S.x, u.S.z, u.S.h), u.T.name).toBeNull();
      expect(u.phys.padsBlocked(u.S), u.T.name).toBeNull();
      expect(u.phys.tailBlocked(u.S, u.S.slew, u.S.cw), u.T.name).toBeNull();
    }
    const t = col.body.translation();
    expect(Math.hypot(t.x - col.home.x, t.y - col.home.y, t.z - col.home.z)).toBeLessThan(0.05);
  });

  it('un guion lo pone de pie con las dos grúas y lo deja en la cimentación sin pasar los límites', () => {
    const { list, A, B, col } = build();
    let who = 0, k = 0, maxLmi = 0, maxSide = 0, maxRoll = 0;
    /** Tiro lateral como la regla del nivel: segundos seguidos por encima de SIDE_MAX con más de SIDE_LOAD t */
    const sideT = [0, 0];
    /** Mandos para llevar la punta de la grúa u sobre (x, z) */
    const track = (u: (typeof list)[number], x: number, z: number): Partial<CraneInput> => {
      const piv = apply(u.pose, { x: u.T.piv, y: 0, z: 0 }), tip = u.phys.headWorld();
      const aT = Math.atan2(-(tip.z - piv.z), tip.x - piv.x), aG = Math.atan2(-(z - piv.z), x - piv.x);
      const rT = Math.hypot(tip.x - piv.x, tip.z - piv.z), rG = Math.hypot(x - piv.x, z - piv.z);
      const dA = wrap(aG - aT) * rG, dR = rG - rT;
      return { slew: Math.abs(dA) > 0.05 ? clamp(dA * 1.5) : 0, tele: Math.abs(dR) > 0.05 ? clamp(dR * 1.2) : 0, fine: Math.abs(dA) < 0.15 && Math.abs(dR) < 0.15 };
    };
    const axisUp = () => Math.abs(rotate(col.body.rotation(), { x: 1, y: 0, z: 0 }).y);
    const run = (s: number, ctrl: (u: (typeof list)[number], i: number) => Partial<CraneInput>, until?: () => boolean) => {
      for (let n = 0; n < s / FIXED_DT && !until?.(); n++) {
        // Tab cada 0,25 s: una grúa se maneja y la otra se queda quieta
        if (++k % 6 === 0) who = 1 - who;
        list.forEach((u, i) => {
          stepCrane(u.T, u.S, i === who ? { ...idle, ...ctrl(u, i) } : idle, FIXED_DT);
          u.pose = carrierPose(u.T, u.S, supportMode(u.S, u.T));
        });
        Physics.stepCrew(list);
        for (const u of list) {
          const share = u.phys.slingShare() ?? 0;
          maxLmi = Math.max(maxLmi, lmiStatic(u.T, u.C, supportMode(u.S, u.T), u.S.Lb, u.S.ang, u.S.slew, u.T.hookM + share));
          const ang = cableAngle(u.phys.headWorld(), u.phys.hookTop()), j = list.indexOf(u);
          sideT[j] = share > SIDE_LOAD && ang > SIDE_MAX ? sideT[j] + FIXED_DT : 0;
          if (share > SIDE_LOAD) maxSide = Math.max(maxSide, sideT[j]);
        }
        maxRoll = Math.max(maxRoll, rollOf(col.body.rotation()));
      }
    };
    run(1, () => ({}));
    expect(A.toggleHook()).toContain('por la cabeza');
    expect(B.toggleHook()).toContain('por el pie');
    // de pie: la principal iza siguiendo la cabeza; la de cola sigue el pie y lo mantiene a su altura (+0,4 m)
    run(900, (u, i) => {
      const lug = u.phys.lugWorld(col, i);
      // como se hace: la principal iza en vertical sobre la cabeza y la de cola lleva el pie hacia debajo de la cabeza
      // (un poco por delante del pie), sin dejar que toque el suelo
      const head = A.lugWorld(col, 0), dx = head.x - lug.x, dz = head.z - lug.z, dl = Math.hypot(dx, dz) || 1;
      const lead = i === 1 ? Math.min(0.6, dl) : 0;
      const tr = track(u, lug.x + (dx / dl) * lead, lug.z + (dz / dl) * lead);
      // cerca de la vertical, despacio: el depósito gira más deprisa y la cola tiene que seguir el pie
      if (i === 0) return { ...tr, hoist: Math.hypot(tr.slew ?? 0, tr.tele ?? 0) > 0.6 ? 0 : -0.3 };
      // la cola mantiene lo más bajo del depósito a 1,5 m (por encima de las cunas)
      return { ...tr, hoist: clamp((A.footprint(col).bottom - 1.5) * 2, 0.4) };
    }, () => axisUp() > Math.cos(4 * Math.PI / 180));
    expect(axisUp()).toBeGreaterThan(Math.cos(5 * Math.PI / 180));
    // la cola baja hasta que ya casi no lleva nada y suelta
    run(60, (_u, i) => (i === 1 ? { hoist: 0.5 } : {}), () => (B.slingShare() ?? 99) < 1);
    run(2, () => ({}));
    expect(B.toggleHook()).toMatch(/soltada/);
    // la principal lo sube un poco, lo lleva sobre la cimentación y lo baja despacio
    const z = L.zones[0];
    const bottom = () => col.body.translation().y - col.half.x;
    run(60, (_u, i) => (i === 0 ? { hoist: bottom() < z.y + 1.2 ? -0.5 : 0 } : {}), () => bottom() > z.y + 1.2);
    run(240, (u, i) => (i === 0 ? { ...track(u, z.x, z.z), hoist: bottom() < z.y + 1 ? -0.4 : 0 } : {}), () => {
      const p = col.body.translation(), v = col.body.linvel();
      return Math.hypot(p.x - z.x, p.z - z.z) < 0.4 && Math.hypot(v.x, v.z) < 0.15;
    });
    run(120, (u, i) => (i === 0 ? { ...track(u, z.x, z.z), hoist: 0.25, fine: true } : {}), () => { return A.isResting(col) && A.footprint(col).bottom < z.y + 0.02; });
    // un poco más de cable: que no cuelgue nada
    run(1.5, (_u, i) => (i === 0 ? { hoist: 0.25, fine: true } : {}));
    run(2, () => ({}));
    expect(A.toggleHook()).toMatch(/soltada/);
    run(3, () => ({}));
    const f = A.placed(col)!;
    expect(f).not.toBeNull();
    expect(Math.abs(f.x - z.x) + f.hx).toBeLessThan(z.w / 2 + 0.01);
    expect(Math.abs(f.z - z.z) + f.hz).toBeLessThan(z.d / 2 + 0.01);
    expect(Math.abs(f.bottom - z.y)).toBeLessThan(0.1);
    expect(f.tilt).toBeLessThan(5 * Math.PI / 180);
    expect(maxLmi).toBeLessThan(1);
    expect(maxSide).toBeLessThan(SIDE_T);
    expect(maxRoll).toBeLessThan(ROLL_MAX);
  }, 120_000);
});
