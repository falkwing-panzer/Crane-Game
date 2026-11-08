import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AT60, CRANES, type CrawlerSpec } from './cranes';
import { initialState } from './kinematics';
import { baseConfig, KF, lmiStatic, ratedCap } from './stability';
import { supportMode, toggleOutriggers } from './ops';
import { CRAWL_CARRY_SPEED, CRAWL_CARRY_TURN, stepDrive, stepSuspension, type DriveCtx } from './drive';
import { carrierPose } from './pose';
import { padsOnSoft, terrainBlocked, type SoftZone } from './terrain';
import { Physics } from '../physics/world';

// Fase 6: conducción sobre orugas (rama T.crawler de step() en la referencia) y terreno blando.

const D = Math.PI / 180;
const T = CRANES.crawler as CrawlerSpec;
const C = baseConfig(T);
const dt = 1 / 60;
const free: DriveCtx = { loadHanging: false, lmiMove: 0, tilted: false };
type St = ReturnType<typeof initialState>;
const run = (S: St, s: number, throttle: number, steer: number, ctx = free) => {
  let last = null;
  for (let i = 0; i < Math.round(s / dt); i++) last = stepDrive(T, S, { throttle, steer, fine: false }, dt, ctx);
  return last!;
};

describe('LR 300: conducción sobre orugas', () => {
  it('empieza con la pluma a 70° y sin estabilizadores', () => {
    const S = initialState(T);
    expect(S.ang).toBeCloseTo(70 * D, 9);
    expect(supportMode(S, T)).toBe('crawler');
    expect(toggleOutriggers(T, C, S, { loadHanging: false })).toMatch(/no tiene estabilizadores/);
  });

  it('acelera a 1,2 m/s² hasta spd.drive y frena a 2,4 m/s²; en marcha el modo es "crawlMove"', () => {
    const S = initialState(T);
    run(S, 0.5, 1, 0);
    expect(S.vd).toBeCloseTo(0.6, 6);
    run(S, 3, 1, 0);
    expect(S.vd).toBeCloseTo(T.spd.drive, 9);
    expect(supportMode(S, T)).toBe('crawlMove');
    expect(S.trackL).toBeCloseTo(S.trackR, 9); // en recta las dos orugas recorren lo mismo
    expect(S.trackL).toBeCloseTo(S.x, 9);
    run(S, 1, 0, 0);
    expect(S.vd).toBe(0);
    expect(supportMode(S, T)).toBe('crawler');
  });

  it('gira en el sitio a spd.turn con ← (izquierda) y las orugas van en sentidos opuestos', () => {
    const S = initialState(T);
    run(S, 2, 0, 1);
    expect(S.h).toBeCloseTo(2 * T.spd.turn, 9);
    expect(S.x).toBe(0);
    expect(S.z).toBe(0);
    expect(supportMode(S, T)).toBe('crawlMove'); // girar en el sitio también es desplazarse (referencia)
    const zc = T.track.hw - T.trackW / 2;
    expect(S.trackR).toBeCloseTo(S.h * zc, 9);
    expect(S.trackL).toBeCloseTo(-S.h * zc, 9);
    run(S, 1, 0, 0);
    expect(supportMode(S, T)).toBe('crawler');
  });

  it('en marcha atrás la dirección se invierte (como la referencia)', () => {
    const S = initialState(T);
    run(S, 2, -1, 0);
    expect(S.vd).toBeCloseTo(-T.spd.drive, 6);
    const h0 = S.h;
    run(S, 1, -1, 1);
    expect(S.h - h0).toBeCloseTo(-T.spd.turn, 9);
  });

  it('pick & carry: con carga colgando va al 45 % y gira al 50 %; el LMI en "crawlMove" lo impide', () => {
    const S = initialState(T);
    run(S, 6, 1, 0, { ...free, loadHanging: true });
    expect(S.vd).toBeCloseTo(T.spd.drive * CRAWL_CARRY_SPEED, 9);
    const R = initialState(T);
    run(R, 1, 0, 1, { ...free, loadHanging: true });
    expect(R.h).toBeCloseTo(T.spd.turn * CRAWL_CARRY_TURN, 9);
    const B = initialState(T);
    const r = run(B, 1, 1, 1, { ...free, loadHanging: true, lmiMove: 1.02 });
    expect(r.lmiCut).toBe(true);
    expect(B.vd).toBe(0);
    expect(B.h).toBe(0);
    // con el LMI puenteado sí se mueve
    run(B, 1, 1, 1, { ...free, loadHanging: true, lmiMove: 1.02, bypass: true });
    expect(B.vd).toBeGreaterThan(0);
    // en marcha la capacidad (KF 0,62) es menor que parada (KF 0,75)
    expect(KF.crawlMove).toBeLessThan(KF.crawler);
    expect(ratedCap(T, C, 'crawlMove', 48, 60 * D, 0)).toBeLessThan(ratedCap(T, C, 'crawler', 48, 60 * D, 0));
    expect(lmiStatic(T, C, 'crawlMove', 48, 60 * D, 0, 10)).toBeGreaterThan(lmiStatic(T, C, 'crawler', 48, 60 * D, 0, 10));
  });

  it('inclinada no avanza ni gira; sin suspensión', () => {
    const S = initialState(T);
    run(S, 1, 1, 1, { ...free, tilted: true });
    expect(S.vd).toBe(0);
    expect(S.h).toBe(0);
    stepSuspension(T, S, 3, dt);
    expect(S.sus.pitch).toBe(0);
  });
});

