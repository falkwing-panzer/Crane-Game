import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { carrierPose } from '../crane/pose';
import { supportMode } from '../crane/ops';
import { Physics } from '../physics/world';
import { doable } from './generate';
import { allPlaced, inZone, levelBounds, placeCrane, populate } from './setup';
import { playBlind } from './safety.world.test';
import { SCENARIO_LEVELS } from './scenarios';
import { ALL_LEVELS } from './tandemSetup';
import { gustAt } from './events';
import { windAt } from './rules';
import * as THREE from 'three';
import { Session, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { allModels } from '../render/models/allModels';
import { t } from '../i18n';

// Fase 27: escenarios nuevos (niveles 24–26). Cada grúa permitida se arma sin choques y el plan de izaje dice que
// llega con cada carga a alguna zona desde donde empieza.

describe('escenarios de la fase 27', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('son los niveles 24, 25 y 26', () => {
    expect(SCENARIO_LEVELS.map((L) => ALL_LEVELS.indexOf(L) + 1)).toEqual([24, 25, 26]);
  });

  for (const L of SCENARIO_LEVELS) {
    it(`${L.name}: cada grúa permitida tiene sitio y llega con cada carga (plan de izaje)`, () => {
      for (const id of L.cranes) expect(doable(id, L), `${L.name}: ${CRANES[id].name}`).toBe(true);
    });

    for (const id of L.cranes) {
      it(`${L.name} con ${CRANES[id].name}: se arma sin choques y las cargas quedan quietas fuera de las zonas`, () => {
        const T = CRANES[id], S = initialState(T);
        placeCrane(T, S, L);
        const pose = carrierPose(T, S, supportMode(S, T));
        const P = new Physics(T, S, pose, { testLoad: false, bounds: levelBounds(L) });
        populate(P, L);
        expect(P.carrierBlocked(S.x, S.z, S.h), 'chasis').toBeNull();
        expect(P.tailBlocked(S, S.slew, S.cw), 'contrapeso').toBeNull();
        if (T.out) expect(P.padsBlocked(S), 'zapatas').toBeNull();
        for (let k = 0; k < 120; k++) P.step(S, pose);
        for (const l of P.loads) {
          const t = l.body.translation();
          expect(Math.hypot(t.x - l.home.x, t.y - l.home.y, t.z - l.home.z), l.label).toBeLessThan(0.05);
        }
        expect(allPlaced(P.loads.map((l) => P.placed(l)), L.zones)).toBe(false);
      });
    }
  }

  it('loma: entre ráfagas hay calma (menos del límite) al menos 2 de cada 4 minutos', () => {
    const L = SCENARIO_LEVELS[0];
    let calm = 0, n = 0;
    for (let t = 0; t < 1200; t += 1) {
      const v = windAt(L, t) + gustAt(L.events, t);
      if (v < L.windLimit!.v) calm++;
      n++;
    }
    expect(calm / n).toBeGreaterThan(0.5);
    // y en las ráfagas pasa del límite
    const peak = Math.max(...Array.from({ length: 1200 }, (_, t) => windAt(L, t) + gustAt(L.events, t)));
    expect(peak).toBeGreaterThan(L.windLimit!.v);
  });
});

describe('escenarios de la fase 27 en la simulación', () => {
  beforeAll(async () => { await RAPIER.init(); });

  // un operador de guion que solo obedece al señalero (como los niveles a ciegas de la fase 23)
  for (const n of [25, 26]) {
    it(`nivel ${n}: se termina obedeciendo solo al señalero`, () => {
      const r = playBlind(n, 3000);
      expect(r.end, `sin terminar a los ${r.t.toFixed(0)} s: ${r.log.slice(-4).join(' | ')}`).not.toBeNull();
      expect(r.end!.fail, JSON.stringify(r.end!.fail)).toBeNull();
    }, 600_000);
  }

  it('aerogenerador: los dos tramos y la góndola apilados en la cimentación y el rotor en el premontaje gana', () => {
    const L = SCENARIO_LEVELS[0], T = CRANES[L.rec], S = initialState(T);
    placeCrane(T, S, L);
    const pose = carrierPose(T, S, supportMode(S, T));
    const P = new Physics(T, S, pose, { testLoad: false, bounds: levelBounds(L) });
    populate(P, L);
    const at = (label: string, x: number, y: number, z: number) => {
      const l = P.loads.find((q) => q.label === label)!;
      l.body.setTranslation({ x, y: y + l.half.y, z }, true);
      l.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    };
    const pad = L.zones[0];
    at('TORRE 1', pad.x, 1, pad.z);
    at('TORRE 2', pad.x, 16, pad.z);
    at('GÓNDOLA', pad.x, 31.02, pad.z);
    at('BUJE', 38.5, 0, 44);
    [40.5, 44, 47.5].forEach((z, i) => at(`PALA ${i + 1}`, 22, 0, z));
    for (let k = 0; k < 180; k++) P.step(S, pose);
    const placed = P.loads.map((l) => P.placed(l));
    expect(placed.every((p) => p && L.zones.some((z) => inZone(p, z))), JSON.stringify(placed)).toBe(true);
    // sin la góndola arriba, no
    at('GÓNDOLA', 64, 0, 64);
    for (let k = 0; k < 120; k++) P.step(S, pose);
    expect(allPlaced(P.loads.map((l) => P.placed(l)), L.zones)).toBe(false);
  });
});

describe('límite de viento de las piezas grandes (fase 27)', () => {
  beforeAll(async () => { await RAPIER.init(); });

  const hang = (t: number) => {
    const ses = new Session(sessionDef('?nivel=24'), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    let end: { fail: { title: string } | null } | null = null;
    ses.bus.on('end', (e) => { end = e as typeof end; });
    ses.running = true;
    const u = ses.act, P = u.phys, blade = P.loads.find((l) => l.label === 'PALA 1')!;
    // la pala, colgando 3 m por encima de su sitio (enganchada con el gancho puesto encima)
    const b = blade.body.translation();
    blade.body.setTranslation({ x: b.x, y: b.y + 3, z: b.z }, true);
    P.hookBody.setTranslation({ x: b.x, y: b.y + 3 + blade.half.y + 0.8, z: b.z }, true);
    expect(P.toggleHook()).toMatch(/Enganchad/);
    ses.run.t = t;
    for (let i = 0; i < 5 * 60 && !end; i++) game.tick(1 / 60);
    return end as { fail: { title: string } | null } | null;
  };

  it('en plena ráfaga, con una pala colgando más de 3 s, falla', () => {
    const L = SCENARIO_LEVELS[0], g = L.events![0];
    const e = hang(g.t + g.dur / 2 - 1);
    expect(e?.fail?.title).toBe(t.rules.windLimitTitle);
  });

  it('en calma no pasa nada', () => {
    expect(hang(20)).toBeNull();
  });
});
