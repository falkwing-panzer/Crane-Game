import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from './control';
import { Session, sessionDef } from './session';
import { GameStep } from './step';
import { Recording, type Cmd, type InputSource, type StepInput } from './record';
import { allModels } from '../render/models/allModels';
import { decodeSnap, encodeSnap } from '../ui/savegame';

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

const still = { state: () => IDLE, drive: () => IDLE_DRIVE };

/** Números al azar con semilla (mulberry32): el guion es siempre el mismo */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Guion de un jugador: cada segundo cambia los mandos (−1, 0 o 1 en giro, pluma, telescopio, cable, marcha y
 * dirección, a veces fino) y de vez en cuando pulsa una acción.
 */
function script(seed: number, cmds: Cmd[]): InputSource {
  const r = rng(seed), pick = () => Math.floor(r() * 3) - 1;
  let n = 0, cur: StepInput | null = null;
  return {
    next() {
      if (n % 60 === 0) {
        cur = {
          crane: { slew: pick(), luff: pick(), tele: pick(), hoist: pick(), fine: r() < 0.2, sl: 0, jib: 0 },
          drive: { throttle: pick(), steer: pick(), fine: false },
          cmds: r() < 0.3 ? [cmds[Math.floor(r() * cmds.length)]] : [],
        };
      } else cur = { ...cur!, cmds: [] };
      n++;
      return cur;
    },
  };
}

function play(search: string) {
  const ses = new Session(sessionDef(search), new THREE.Scene(), allModels);
  const game = new GameStep(ses, still);
  ses.running = true;
  return { ses, game };
}

/** Todo lo que se mueve: estado de cada grúa, gancho, tensión, cargas y turno */
function state(ses: Session) {
  return {
    units: ses.units.map((u) => ({
      S: structuredClone(u.S), C: { ...u.C, jib: !!u.C.jib }, hook: { ...u.phys.hookBody.translation() },
      tension: u.phys.tension, attached: u.phys.attached?.label ?? null, tipped: !!u.phys.tipped, lmi: u.dyn.lmi,
    })),
    loads: ses.units[0].phys.loads.map((l) => ({ t: { ...l.body.translation() }, q: { ...l.body.rotation() } })),
    act: ses.act.i, run: { ...ses.run },
  };
}

function run(game: GameStep, steps: number) {
  for (let i = 0; i < steps; i++) game.tick(FIXED_DT);
}

// Fase 15: con las mismas entradas desde el mismo estado, la partida sale igual paso a paso (base de repeticiones,
// reto diario y editor); las instantáneas guardan todo lo necesario para seguir igual.
describe('determinismo e instantáneas', () => {
  beforeAll(async () => { await RAPIER.init(); });

  const CASES: [string, string, number, Cmd[]][] = [
    ['nivel 1 (60 s)', '?nivel=1', 3600, ['hook', 'outriggers']],
    ['prueba libre de la LR 3000 (30 s)', '?grua=lr', 1800, ['hook']],
    ['tándem libre, cambiando de grúa (30 s)', '?tandem=1', 1800, ['hook', 'switch']],
  ];

  for (const [name, search, N, cmds] of CASES) {
    it(`${name}: la grabación reproduce la partida exacta`, () => {
      const A = play(search);
      A.game.source = script(7, cmds);
      const marks: unknown[] = [];
      for (let s = 0; s < N; s += 60) { run(A.game, 60); marks.push(state(A.ses)); }
      expect(A.game.rec.length).toBe(N);
      // que pasó algo: la grúa se movió
      expect(Math.abs(A.ses.units[0].S.slew) + Math.abs(A.ses.units[0].S.x)).toBeGreaterThan(0.01);

      // otra partida igual, con la grabación (pasada por JSON, como se guardaría)
      const B = play(search);
      B.game.source = Recording.fromJSON(JSON.parse(JSON.stringify(A.game.rec))).player();
      for (let s = 0, k = 0; s < N; s += 60, k++) { run(B.game, 60); expect(state(B.ses), `segundo ${k + 1}`).toEqual(marks[k]); }
    }, 30_000);

    it(`${name}: volver a una instantánea y repetir da lo mismo`, () => {
      const A = play(search);
      A.game.source = script(11, cmds);
      run(A.game, N / 2);
      const snap = A.game.snapshot();
      run(A.game, N / 2);
      const end = state(A.ses);
      const rec = Recording.fromJSON(A.game.rec.toJSON());

      // en la misma partida
      A.game.restore(snap);
      expect(A.game.steps).toBe(N / 2);
      A.game.source = rec.player(N / 2);
      run(A.game, N / 2);
      expect(state(A.ses)).toEqual(end);

      // en una partida nueva, desde la instantánea guardada como texto (partida guardada)
      const C = play(search);
      C.game.restore(decodeSnap(encodeSnap(snap)));
      C.game.source = rec.player(N / 2);
      run(C.game, N / 2);
      expect(state(C.ses)).toEqual(end);
    }, 30_000);
  }

  it('reiniciar vuelve al estado del principio del turno sin reconstruir la física', () => {
    const A = play('?grua=medium');
    run(A.game, 1);
    const start = state(A.ses);
    A.game.source = script(3, ['hook', 'outriggers']);
    run(A.game, 600);
    const bodies = A.ses.units[0].phys.world.bodies.len();
    A.game.restart();
    expect(A.game.steps).toBe(0);
    expect(A.game.rec.length).toBe(0);
    run(A.game, 1);
    expect(state(A.ses)).toEqual(start);
    expect(A.ses.units[0].phys.world.bodies.len()).toBeLessThanOrEqual(bodies);
  });

  it('rebobinar vuelve 10 s atrás (solo en la prueba libre)', () => {
    const A = play('?grua=medium');
    A.game.source = script(5, ['hook']);
    run(A.game, 60 * 25);
    expect(A.game.rewind()).toBe(10);
    expect(A.game.steps).toBe(60 * 15);
    expect(A.game.rec.length).toBe(60 * 15);
    // en un nivel no
    const L = play('?nivel=1');
    run(L.game, 60 * 12);
    expect(L.game.rewind()).toBe(0);
  });

  it('la grabación comprime los pasos iguales y se recorta', () => {
    const r = new Recording();
    const s: StepInput = { crane: { ...IDLE }, drive: { ...IDLE_DRIVE }, cmds: [] };
    for (let i = 0; i < 1000; i++) r.push(s);
    r.push({ ...s, cmds: ['hook'] });
    for (let i = 0; i < 10; i++) r.push(s);
    expect(r.toJSON().length).toBe(2); // el paso con la acción abre un tramo que siguen los iguales
    expect(r.length).toBe(1011);
    r.truncate(1001);
    expect(r.length).toBe(1001);
    const p = r.player(1000);
    expect(p.next()!.cmds).toEqual(['hook']);
    expect(p.next()).toBeNull();
  });
});
