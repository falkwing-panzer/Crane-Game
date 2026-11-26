import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import type { Cmd, StepInput } from '../game/record';
import { allModels } from '../render/models/allModels';
import { sessionSignal, type Signal } from '../game/signals';
import type { CraneInput } from '../crane/kinematics';

// Fase 23: un nivel a ciegas se puede terminar solo con el señalero. Un "operador" de guion que no mira nada más que
// la señal de radio (y saca los estabilizadores al empezar y hace la lista de chequeo antes de enganchar).

const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

/** Mandos para cada señal (sin mirar la grúa) */
const OBEY: Record<Signal, Partial<CraneInput>> = {
  sube: { hoist: -1 }, baja: { hoist: 1 }, despacio: { hoist: 1, fine: true },
  giraIzq: { slew: 1, fine: true }, giraDer: { slew: -1, fine: true }, subePluma: { luff: 1, fine: true }, bajaPluma: { luff: -1, fine: true }, sacaPluma: { tele: 1, fine: true }, metePluma: { tele: -1, fine: true },
  carroFuera: { tele: 1, fine: true }, carroDentro: { tele: -1, fine: true }, para: {}, espera: {}, engancha: {}, suelta: {},
};

function playBlind(n: number, maxS = 1500) {
  const ses = new Session(sessionDef(`?nivel=${n}`), new THREE.Scene(), allModels);
  const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
  let end: { fail: unknown; stars?: number } | null = null;
  ses.bus.on('end', (e) => { end = e; });
  ses.running = true;
  const seen = new Set<Signal>();
  const log: string[] = [];
  let last: Signal | null = null;
  let k = 0;
  game.source = {
    next(): StepInput {
      k++;
      const u = ses.act, cmds: Cmd[] = [];
      if (!u.T.crawler && u.S.outT === 0) { if (k % 30 === 0) cmds.push('outriggers'); return { crane: IDLE, drive: IDLE_DRIVE, cmds }; }
      if (u.S.out < 1) return { crane: IDLE, drive: IDLE_DRIVE, cmds };
      // lastre y Y-guy (los da por montados el plan de izaje)
      if (u.T.ballast && !u.S.cwT) { if (k % 30 === 0) cmds.push('ballast'); return { crane: IDLE, drive: IDLE_DRIVE, cmds }; }
      if (u.T.ballast && u.S.cw < 1) return { crane: IDLE, drive: IDLE_DRIVE, cmds };
      if (u.T.yguy && !u.S.ygT) { if (k % 30 === 0) cmds.push('yguy'); return { crane: IDLE, drive: IDLE_DRIVE, cmds }; }
      if (u.T.yguy && u.S.yg < 1) return { crane: IDLE, drive: IDLE_DRIVE, cmds };
      const sig = sessionSignal(ses);
      if (sig) seen.add(sig);
      if (sig !== last || k % 600 === 0) {
        last = sig;
        const h = u.phys.hookBody.translation();
        log.push(`${ses.run.t.toFixed(1)} ${sig} gancho(${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)}) Lb ${u.S.Lb.toFixed(1)} ang ${(u.S.ang * 57.3).toFixed(0)} giro ${(u.S.slew * 57.3).toFixed(0)} cable ${u.S.cable.toFixed(1)} enganchada ${!!u.phys.attached} cut ${u.cut}`);
      }
      if (sig === 'engancha' && k % 20 === 0) cmds.push('checklist', 'hook');
      if (sig === 'suelta' && k % 20 === 0) cmds.push('hook');
      return { crane: { ...IDLE, ...(sig ? OBEY[sig] : {}) }, drive: IDLE_DRIVE, cmds };
    },
  };
  for (let i = 0; i < maxS / FIXED_DT && !end; i++) game.tick(FIXED_DT);
  return { log, end: end as { fail: { title: string } | null; stars?: number } | null, ses, seen, t: ses.run.t };
}

describe('fase 23 en la simulación: solo con el señalero', () => {
  beforeAll(async () => { await RAPIER.init(); });

  for (const n of [15, 16, 17]) {
    it(`nivel ${n}: se termina obedeciendo solo la radio`, () => {
      const r = playBlind(n);
      expect(r.end, `sin terminar a los ${r.t.toFixed(0)} s: ${r.log.slice(-25).join(' | ')}`).not.toBeNull();
      expect(r.end!.fail, `${JSON.stringify(r.end!.fail)} ${r.log.slice(-12).join(' | ')}`).toBeNull();
      expect(r.ses.run.skips).toBe(0);
    }, 240_000);
  }
});