describe('terreno blando (reglas de carrierBlocked y padsBlocked de la referencia)', () => {
  const zones: SoftZone[] = [{ kind: 'mud', x: 0, z: 0, w: 20, d: 20 }, { kind: 'water', x: 50, z: 0, w: 20, d: 20 }];

  it('las orugas y la RT entran al barro; las demás ruedas no; al agua nadie', () => {
    expect(terrainBlocked(T, zones, 0, 0, 0)).toBeNull();
    expect(terrainBlocked(CRANES.rt, zones, 0, 0, 0)).toBeNull();
    expect(terrainBlocked(AT60, zones, 0, 0, 0)).toMatch(/ruedas se hundirían/);
    expect(terrainBlocked(AT60, zones, -20, 0, 0)).toBeNull();
    // basta con que un borde del apoyo pise el barro
    expect(terrainBlocked(AT60, zones, -10 - AT60.len[1] + 0.5, 0, 0)).toMatch(/ruedas/);
    for (const K of [T, CRANES.rt, AT60]) expect(terrainBlocked(K, zones, 50, 0, 0)).toMatch(/agua/);
  });

  it('las zapatas no se apoyan en barro ni cerca de él', () => {
    expect(padsOnSoft(CRANES.rt, zones, 0, 0, 0)).toMatch(/estabilizador/);
    expect(padsOnSoft(AT60, zones, -16, 0, 0)).toBeNull();
    // la zapata delantera a 0,5 m del barro: dentro del margen de 0,6 m
    expect(padsOnSoft(AT60, zones, -10 - AT60.out!.xf - 0.5, 0, 0)).toMatch(/estabilizador/);
    expect(padsOnSoft(T, zones, 0, 0, 0)).toBeNull(); // sin estabilizadores
  });
});

describe('física: orugas en el barro', () => {
  beforeAll(async () => { await RAPIER.init(); });

  const drive = (K: typeof AT60 | CrawlerSpec, x0: number) => {
    const S = initialState(K);
    S.x = x0;
    const P = new Physics(K, S, carrierPose(K, S, supportMode(S, K)));
    P.softs.push({ kind: 'mud', x: 30, z: 0, w: 20, d: 30 });
    const ctx: DriveCtx = { ...free, blocked: (x, z, h) => P.carrierBlocked(x, z, h) };
    let msg = '';
    for (let i = 0; i < 60 * 20; i++) {
      const r = stepDrive(K, S, { throttle: 1, steer: 0, fine: false }, dt, ctx);
      if (r.msg) msg = r.msg;
      P.step(S, carrierPose(K, S, supportMode(S, K)));
    }
    return { S, msg };
  };

  it('la LR 300 cruza el barro; la AT 60 se detiene en el borde', () => {
    const c = drive(T, 10);
    expect(c.msg).toBe('');
    expect(c.S.x).toBeGreaterThan(30);
    const w = drive(AT60, 0);
    expect(w.msg).toMatch(/ruedas se hundirían/);
    expect(w.S.x + AT60.len[1]).toBeLessThan(20);
    expect(w.S.x + AT60.len[1]).toBeGreaterThan(19.5);
  });
});
