import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CRANES, type CraneId } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { baseConfig } from '../crane/stability';
import { axleLoad } from '../crane/axles';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import { ballastDelivered } from '../game/commands';
import { allModels } from '../render/models/allModels';
import { liftPlan, planConfigs, type Ghost } from './liftPlan';
import { AUX_MISSION, BRIDGE_AXLE, ROAD_MISSION, TRUCKS_MISSION } from './missions';
import { ALL_LEVELS } from './tandemSetup';
import { sessionSignal, type Signal } from '../game/signals';
import type { Cmd, StepInput } from '../game/record';
import type { CraneInput } from '../crane/kinematics';

const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

const nOf = (L: object) => ALL_LEVELS.indexOf(L as never) + 1;
const grade = (id: CraneId, L: typeof ROAD_MISSION, g: Ghost, only?: number[]) => {
  const p = liftPlan(CRANES[id], L, g, planConfigs(CRANES[id], L));
  return { site: p.site, ok: p.crates.filter((_, i) => !only || only.includes(i)).every((c) => c.grade !== 'no') };
};

describe('misiones (fase 24): datos', () => {
  it('puente: la City 25 (y la AT 300-6) caben en 12 t por eje; la AT 60 no y tiene que dar la vuelta', () => {
    const q = (id: CraneId) => axleLoad(CRANES[id], baseConfig(CRANES[id]))!;
    expect(q('small')).toBeLessThanOrEqual(BRIDGE_AXLE);
    expect(q('medium')).toBeGreaterThan(BRIDGE_AXLE);
  });

  it('cada trabajo se puede hacer: desde un sitio de la obra (18), desde el arranque (19) y con las dos grúas (20)', () => {
    for (const id of ROAD_MISSION.cranes) expect(grade(id, ROAD_MISSION, { x: 174, z: 38, h: 0 })).toEqual({ site: null, ok: true });
    for (const id of TRUCKS_MISSION.cranes) {
      const T = CRANES[id], S = initialState(T);
      S.x = TRUCKS_MISSION.start.x; S.z = TRUCKS_MISSION.start.z;
      // los camiones 3 y 4 entran en los muelles: se mira cada contenedor en su muelle
      const L = { ...TRUCKS_MISSION, crates: TRUCKS_MISSION.crates.map((c, i) => ({ ...c, ...(i >= 2 ? { x: 16, z: i === 2 ? 12 : 44 } : {}) })) };
      expect(grade(id, L, { x: S.x, z: S.z, h: 0 }), id).toEqual({ site: null, ok: true });
    }
    const [main, aux] = AUX_MISSION.crew!;
    expect(grade('at300', AUX_MISSION, { x: main.x, z: main.z, h: -main.h }, [4]).ok).toBe(true);
    expect(grade('medium', AUX_MISSION, { x: aux.x, z: aux.z, h: -aux.h }, [0, 1, 2, 3]).ok).toBe(true);
  });
});

