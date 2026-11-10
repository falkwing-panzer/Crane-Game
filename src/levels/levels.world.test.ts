import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { supportMode } from '../crane/ops';
import { carrierPose } from '../crane/pose';
import { Physics } from '../physics/world';
import { LEVELS } from './levels';
import { LEVEL_BOUNDS, allPlaced, placeCrane, populate } from './setup';

// Cada nivel con cada grúa permitida: el mundo se arma, la grúa no empieza dentro de nada ni fuera de la obra,
// y las cargas quedan quietas donde estaban (no nacen dentro de un obstáculo ni salen despedidas).
describe('niveles en Rapier', () => {
  beforeAll(async () => { await RAPIER.init(); });

  LEVELS.forEach((L, i) => {
    for (const id of L.cranes) {
      it(`${i + 1}. ${L.name} con ${CRANES[id].name}`, () => {
        const T = CRANES[id];
        const S = initialState(T);
        placeCrane(T, S, L);
        const pose = carrierPose(T, S, supportMode(S, T));
        const P = new Physics(T, S, pose, { testLoad: false, bounds: LEVEL_BOUNDS });
        populate(P, L);
        expect(P.loads.length).toBe(L.crates.length);
        expect(P.carrierBlocked(S.x, S.z, S.h), 'chasis').toBeNull();
        expect(P.tailBlocked(S, S.slew, S.cw), 'contrapeso').toBeNull();
        for (let k = 0; k < 120; k++) P.step(S, pose);
        for (const l of P.loads) {
          const t = l.body.translation();
          expect(Math.hypot(t.x - l.home.x, t.y - l.home.y, t.z - l.home.z), l.label).toBeLessThan(0.05);
          expect(P.placed(l), l.label).not.toBeNull();
        }
        // al empezar, ninguna carga está en su zona
        expect(allPlaced(P.loads.map((l) => P.placed(l)), L.zones)).toBe(false);
        expect(Number.isFinite(P.tension)).toBe(true);
      });
    }
  });
});

describe('victoria (checkWin)', () => {
  beforeAll(async () => { await RAPIER.init(); });
  const world = (i: number) => {
    const L = LEVELS[i], T = CRANES[L.rec], S = initialState(T);
    placeCrane(T, S, L);
    const pose = carrierPose(T, S, supportMode(S, T));
    const P = new Physics(T, S, pose, { testLoad: false, bounds: LEVEL_BOUNDS });
    populate(P, L);
    const put = (k: number, x: number, y: number, z: number) => P.loads[k].body.setTranslation({ x, y: y + P.loads[k].half.y + 0.01, z }, true);
    const settle = () => { for (let k = 0; k < 90; k++) P.step(S, pose); };
    const won = () => allPlaced(P.loads.map((l) => P.placed(l)), L.zones);
    return { P, put, settle, won };
  };

  it('patio de contenedores: los dos en la zona gana; uno fuera no', () => {
    const w = world(0);
    w.put(0, 68, 0, 40.1);
    w.settle();
    expect(w.won()).toBe(false);
    w.put(1, 68, 0, 43.7);
    w.settle();
    expect(w.won()).toBe(true);
  });

  it('torre de telecomunicaciones: los tres tramos apilados en la base', () => {
    const w = world(4);
    w.put(0, 54, 0.5, 26);
    w.settle();
    w.put(1, 54, 9.5, 26);
    w.settle();
    expect(w.won()).toBe(false);
    w.put(2, 54.2, 18.5, 26.1);
    w.settle();
    expect(w.won()).toBe(true);
  });

  it('la carga que asoma fuera de la zona no cuenta', () => {
    const w = world(2); // transformador de 3,4 × 2,4 en la base de 5 × 5 (a +0,3 m)
    w.put(0, 53.0, 0.3, 10);
    w.settle();
    expect(w.won()).toBe(false);
    w.put(0, 52, 0.3, 10);
    w.settle();
    expect(w.won()).toBe(true);
  });
});
