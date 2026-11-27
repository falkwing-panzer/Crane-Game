import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import { Recording, type StepInput } from '../game/record';
import { allModels } from '../render/models/allModels';
import { cached, pack, remember, unpack } from './codec';
import { replayDef, type ReplayData } from './replay';
import { blankLevel, sanitizeLevel, CUSTOM_MAX } from '../levels/custom';
import { addAt, check, hitTest, moveSel, newDoc, removeSel } from '../editor/doc';
import { LEVELS } from '../levels/levels';
import { SCENARIO_LEVELS } from '../levels/scenarios';

// Fase 28: obras del editor dentro del enlace y repeticiones completas.

const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

describe('enlaces: obras del editor', () => {
  it('comprimir y descomprimir da lo mismo; un código roto da null', async () => {
    const L = SCENARIO_LEVELS[1];
    const code = await pack(L);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await unpack(code)).toEqual(JSON.parse(JSON.stringify(L)));
    expect(await unpack('no-es-un-codigo')).toBeNull();
    // una obra grande del editor cabe en un enlace normal (la del puerto: ~1 kB)
    expect(code.length).toBeLessThan(2500);
  });

  it('la obra se limpia: campos desconocidos fuera, números dentro de rango, listas con un máximo', () => {
    const raw = {
      ...blankLevel(), size: [9999, -5], cranes: ['medium', 'nada', 'medium'], rec: 'lr', hack: 'x',
      crates: [{ x: 'a', z: 1e9, w: -3, d: 2, h: 2, m: 1e9, label: 'X'.repeat(50), color: 'red', kind: '<script>' }],
      boxes: Array.from({ length: 500 }, () => ({ x: 1, z: 1, w: 1, d: 1, h: 1, kind: 'building' })),
    };
    const L = sanitizeLevel(raw)!;
    expect(L).not.toBeNull();
    expect(L.size).toEqual([CUSTOM_MAX.size[1], CUSTOM_MAX.size[0]]);
    expect(L.cranes).toEqual(['medium']);
    expect(L.rec).toBe('medium');
    expect((L as unknown as Record<string, unknown>).hack).toBeUndefined();
    const c = L.crates[0];
    expect(c.z).toBe(L.size![1]);
    expect(c.w).toBeGreaterThan(0);
    expect(c.m).toBe(1000);
    expect(c.label.length).toBeLessThanOrEqual(16);
    expect(c.color).toMatch(/^#/);
    expect(c.kind).toBe('crate');
    expect(L.boxes.length).toBe(CUSTOM_MAX.boxes);
    // sin cargas, sin zonas o sin grúa no se puede jugar
    expect(sanitizeLevel({ ...blankLevel(), crates: [] })).toBeNull();
    expect(sanitizeLevel({ ...blankLevel(), cranes: ['xx'] })).toBeNull();
    expect(sanitizeLevel('hola')).toBeNull();
  });

  it('?obra=código monta la obra del enlace como un trabajo con su récord aparte', async () => {
    const L = blankLevel();
    const code = await pack(L);
    remember(code, await unpack(code));
    const def = sessionDef(`?obra=${code}`);
    expect(def.job?.kind).toBe('obra');
    expect(def.L?.name).toBe(L.name);
    expect(def.job?.key).toMatch(/^obra-/);
    expect(cached(code)).not.toBeNull();
    // un código que no está descomprimido no monta nada (vuelve al menú)
    expect(sessionDef('?obra=desconocido').L).toBeNull();
  });

  it('?editor=1 abre el editor sobre el menú (sin partida)', () => {
    const def = sessionDef('?editor=1');
    expect(def.editor).toBe('1');
    expect(def.showMenu).toBe(true);
    expect(def.L).toBeNull();
  });
});

