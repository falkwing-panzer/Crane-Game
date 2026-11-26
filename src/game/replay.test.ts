import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from './control';
import { Session, sessionDef } from './session';
import { GameStep } from './step';
import { REPLAY_S, REPLAY_SPEED, Replay } from './replay';
import { allModels } from '../render/models/allModels';

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

describe('repetición del fallo (fase 21)', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('guarda los últimos 8 s en orden y la repetición los recorre a cámara lenta hasta el último', () => {
    const ses = new Session(sessionDef('?grua=medium'), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    // 12 s girando a la izquierda (A)
    let n = 0;
    game.source = { next: () => (n++ < 720 ? { crane: { ...IDLE, slew: 1 }, drive: IDLE_DRIVE, cmds: [] } : null) };
    for (let i = 0; i < 720; i++) game.tick(FIXED_DT);
    expect(game.replay.size).toBe(REPLAY_S * 60);
    const frames = game.replay.take();
    expect(game.replay.size).toBe(0);
    expect(frames.length).toBe(REPLAY_S * 60);
    for (let i = 1; i < frames.length; i++) expect(frames[i].units[0].S.slew).toBeGreaterThan(frames[i - 1].units[0].S.slew);
    expect(frames[frames.length - 1].units[0].S.slew).toBe(ses.act.S.slew);

    const rp = new Replay(frames);
    expect(rp.length).toBeCloseTo((frames.length - 1) / 60 / REPLAY_SPEED, 9);
    const first = rp.frame(0).units[0].S.slew;
    expect(first).toBe(frames[0].units[0].S.slew);
    // a mitad: entre dos pasos grabados, mezclado
    const mid = rp.frame(rp.length / 2).units[0].S.slew;
    expect(mid).toBeGreaterThan(first);
    expect(rp.done).toBe(false);
    const last = rp.frame(rp.length).units[0].S.slew;
    expect(last).toBe(ses.act.S.slew);
    expect(rp.done).toBe(true);
    rp.rewind();
    expect(rp.progress).toBe(0);
  });

  it('rebobinar o reiniciar borra lo grabado (era de otro momento)', () => {
    const ses = new Session(sessionDef('?grua=medium'), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    for (let i = 0; i < 120; i++) game.tick(FIXED_DT);
    expect(game.replay.size).toBe(120);
    game.restart();
    expect(game.replay.size).toBe(0);
  });
});
