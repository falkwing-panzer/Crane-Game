import { describe, expect, it } from 'vitest';
import { CRANES } from '../crane/cranes';
import { Bus, type GameEvents } from './events';
import { newSmooth, smoothRest, smoothScore, smoothStep, medalFor, SMOOTH } from './smooth';
import { ACHIEVEMENTS, familyOf, newAchievements, type AchCtx } from './achievements';
import { StatsTracker } from './stats';
import { newRun, type Session, type Unit } from './session';
import { newStats } from '../ui/progress';
import { t } from '../i18n';
import { smoothHtml } from '../ui/progressView';

const DT = 1 / 60;
const D = Math.PI / 180;

/** Un izaje sintético: s segundos con balanceo `sw` (°), tensión `k`·estática y la carga que va y viene a `a` m/s² */
function lift(s: number, sw: number, k: number, a: number) {
  const r = newSmooth();
  let v = 0, dir = 1;
  for (let i = 0; i < s / DT; i++) {
    if (Math.abs(v) > 0.5) dir = -Math.sign(v);
    v += dir * a * DT;
    smoothStep(r, DT, { swing: sw * D, tension: 10 * k, static: 10, vx: v, vz: 0 });
  }
  return r;
}

describe('suavidad (fase 22)', () => {
  it('quieta y vertical: 100 y oro; menos de 5 s colgada: sin nota', () => {
    const r = lift(20, 0, 1, 0);
    expect(smoothScore(r)).toMatchObject({ score: 100, medal: 'oro', swing: 0, jerk: 0 });
    expect(smoothScore(lift(4, 0, 1, 0))).toBeNull();
  });

  it('balanceo, tirones y frenazos restan; dentro de lo libre, no', () => {
    expect(smoothScore(lift(20, SMOOTH.swFree * 0.9, 1 + SMOOTH.jkFree * 0.9, 0))!.score).toBe(100);
    const sw = smoothScore(lift(20, 4, 1, 0))!;
    expect(sw.swing).toBeCloseTo(4, 6);
    expect(sw.score).toBe(Math.round(100 - SMOOTH.swK * (4 - SMOOTH.swFree)));
    const jk = smoothScore(lift(20, 0, 1.2, 0))!;
    expect(jk.jerk).toBeCloseTo(20, 6);
    expect(jk.score).toBeLessThan(85);
    const ac = smoothScore(lift(20, 0, 1, 1))!;
    expect(ac.acc).toBeGreaterThan(0.8);
    expect(ac.score).toBeLessThan(80);
  });

  it('cada izaje empieza de cero en el filtro: apoyar y volver a izar no da un frenazo falso', () => {
    const r = newSmooth();
    for (let i = 0; i < 600; i++) smoothStep(r, DT, { swing: 0, tension: 10, static: 10, vx: 2, vz: 0 });
    smoothRest(r);
    for (let i = 0; i < 600; i++) smoothStep(r, DT, { swing: 0, tension: 10, static: 10, vx: -2, vz: 0 });
    expect(r.smAcMax).toBeLessThan(1e-9);
  });

  it('sin estática (tándem) no se miden tirones', () => {
    const r = newSmooth();
    for (let i = 0; i < 600; i++) smoothStep(r, DT, { swing: 0, tension: 99, static: 0, vx: 0, vz: 0 });
    expect(r.smJk).toBe(0);
  });

  it('medallas: oro, plata, bronce o nada; el turno lleva los campos (las instantáneas los copian)', () => {
    expect([medalFor(SMOOTH.oro), medalFor(SMOOTH.plata), medalFor(SMOOTH.bronce), medalFor(SMOOTH.bronce - 1)]).toEqual(['oro', 'plata', 'bronce', null]);
    expect(newRun()).toMatchObject(newSmooth());
  });

  it('el cartel muestra la nota, la medalla y las tres medidas', () => {
    const html = smoothHtml(smoothScore(lift(20, 2, 1.1, 0)), true);
    expect(html).toContain('/ 100');
    expect(html).toContain(t.progress.smoothBest);
    expect(smoothHtml(null, false)).toContain(t.progress.smoothNone);
    expect(smoothHtml(undefined, false)).toBe('');
  });
});

const ctx = (p: Partial<AchCtx> = {}): AchCtx => ({ st: newStats(), rec: {}, smooth: {}, school: [], nLevels: 14, nLessons: 6, ev: { kind: 'tick' }, ...p });
const win = (p: Partial<Extract<AchCtx['ev'], { kind: 'win' }>> = {}) =>
  ({ kind: 'win', li: 0, t: 300, par: 300, maxLmi: 0.9, glass: false, glassMax: 0, smooth: null, ...p }) as const;