describe('editor (sin DOM)', () => {
  it('añadir, encontrar, mover y borrar', () => {
    const d = newDoc();
    const s = addAt(d, 'box', 30, 20)!;
    expect(s).toEqual({ list: 'boxes', i: 0 });
    expect(hitTest(d, 31, 21)).toEqual(s);
    moveSel(d, s, 5, -2);
    expect(d.boxes[0]).toMatchObject({ x: 35, z: 18 });
    expect(addAt(d, 'truck', 60, 30)).toEqual({ list: 'boxes', i: 1 });
    expect(d.boxes.length).toBe(3);
    const z = addAt(d, 'zone', 10, 10)!;
    expect(hitTest(d, 10, 10)).toEqual(z);
    removeSel(d, z);
    expect(d.zones.length).toBe(1);
    addAt(d, 'lamp', 5, 5); addAt(d, 'lamp', 6, 5); addAt(d, 'lamp', 7, 5);
    expect(addAt(d, 'lamp', 8, 5)).toBeNull(); // como mucho 3 focos
    // la grúa no se borra; se mueve con su herramienta
    addAt(d, 'crane', 12, 44);
    expect(d.start).toMatchObject({ x: 12, z: 44 });
    removeSel(d, { list: 'start', i: 0 });
    expect(d.start.x).toBe(12);
  });

  it('comprobar usa el plan de izaje: la obra nueva se puede; una carga de 500 t, no', () => {
    const d = newDoc();
    expect(check(d)!.every((r) => r.ok)).toBe(true);
    d.crates[0].m = 500;
    const r = check(d)!;
    expect(r[0].ok).toBe(false);
    expect(r[0].why).toBe('reach');
  });
});

describe('repeticiones', () => {
  beforeAll(async () => { await RAPIER.init(); });

  /** Un turno de 40 s del nivel 1 con un guion de mandos (a veces engancha) */
  function playScripted(search: string) {
    const ses = new Session(sessionDef(search), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    ses.running = true;
    let n = 0;
    game.source = {
      next(): StepInput {
        n++;
        const ph = Math.floor(n / 90) % 6;
        return { crane: { ...IDLE, slew: ph === 1 ? 1 : ph === 3 ? -1 : 0, luff: ph === 2 ? 1 : 0, hoist: ph === 4 ? 1 : ph === 5 ? -1 : 0 },
          drive: IDLE_DRIVE, cmds: n === 30 ? ['outriggers'] : n % 400 === 0 ? ['hook'] : [] };
      },
    };
    for (let i = 0; i < 40 / FIXED_DT; i++) game.tick(FIXED_DT);
    return { ses, game };
  }
  const state = (ses: Session) => ({
    S: structuredClone(ses.act.S), hook: { ...ses.act.phys.hookBody.translation() },
    loads: ses.act.phys.loads.map((l) => ({ ...l.body.translation() })), t: ses.run.t,
  });

  it('la repetición vuelve a dar exactamente la misma partida', async () => {
    const a = playScripted('?nivel=1&grua=medium');
    expect(a.game.cleanRun).toBe(true);
    const data: ReplayData = { v: 1, s: '?nivel=1&grua=medium', rec: a.game.rec.toJSON(), head: 'Nivel 1', t: a.ses.run.t };
    // por el enlace: comprimida y descomprimida
    const back = (await unpack(await pack(data))) as ReplayData;
    const def = replayDef(back)!;
    expect(def.replay).toBeTruthy();
    const ses = new Session(def, new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    ses.replaying = true;
    ses.running = true;
    game.source = Recording.fromJSON(def.replay!.rec as Parameters<typeof Recording.fromJSON>[0]).player();
    let ended = false;
    game.onReplayEnd = () => { ended = true; };
    for (let i = 0; i < 40 / FIXED_DT + 5 && !ended; i++) game.tick(FIXED_DT);
    expect(ended).toBe(true);
    expect(state(ses)).toEqual(state(a.ses));
  }, 30_000);

  it('rebobinar o seguir una partida guardada deja el turno sin repetición; reiniciar la vuelve a empezar', () => {
    const a = playScripted('?libre=1&grua=medium');
    expect(a.game.rewind()).toBeGreaterThan(0);
    expect(a.game.cleanRun).toBe(false);
    a.game.restart();
    expect(a.game.cleanRun).toBe(true);
  }, 30_000);

  it('una repetición de una obra que no es un nivel no monta nada', () => {
    expect(replayDef({ v: 1, s: '?grua=medium', rec: [], head: '', t: 0 })).toBeNull();
    expect(LEVELS.length).toBeGreaterThan(0);
  });
});
