import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES, type CrawlerSpec } from './cranes';
import { headPos, initialState, stepCrane, cableMax, type CraneInput } from './kinematics';
import { baseConfig, lmiStatic } from './stability';
import { stepSuperlift, trayHitsTracks, SUPERLIFT_SPEED } from './superlift';
import { apply, carrierFrame, carrierPose, edgeAxis, rotate } from './pose';
import { dynamicStability, stepTilt } from './ops';
import { Physics, FIXED_DT } from '../physics/world';

// Fase 6B: LR 3000. Radio del superlift (K/L), choques de la bandeja y cable con cargas de cientos de t.

const D = Math.PI / 180;
const T = CRANES.lr as CrawlerSpec;
const sl = T.superlift!;
const dt = 1 / 60;
const idle: CraneInput = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false };
const free = { lmi: () => 0, L0: 0, hit: () => null };

describe('LR 3000: radio del superlift (K/L)', () => {
  it('empieza en r0, se mueve a 0,5 m/s (fino ×0,3) y se queda entre rMin y rMax', () => {
    const C = baseConfig(T);
    expect(C.slR).toBe(sl.r0);
    for (let i = 0; i < 60; i++) stepSuperlift(T, C, 1, false, dt, free);
    expect(C.slR).toBeCloseTo(sl.r0 + SUPERLIFT_SPEED, 9);
    for (let i = 0; i < 60; i++) stepSuperlift(T, C, -1, true, dt, free);
    expect(C.slR).toBeCloseTo(sl.r0 + SUPERLIFT_SPEED * 0.7, 9);
    for (let i = 0; i < 60 * 40; i++) stepSuperlift(T, C, 1, false, dt, free);
    expect(C.slR).toBe(sl.rMax);
    for (let i = 0; i < 60 * 40; i++) stepSuperlift(T, C, -1, false, dt, free);
    expect(C.slR).toBe(sl.rMin);
  });

  it('acercar la bandeja baja la capacidad; el LMI lo corta en 100 % pero deja alejarla', () => {
    const C = baseConfig(T);
    const Lb = 108, ang = 50 * D, slew = 0;
    // masa que deja el LMI justo por debajo de 1 con el radio inicial
    let m = 0;
    while (lmiStatic(T, C, 'crawler', Lb, ang, slew, m + 5) < 1) m += 5;
    const ctx = { lmi: () => lmiStatic(T, C, 'crawler', Lb, ang, slew, m), L0: lmiStatic(T, C, 'crawler', Lb, ang, slew, m), hit: () => null };
    let cut = 0;
    for (let i = 0; i < 600; i++) {
      ctx.L0 = ctx.lmi();
      if (stepSuperlift(T, C, -1, false, dt, ctx) === 'lmi') cut++;
    }
    expect(cut).toBeGreaterThan(0);
    expect(C.slR).toBeGreaterThan(sl.rMin);
    expect(lmiStatic(T, C, 'crawler', Lb, ang, slew, m)).toBeLessThan(1);
    const r = C.slR;
    stepSuperlift(T, C, 1, false, dt, ctx);
    expect(C.slR).toBeGreaterThan(r); // alejarla siempre ayuda
  });

  it('un choque de la bandeja deshace el paso y devuelve el aviso', () => {
    const C = baseConfig(T);
    const why = stepSuperlift(T, C, 1, false, dt, { ...free, hit: (r) => (r > sl.r0 ? 'choque' : null) });
    expect(why).toBe('choque');
    expect(C.slR).toBe(sl.r0);
  });

  it('la bandeja solo puede pisar las orugas con el radio por debajo de 15,8 m', () => {
    let rFree = sl.rMin;
    for (let r = sl.rMin; r <= sl.rMax; r += 0.05) {
      let any = false;
      for (let a = 0; a < 360; a += 1) if (trayHitsTracks(T, r, a * D)) any = true;
      if (any) rFree = r + 0.05;
    }
    expect(rFree).toBeLessThan(15.9);
    expect(trayHitsTracks(T, sl.rMin, 35 * D)).toBe(true);
    expect(trayHitsTracks(T, sl.rMin, 0)).toBe(false); // justo detrás no hay orugas
  });
});