describe('misiones (fase 24) en la simulación', () => {
  beforeAll(async () => { await RAPIER.init(); });
  const start = (q: string) => {
    const ses = new Session(sessionDef(q), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    const ends: { fail: { title: string } | null }[] = [], says: string[] = [];
    ses.bus.on('end', (e) => ends.push(e as never));
    ses.bus.on('say', (e) => says.push(e.text));
    ses.running = true;
    return { ses, game, ends, says, run: (s: number) => { for (let i = 0; i < s / FIXED_DT && !ends.length; i++) game.tick(FIXED_DT); } };
  };

  it('18: con la AT 60 sobre el puente, fallo; con la City 25, no', () => {
    for (const [id, fails] of [['medium', true], ['small', false]] as const) {
      const g = start(`?nivel=${nOf(ROAD_MISSION)}&grua=${id}`);
      Object.assign(g.ses.act.S, { x: 76, z: 12 });
      g.run(0.5);
      expect(g.ends.length > 0, id).toBe(fails);
      if (fails) expect(g.ends[0].fail!.title).toBe('Puente sobrecargado');
    }
  });

  it('19: el camión 3 espera mientras su muelle está ocupado (cuenta retraso) y entra al vaciarlo', () => {
    const g = start(`?nivel=${nOf(TRUCKS_MISSION)}`);
    const phys = g.ses.units[0].phys, c3 = phys.loads[2];
    g.run(155);
    expect(g.ses.run.tDone & 3).toBe(3); // los dos primeros ya estaban
    expect(g.ses.run.tDone & 4).toBe(0);
    expect(g.ses.run.late).toBeGreaterThan(4);
    // vaciar el muelle 1 (como si se hubiera descargado)
    phys.loads[0].body.setTranslation({ x: 58, y: 1.4, z: 10 }, true);
    g.run(1);
    expect(g.ses.run.tDone & 4, JSON.stringify([g.ses.run.t, g.ends, phys.loads.map((l) => l.body.translation())])).toBe(4);
    const p = c3.body.translation();
    expect(Math.hypot(p.x - 16, p.z - 12)).toBeLessThan(0.2);
    expect(g.says.some((s) => s.startsWith('Entra el camión 3'))).toBe(true);
  }, 60_000);

  it('20: dos grúas; sin el lastre en su zona la AT 300-6 no lo monta; con él, sí', () => {
    const g = start(`?nivel=${nOf(AUX_MISSION)}`);
    expect(g.ses.units.map((u) => u.id)).toEqual(['at300', 'medium']);
    expect(g.ses.units[0].S.out).toBe(1);
    g.game.push('ballast');
    g.run(0.2);
    expect(g.says.at(-1)).toMatch(/lastre todavía no está/);
    expect(g.ses.units[0].S.cwT).toBe(0);
    const phys = g.ses.units[0].phys;
    phys.loads.filter((l) => l.kind === 'ballast').forEach((l, i) => l.body.setTranslation({ x: 33.5 + (i % 2) * 2.8, y: 0.47, z: 28 + Math.floor(i / 2) * 2.4 }, true));
    g.run(1.5);
    expect(ballastDelivered(g.ses)).toBe(true);
    g.game.push('ballast');
    g.run(0.2);
    expect(g.ses.units[0].S.cwT).toBe(1);
  }, 60_000);

  it('18 de principio a fin con la AT 60: sale de la base, rodea el río, pasa bajo el cable y deja el módulo', () => {
    const g = start(`?nivel=${nOf(ROAD_MISSION)}&grua=medium`);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const route: [number, number][] = [[50, 12], [58, 54], [102, 54], [108, 22], [158, 18], [158, 36], [174, 38]];
    let wp = 0, k = 0;
    const OBEY: Record<Signal, Partial<CraneInput>> = {
      sube: { hoist: -1 }, baja: { hoist: 1 }, despacio: { hoist: 1, fine: true }, giraIzq: { slew: 1, fine: true }, giraDer: { slew: -1, fine: true },
      subePluma: { luff: 1, fine: true }, bajaPluma: { luff: -1, fine: true }, sacaPluma: { tele: 1, fine: true }, metePluma: { tele: -1, fine: true },
      carroFuera: {}, carroDentro: {}, para: {}, espera: {}, engancha: {}, suelta: {},
    };
    g.game.source = {
      next(): StepInput {
        k++;
        const u = g.ses.act, { S } = u, cmds: Cmd[] = [];
        // antes de salir, la pluma abajo (el cable bajo la tocaría)
        if (wp === 0 && S.ang > 0.005) return { crane: { ...IDLE, luff: -1 }, drive: IDLE_DRIVE, cmds };
        if (wp < route.length) {
          const [x, z] = route[wp], dx = x - S.x, dz = z - S.z, d = Math.hypot(dx, dz);
          if (d < 3) wp++;
          const last = wp === route.length - 1 || wp >= route.length;
          const vWant = wp >= route.length ? 0 : last ? Math.min(3, 0.4 * d) : 4;
          return { crane: IDLE, drive: { throttle: clamp((vWant - S.vd) * 1.5), steer: clamp(wrap(Math.atan2(-dz, dx) - S.h) * 3), fine: false }, cmds };
        }
        if (Math.abs(S.vd) > 0.05) return { crane: IDLE, drive: { throttle: clamp(-S.vd * 2), steer: 0, fine: false }, cmds };
        if (!S.outT) { if (k % 30 === 0) cmds.push('outriggers'); return { crane: IDLE, drive: IDLE_DRIVE, cmds }; }
        if (S.out < 1) return { crane: IDLE, drive: IDLE_DRIVE, cmds };
        const sig = sessionSignal(g.ses);
        if ((sig === 'engancha' || sig === 'suelta') && k % 20 === 0) cmds.push('hook');
        return { crane: { ...IDLE, ...(sig ? OBEY[sig] : {}) }, drive: IDLE_DRIVE, cmds };
      },
    };
    g.run(1500);
    expect(g.ends.length, `t=${g.ses.run.t.toFixed(0)} punto ${wp} en (${g.ses.act.S.x.toFixed(1)}, ${g.ses.act.S.z.toFixed(1)}) ${g.says.slice(-4).join(' | ')}`).toBe(1);
    expect(g.ends[0].fail, JSON.stringify(g.ends[0].fail)).toBeNull();
    expect(g.ses.run.prox).toBe(0); // bajo el cable, sin alarma
  }, 240_000);
});
