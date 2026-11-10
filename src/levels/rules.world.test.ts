import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AT60 } from '../crane/cranes';
import { boomFoot, headPos, initialState } from '../crane/kinematics';
import { apply, carrierPose } from '../crane/pose';
import { Physics } from '../physics/world';
import { LEVELS } from './levels';
import { TEXT_3D } from '../ui/levelUi';

// Parte B de la fase 9 en Rapier: viento, aterrizajes (impact) y golpes de la carga (strike).

const D = Math.PI / 180;
const T = AT60;

/** AT 60 sobre neumáticos con una carga de 2 t enganchada e izada `lift` m (la de drive.test.ts) */
function hanging(lift: number) {
  const S = initialState(T);
  S.Lb = 20; S.ang = 40 * D;
  const pose = carrierPose(T, S, 'tire');
  const hp = apply(pose, headPos(T, S));
  const c0 = hp.y - 0.8 - 0.5 - 1.0;
  S.cable = c0;
  const P = new Physics(T, S, pose, { testLoad: false });
  const L = P.addLoad('Prueba', 2, { x: 0.5, y: 0.4, z: 0.5 }, { x: hp.x, y: 0.4, z: hp.z });
  for (let i = 0; i < 90; i++) P.step(S, pose);
  expect(P.toggleHook()).toMatch(/Enganchada/);
  for (let i = 0; i < 400 && S.cable > c0 - lift; i++) { S.cable = Math.max(S.cable - 0.01, c0 - lift); P.step(S, pose); }
  for (let i = 0; i < 240; i++) P.step(S, pose);
  P.events.length = 0;
  return { S, P, L, pose, hp, c0 };
}

describe('reglas de los niveles en Rapier', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('el pie de la pluma está a Lb de la cabeza', () => {
    const S = initialState(T);
    S.Lb = 23; S.ang = 35 * D; S.slew = 1.1;
    const f = boomFoot(T, S), h = headPos(T, S);
    expect(Math.hypot(h.x - f.x, h.y - f.y, h.z - f.z)).toBeCloseTo(23, 9);
  });

  it('el viento empuja la carga colgada hacia donde sopla', () => {
    const { S, P, L, pose } = hanging(3);
    const x0 = L.body.translation().x, z0 = L.body.translation().z;
    P.wind = { x: 0, z: 2 }; // 2 t·m/s² hacia +z sobre 2,4 t
    for (let i = 0; i < 90; i++) P.step(S, pose);
    const t = L.body.translation();
    expect(t.z - z0).toBeGreaterThan(0.3);
    expect(Math.abs(t.x - x0)).toBeLessThan(0.2);
  });

  it('bajar la carga deprisa da un aterrizaje con la velocidad de bajada', () => {
    const { S, P, pose } = hanging(3);
    for (let i = 0; i < 240 && !P.events.some((e) => e.kind === 'land'); i++) { S.cable += 2 / 60; P.step(S, pose); }
    const land = P.events.find((e) => e.kind === 'land');
    expect(land).toBeTruthy();
    expect(land!.v).toBeGreaterThan(1.4); // aterrizaje duro
    expect(land!.v).toBeLessThan(2.6);
  });

  it('bajarla despacio da un apoyo suave; arrastrarla contra un bloque, un golpe', () => {
    const { S, P, pose, hp } = hanging(1);
    for (let i = 0; i < 600 && !P.events.some((e) => e.kind === 'land'); i++) { S.cable += 0.2 / 60; P.step(S, pose); }
    const land = P.events.find((e) => e.kind === 'land');
    expect(land!.v).toBeLessThan(0.5);
    expect(P.events.some((e) => e.kind === 'strike')).toBe(false);

    // la carga vuelve a colgar a 0,5 m y una pared se le acerca por el costado
    const h2 = hanging(0.5);
    h2.P.addObstacle({ label: 'Muro', kind: 'wall', half: { x: 0.15, y: 2, z: 3 }, pos: { x: h2.hp.x + 2, y: 2, z: h2.hp.z }, rotY: 0 });
    h2.P.wind = { x: 30, z: 0 }; // empujón fuerte hacia el muro
    for (let i = 0; i < 180; i++) h2.P.step(h2.S, h2.pose);
    const hit = h2.P.events.find((e) => e.kind === 'strike');
    expect(hit).toBeTruthy();
    expect(hit!.v).toBeGreaterThan(0.25);
    void hp;
  });
});

describe('textos de la ficha adaptados a 3D', () => {
  it('cada texto reemplazado existe en los niveles', () => {
    const all = LEVELS.flatMap((L) => [L.brief, ...L.tips]);
    for (const k of Object.keys(TEXT_3D)) expect(all, k).toContain(k);
  });
});
