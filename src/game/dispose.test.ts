import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { SceneMark } from '../render/dispose';
import { IDLE, IDLE_DRIVE } from './control';
import { Session, sessionDef } from './session';
import { GameStep } from './step';
import { allModels } from '../render/models/allModels';

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

/** Memoria lineal del wasm de Rapier (se captura al iniciarlo) */
let memory: WebAssembly.Memory | null = null;

const still = { state: () => IDLE, drive: () => IDLE_DRIVE };
const scene = new THREE.Scene();

/** Monta una partida, la hace correr un poco y la desmonta como App.unmount */
function cycle(search: string) {
  const mark = new SceneMark(scene);
  const ses = new Session(sessionDef(search), scene, allModels);
  const game = new GameStep(ses, still);
  ses.running = true;
  for (let i = 0; i < 30; i++) game.tick(FIXED_DT);
  game.dispose();
  ses.bus.clear();
  for (const u of [...ses.units].reverse()) u.phys.dispose();
  return mark.release();
}

// Fase 14: cambiar de nivel sin recargar no puede dejar memoria atrás (mundo de Rapier, objetos de la escena).
describe('desmontar una partida', () => {
  beforeAll(async () => {
    const inst = WebAssembly.instantiate;
    // @ts-expect-error se envuelve la función para quedarse con la instancia
    WebAssembly.instantiate = async (...a: Parameters<typeof inst>) => {
      const r = await (inst as (...b: unknown[]) => Promise<unknown>)(...a);
      const i = (r as { instance?: WebAssembly.Instance }).instance ?? (r as WebAssembly.Instance);
      memory ??= Object.values(i.exports).find((e): e is WebAssembly.Memory => e instanceof WebAssembly.Memory) ?? null;
      return r;
    };
    await RAPIER.init();
    WebAssembly.instantiate = inst;
  });

  it('la escena vuelve a quedar como estaba y se liberan los recursos de la GPU', () => {
    const before = scene.children.length;
    expect(cycle('?nivel=1')).toBeGreaterThan(10);
    expect(scene.children.length).toBe(before);
    expect(cycle('?nivel=14')).toBeGreaterThan(10);
    expect(scene.children.length).toBe(before);
  });

  it('la memoria del wasm de Rapier no crece al cambiar 10 veces de partida', () => {
    expect(memory).not.toBeNull();
    const seq = ['?nivel=14', '?grua=lr', '?nivel=11', '?nivel=2', '?tandem=1', '?grua=sk', '?nivel=9', '?grua=at650', '?nivel=6', '?nivel=1'];
    // primera vuelta: el wasm crece hasta lo que necesita la partida más grande
    for (const s of seq) cycle(s);
    const after1 = memory!.buffer.byteLength;
    for (let k = 0; k < 2; k++) for (const s of seq) cycle(s);
    expect(memory!.buffer.byteLength).toBe(after1);
  }, 60_000);

  it('liberar el mundo de verdad importa: sin dispose la memoria crece', () => {
    const start = memory!.buffer.byteLength;
    const keep: Session[] = [];
    for (let k = 0; k < 40; k++) keep.push(new Session(sessionDef('?nivel=14'), new THREE.Scene(), allModels));
    expect(memory!.buffer.byteLength).toBeGreaterThan(start);
    for (const s of keep) for (const u of [...s.units].reverse()) u.phys.dispose();
  }, 60_000);
});