describe('logros (fase 22)', () => {
  it('unos 25, cada uno con su título y su texto, sin repetir', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(t.progress.ach[a.id], a.id).toHaveLength(2);
    expect(Object.keys(t.progress.ach).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  it('nada al empezar; los que ya se tienen no se repiten', () => {
    expect(newAchievements(ctx(), {})).toEqual([]);
    const st = { ...newStats(), lifts: 1 };
    expect(newAchievements(ctx({ st }), {})).toEqual(['primer-izaje']);
    expect(newAchievements(ctx({ st }), { 'primer-izaje': 1 })).toEqual([]);
  });

  it('los de un momento: nivel 14 con margen, vidrio suave, rápido, plumín, vuelco con el LMI puenteado', () => {
    const got = (ev: AchCtx['ev']) => newAchievements(ctx({ ev }), {});
    expect(got(win({ li: 13, maxLmi: 0.8 }))).toEqual(expect.arrayContaining(['lmi-80', 'tandem']));
    expect(got(win({ li: 13, maxLmi: 0.81 }))).not.toContain('lmi-80');
    expect(got(win({ glass: true, glassMax: 0.19 }))).toContain('vidrio');
    expect(got(win({ glass: true, glassMax: 0.21 }))).not.toContain('vidrio');
    expect(got(win({ glass: false }))).not.toContain('vidrio');
    expect(got(win({ t: 150 }))).toContain('rapido');
    expect(got(win({ smooth: 95 }))).toContain('seda');
    expect(got({ kind: 'lift', mass: 2, jib: true, slMax: false })).toEqual(['plumin']);
    expect(got({ kind: 'tip', bypass: true })).toEqual(['puenteado']);
    expect(got({ kind: 'tip', bypass: false })).toEqual([]);
  });

  it('los acumulados: familias por grúa, toda la flota, oros y estrellas en todo', () => {
    expect([familyOf('medium'), familyOf('lr'), familyOf('crawler'), familyOf('sk')]).toEqual(['ruedas', 'orugas', 'orugas', 'torre']);
    const secs = Object.fromEntries(Object.keys(CRANES).map((id) => [id, 60]));
    expect(newAchievements(ctx({ st: { ...newStats(), secs } }), {})).toEqual(['flota']);
    const smooth = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, 90]));
    expect(newAchievements(ctx({ smooth }), {})).toEqual(['oro-1', 'oro-5']);
    const rec = Object.fromEntries([...Array(14).keys()].map((i) => [i, { stars: 3, time: 1 }]));
    expect(newAchievements(ctx({ rec }), {})).toEqual(expect.arrayContaining(['todos', 'tres-todos', 'tandem']));
  });
});

/** Una partida de mentira con lo que mira el contador */
function fakeSession() {
  const T = CRANES.medium;
  const unit = { i: 0, id: 'medium', T, S: { vd: 0 }, C: { jib: null, slR: 0 }, phys: { tied: false } } as unknown as Unit;
  let hanging = false, load = 0;
  const ses = {
    bus: new Bus<GameEvents>(), units: [unit], act: unit, bypass: false, L: null, def: { li: -1 }, run: newRun(),
    tipped: () => false, hanging: () => hanging, loadOnHook: () => load,
  } as unknown as Session;
  return { ses, unit, set: (h: boolean, m = 0) => { hanging = h; load = m; } };
}

describe('estadísticas (fase 22)', () => {
  it('cuenta tiempo por grúa, distancia, izajes, toneladas y la racha sin golpes', () => {
    const { ses, unit, set } = fakeSession();
    const tr = new StatsTracker(ses, () => true);
    const got: string[] = [];
    ses.bus.on('achievement', (e) => got.push(e.id));
    unit.S.vd = 2;
    for (let i = 0; i < 120; i++) tr.step(DT);
    expect(tr.st.secs.medium).toBeCloseTo(2, 6);
    expect(tr.st.meters).toBeCloseTo(4, 6);
    unit.S.vd = 0;
    // dos izajes: el primero limpio (la carga sube de 1 a 3 t mientras cuelga: cuenta la mayor), el segundo con golpe
    set(true, 1); tr.step(DT); set(true, 3); tr.step(DT); set(false); tr.step(DT);
    expect(tr.st).toMatchObject({ lifts: 1, tons: 3, clean: 1, bestClean: 1, heaviest: 3 });
    expect(got).toContain('primer-izaje');
    set(true, 2); tr.step(DT);
    ses.bus.emit('strike', { unit: 0, v: 0.5 });
    ses.bus.emit('strike', { unit: 0, v: 0.5 }); // dentro del mismo segundo: un golpe
    set(false); tr.step(DT);
    expect(tr.st).toMatchObject({ lifts: 2, tons: 5, clean: 0, bestClean: 1, bumps: 1 });
    ses.bus.emit('land', { unit: 0, v: 1.6 });
    ses.bus.emit('tipping', { unit: 0 });
    expect(tr.st).toMatchObject({ hard: 1, tips: 1 });
    tr.dispose();
    expect(ses.bus.count()).toBe(1); // solo el oyente de esta prueba
  });

  it('con un guion (banco, pruebas) no cuenta nada', () => {
    const { ses, unit, set } = fakeSession();
    const tr = new StatsTracker(ses, () => false);
    unit.S.vd = 2;
    set(true, 5);
    for (let i = 0; i < 60; i++) tr.step(DT);
    set(false); tr.step(DT);
    ses.bus.emit('strike', { unit: 0, v: 1 });
    ses.bus.emit('tipping', { unit: 0 });
    expect(tr.st).toEqual(newStats());
  });
});