describe('LR 3000: física', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('la bandeja choca con un obstáculo al girar, al cambiar de radio y al conducir', () => {
    const S = initialState(T);
    const P = new Physics(T, S, carrierPose(T, S, 'crawler'));
    // contenedor a 24 m detrás de la grúa, a la izquierda
    P.addObstacle({ label: 'Contenedor', kind: 'container', half: { x: 3, y: 1.3, z: 1.2 }, pos: { x: -17, y: 1.3, z: -17 }, rotY: 0 });
    P.step(S, carrierPose(T, S, 'crawler'));
    expect(P.trayBlocked(S.x, S.z, S.h, 0, sl.r0)).toBeNull();
    // la bandeja va hacia −z (izquierda) con slew negativo (giro a la derecha)
    expect(P.trayBlocked(S.x, S.z, S.h, -45 * D, sl.r0)).toMatch(/superlift/);
    // stepCrane con slewBlocked: se para antes del obstáculo
    const lim = { lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, slewBlocked: (s: typeof S) => !!P.trayBlocked(s.x, s.z, s.h, s.slew, sl.r0) };
    for (let i = 0; i < 60 * 120; i++) stepCrane(T, S, { ...idle, slew: -1 }, dt, lim);
    expect(S.slew).toBeLessThan(-10 * D);
    expect(S.slew).toBeGreaterThan(-45 * D);
    expect(P.trayBlocked(S.x, S.z, S.h, S.slew, sl.r0)).toBeNull();
    // conducir hacia el obstáculo con la bandeja detrás: la grúa marcha atrás y la bandeja golpea
    S.slew = -40 * D;
    P.step(S, carrierPose(T, S, 'crawler'));
    expect(P.carrierBlocked(0, 0, 0)).toMatch(/superlift/);
  });

  it('largo de cable: llega al suelo desde la cabeza a 107 m', () => {
    const S = initialState(T);
    expect(cableMax(T, S)).toBeGreaterThan(headPos(T, S).y);
    // empieza con el gancho cerca del suelo (como la referencia)
    expect(headPos(T, S).y - S.cable).toBeLessThan(7);
  });

  it('con 800 t, el cable no se estira y la tensión no oscila al izar a velocidad plena', () => {
    const S = initialState(T);
    S.ang = 68 * D;
    const pose = carrierPose(T, S, 'crawler');
    const hp = apply(pose, headPos(T, S));
    S.cable = hp.y - 5 - 0.6 - 1.0;
    const P = new Physics(T, S, pose);
    const L = P.addLoad('Pieza', 800, { x: 3, y: 2.5, z: 3 }, { x: hp.x, y: 2.5, z: hp.z });
    for (let i = 0; i < 120; i++) P.step(S, pose);
    expect(P.toggleHook()).toMatch(/Enganchada/);
    // izar a velocidad plena 12 s
    let stretch = 0, tMin = Infinity, tMax = 0;
    for (let i = 0; i < 60 * 12; i++) {
      stepCrane(T, S, { ...idle, hoist: -1 }, FIXED_DT);
      P.step(S, pose);
      const t = P.hookTop(), d = Math.hypot(t.x - hp.x, t.y - hp.y, t.z - hp.z);
      stretch = Math.max(stretch, d - S.cable);
      if (i > 60 * 4) { tMin = Math.min(tMin, P.tension); tMax = Math.max(tMax, P.tension); } // ya despegada
    }
    expect(L.body.translation().y).toBeGreaterThan(6);
    expect(stretch).toBeLessThan(0.06);
    expect(tMin).toBeGreaterThan(840 * 0.85);
    expect(tMax).toBeLessThan(840 * 1.15);
    for (let i = 0; i < 300; i++) P.step(S, pose);
    expect(P.tension).toBeCloseTo(840, 0);
  });

  it('volcada hacia delante, cae sobre la arista delantera con la pluma al suelo', () => {
    const S = initialState(T);
    S.ang = 50 * D;
    const C = baseConfig(T);
    let pose = carrierPose(T, S, 'crawler');
    const P = new Physics(T, S, pose);
    const hp = headPos(T, S);
    let k = 0;
    while (!stepTilt(S, dynamicStability(T, C, S, 'crawler', 3000, { x: hp.x, z: hp.z }), FIXED_DT) && k++ < 1200) {
      pose = carrierPose(T, S, 'crawler');
      P.step(S, pose, C.slR);
    }
    expect(S.edge).toBe(0);
    const { p, axis } = edgeAxis(T, 'crawler', S.edge);
    const f = carrierFrame(S);
    P.tipOver(C, S, 'crawler', pose, apply(f, p), rotate(f.q, axis));
    for (let i = 0; i < 60 * 8; i++) P.step(S, pose, C.slR);
    const h = P.headWorld();
    expect(Number.isFinite(h.y)).toBe(true);
    expect(h.y).toBeLessThan(40); // la pluma de 108 m acabó en el suelo
    expect(h.x).toBeGreaterThan(60); // hacia delante
  });
});
