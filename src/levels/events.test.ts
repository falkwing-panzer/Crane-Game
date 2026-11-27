import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import { allModels } from '../render/models/allModels';
import { CRANES } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { liftPlan, planConfigs } from './liftPlan';
import { placeCrane } from './setup';
import { active, capFactor, gustAt, gustWarnings, LEAK_RATE, STORM_GRACE } from './events';
import { FAULTS_MISSION, STORM_MISSION } from './missions';
import { ALL_LEVELS } from './tandemSetup';

const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}
const nOf = (L: object) => ALL_LEVELS.indexOf(L as never) + 1;

describe('clima y averías (fase 24 B): funciones', () => {
  const ev = [{ kind: 'gust' as const, t: 10, v: 8, dur: 4 }, { kind: 'cable' as const, t: 20, dur: 5 }];
  it('ráfaga suave (0 en los extremos, v en el medio), aviso 10 s antes, capacidad con el cable dañado', () => {
    expect(gustAt(ev, 9.9)).toBe(0);
    expect(gustAt(ev, 12)).toBeCloseTo(8, 6);
    expect(gustAt(ev, 14.1)).toBe(0);
    expect(gustWarnings(ev, -0.01, 0.01)).toHaveLength(1);
    expect(gustWarnings(ev, 0.01, 0.03)).toHaveLength(0);
    expect([capFactor(ev, 19), capFactor(ev, 21), capFactor(ev, 26)]).toEqual([1, 0.5, 1]);
    expect(active(ev, 'cable', 22)).toBe(ev[1]);
  });

  it('los niveles se pueden hacer (el de averías, también con la mitad de capacidad)', () => {
    for (const [L, k] of [[STORM_MISSION, 1], [FAULTS_MISSION, 0.5]] as const) {
      for (const id of L.cranes) {
        const T = CRANES[id], S = initialState(T);
        placeCrane(T, S, L);
        const p = liftPlan(T, { ...L, crates: L.crates.map((c) => ({ ...c, m: (c.m + T.hookM) / k - T.hookM })) }, { x: S.x, z: S.z, h: S.h }, planConfigs(T, L));
        expect(p.site, `${L.name} ${id}`).toBeNull();
        for (const c of p.crates) expect(c.grade, `${L.name} ${id} ${c.crate.label}`).not.toBe('no');
      }
    }
  });
});

describe('clima y averías (fase 24 B) en la simulación', () => {
  beforeAll(async () => { await RAPIER.init(); });
  const start = (L: object) => {
    const ses = new Session(sessionDef(`?nivel=${nOf(L)}`), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    const ends: { fail: { title: string } | null }[] = [], says: string[] = [];
    ses.bus.on('end', (e) => ends.push(e as never));
    ses.bus.on('say', (e) => says.push(e.text));
    ses.running = true;
    return { ses, game, ends, says, run: (s: number) => { for (let i = 0; i < s / FIXED_DT && !ends.length; i++) game.tick(FIXED_DT); } };
  };

  it('tormenta: avisa al empezar; con la pluma alta, a los 20 s falla', () => {
    const g = start(STORM_MISSION);
    const storm = STORM_MISSION.events!.find((e) => e.kind === 'storm')!;
    g.run(36);
    expect(g.says.some((s) => s.startsWith('Anemómetro: ráfaga'))).toBe(true);
    g.run(storm.t - 36 + 1);
    expect(g.says.some((s) => s.includes('Tormenta'))).toBe(true);
    expect(g.ends).toHaveLength(0);
    g.run(STORM_GRACE + 1);
    expect(g.ends[0]?.fail?.title).toBe('Rayo');
  }, 120_000);

  it('tormenta: con la pluma abajo y nada colgando, pasa', () => {
    const g = start(STORM_MISSION);
    g.ses.act.S.ang = 0.2;
    g.run(300);
    expect(g.ends).toHaveLength(0);
  }, 120_000);

  it('averías: el anemómetro deja de dar el viento, la fuga baja la pluma y el cable dañado da la mitad', () => {
    const g = start(FAULTS_MISSION);
    g.run(26);
    expect(g.says.at(-1)).toMatch(/anemómetro/);
    g.ses.act.S.ang = 1;
    g.run(84 + 10);
    const leaked = 1 - g.ses.act.S.ang;
    expect(leaked).toBeGreaterThan(LEAK_RATE * 9);
    expect(g.ses.capK).toBe(1);
    g.run(230 - g.ses.run.t);
    expect(g.ses.capK).toBe(0.5);
    expect(g.ends).toHaveLength(0);
  }, 120_000);
});
