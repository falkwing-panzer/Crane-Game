import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from './control';
import type { GameEvents } from './events';
import { Session, sessionDef } from './session';
import { GameStep } from './step';

const still = { state: () => IDLE, drive: () => IDLE_DRIVE };

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}
const KINDS: (keyof GameEvents)[] = ['say', 'land', 'strike', 'bump', 'cut', 'prox', 'tipping', 'tipped', 'end', 'restart'];

/** Partida desde una URL, con todos los eventos apuntados */
function play(search: string) {
  const ses = new Session(sessionDef(search), new THREE.Scene());
  const game = new GameStep(ses, still);
  const log: { k: keyof GameEvents; p: unknown }[] = [];
  for (const k of KINDS) ses.bus.on(k, (p) => log.push({ k, p }));
  const ends = () => log.filter((e) => e.k === 'end').map((e) => e.p as GameEvents['end']);
  return { ses, game, log, ends };
}

// Fase 14: la partida, el paso y las reglas separados de main.ts, comunicados por el bus.
describe('partida y reglas por el bus', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('la URL decide la partida', () => {
    expect(sessionDef('').showMenu).toBe(true);
    expect(sessionDef('?grua=lr').ids).toEqual(['lr']);
    expect(sessionDef('?grua=nada').ids).toEqual(['medium']);
    expect(sessionDef('?nivel=14').tandem).toBe(true);
    expect(sessionDef('?nivel=99').L).toBeNull();
    expect(sessionDef('?tandem=1').ids.length).toBe(2);
  });

  it('prueba libre: corre sin ficha y la grúa quieta no emite nada', () => {
    const { ses, game, log } = play('?grua=medium');
    expect(ses.running).toBe(true);
    for (let i = 0; i < 120; i++) game.tick(FIXED_DT);
    expect(log).toEqual([]);
    expect(game.rules).toBeNull();
  });

  it('un nivel espera a la ficha; después corre el reloj', () => {
    const { ses, game } = play('?nivel=1');
    for (let i = 0; i < 60; i++) game.tick(FIXED_DT);
    expect(ses.run.t).toBe(0);
    ses.running = true;
    for (let i = 0; i < 60; i++) game.tick(FIXED_DT);
    expect(ses.run.t).toBeCloseTo(1, 6);
  });

  it('contrarreloj: se acaba el tiempo y el turno se para', () => {
    const { ses, game, ends } = play('?nivel=8');
    ses.running = true;
    ses.run.t = ses.L!.time! - FIXED_DT / 2;
    game.tick(FIXED_DT);
    expect(ends()).toEqual([{ fail: { title: 'Se acabó el tiempo', text: expect.any(String) } }]);
    expect(ses.running).toBe(false);
    const t = ses.run.t;
    game.tick(FIXED_DT);
    expect(ses.run.t).toBe(t);
  });

  it('vidrio: un aterrizaje rápido termina el nivel; uno lento solo avisa', () => {
    const a = play('?nivel=6');
    a.ses.running = true;
    a.ses.bus.emit('land', { unit: 0, v: 0.3, fragile: 0.5 });
    expect(a.ends()).toEqual([]);
    expect(a.log.some((e) => e.k === 'say' && (e.p as { text: string }).text.startsWith('Apoyada'))).toBe(true);
    a.ses.bus.emit('land', { unit: 0, v: 0.8, fragile: 0.5 });
    expect(a.ends()[0].fail?.title).toBe('Vidrio roto');
    expect(a.ses.run.done).toBe(true);
  });

  it('golpes: uno por segundo como mucho; aterrizaje duro cuenta', () => {
    const { ses, game } = play('?nivel=1');
    ses.running = true;
    ses.bus.emit('strike', { unit: 0, v: 1 });
    ses.bus.emit('bump', { unit: 0, text: 'choque' });
    ses.bus.emit('strike', { unit: 0, v: 0.1 });
    expect(ses.run.bumps).toBe(1);
    for (let i = 0; i < 61; i++) game.tick(FIXED_DT);
    ses.bus.emit('bump', { unit: 0, text: 'choque' });
    expect(ses.run.bumps).toBe(2);
    ses.bus.emit('land', { unit: 0, v: 2 });
    expect(ses.run.hard).toBe(1);
  });

  it('vuelco: en un nivel lo termina; en la prueba libre no', () => {
    const lv = play('?nivel=1');
    lv.ses.running = true;
    lv.ses.bus.emit('tipped', { unit: 0, text: 'cayó' });
    expect(lv.ends()).toEqual([{ fail: { title: 'La grúa volcó', text: 'cayó' } }]);
    const free = play('?grua=medium');
    free.ses.bus.emit('tipped', { unit: 0, text: 'cayó' });
    expect(free.ends()).toEqual([]);
    expect(free.ses.running).toBe(true);
  });

  it('tándem: dos grúas, Tab cambia la que se maneja, el paso corre y Reiniciar avisa', () => {
    const { ses, game, log } = play('?nivel=14');
    expect(ses.units.length).toBe(2);
    expect(ses.multi).toBe(true);
    ses.running = true;
    for (let i = 0; i < 60; i++) game.tick(FIXED_DT);
    expect(ses.switchUnit()).toBe(ses.units[1]);
    expect(ses.switchUnit()).toBe(ses.units[0]);
    ses.restart();
    expect(log.map((e) => e.k).slice(-2)).toEqual(['restart', 'say']);
    expect(ses.units.every((u) => u.tipClock === -1)).toBe(true);
  });
});
