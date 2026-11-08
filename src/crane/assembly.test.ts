import { describe, expect, it } from 'vitest';
import { AT60, CRANES } from './cranes';
import { initialState, stepCrane, type CraneInput } from './kinematics';
import { baseConfig, lmiStatic, ratedCap, structCap } from './stability';
import { toggleOutriggers } from './ops';
import {
  assembling, blockWhileAssembling, outriggersLocked, stepAssembly, teleLimit, toggleBallast, toggleYGuy, yGuyPhase,
} from './assembly';

const D = Math.PI / 180;
const DT = 1 / 60;
const X = CRANES.xl; // AT 500-8: lastre de 165 t en 14 s y Y-guy en 24 s
const idle = (): CraneInput => ({ slew: 0, luff: 0, tele: 0, hoist: 0, fine: false });
const free = { loadHanging: false };

function standing(T = X) {
  const S = initialState(T), C = baseConfig(T);
  S.out = 1; S.outT = 1;
  return { S, C };
}
const run = (T: typeof X, S: ReturnType<typeof initialState>, C: ReturnType<typeof baseConfig>, s: number) => {
  const msgs: string[] = [];
  for (let i = 0; i < Math.round(s / DT); i++) { const m = stepAssembly(T, S, C, DT); if (m) msgs.push(m); }
  return msgs;
};

describe('lastre (B)', () => {
  it('exige estabilizadores apoyados; para desmontar, la carga apoyada', () => {
    const S = initialState(X);
    expect(toggleBallast(X, S, free)).toMatch(/estabilizadores/);
    expect(S.cwT).toBe(0);
    S.out = 1;
    expect(toggleBallast(X, S, free)).toMatch(/165 t/);
    expect(S.cwT).toBe(1);
    expect(toggleBallast(X, S, { loadHanging: true })).toMatch(/Apoya la carga/);
    expect(S.cwT).toBe(1);
    expect(toggleBallast(X, S, free)).toMatch(/Desmontando/);
    expect(toggleBallast(AT60, initialState(AT60), free)).toMatch(/no monta lastre/);
  });

  it('se monta en ballast.t segundos y la masa del contrapeso crece con el avance', () => {
    const { S, C } = standing();
    expect(C.mCw).toBe(X.cwBase);
    toggleBallast(X, S, free);
    run(X, S, C, X.ballast!.t / 2);
    expect(S.cw).toBeCloseTo(0.5, 2);
    expect(C.mCw).toBeCloseTo(X.cwBase! + X.ballast!.m / 2, 0);
    const msgs = run(X, S, C, X.ballast!.t / 2 + 0.1);
    expect(S.cw).toBe(1);
    expect(C.mCw).toBe(X.cwBase! + X.ballast!.m);
    expect(msgs).toContain('Lastre montado');
    toggleBallast(X, S, free);
    expect(run(X, S, C, X.ballast!.t + 0.1)).toContain('Lastre desmontado');
    expect(C.mCw).toBe(X.cwBase);
  });

  it('sin lastre no se puede levantar una carga que con lastre sí', () => {
    const { S, C } = standing();
    S.ang = 40 * D;
    const m = 200; // t; capacidad sin lastre ≈ 89 t, con lastre ≈ 420 t
    expect(ratedCap(X, C, 'out', S.Lb, S.ang, 0)).toBeLessThan(m);
    expect(lmiStatic(X, C, 'out', S.Lb, S.ang, 0, X.hookM + m)).toBeGreaterThan(1);
    toggleBallast(X, S, free);
    run(X, S, C, X.ballast!.t + 0.1);
    expect(ratedCap(X, C, 'out', S.Lb, S.ang, 0)).toBeGreaterThan(m);
    expect(lmiStatic(X, C, 'out', S.Lb, S.ang, 0, X.hookM + m)).toBeLessThan(1);
  });

  it('con lastre no se recogen los estabilizadores', () => {
    const { S, C } = standing();
    toggleBallast(X, S, free);
    const r = toggleOutriggers(X, C, S, { loadHanging: false, locked: outriggersLocked(S) });
    expect(r).toMatch(/Desmonta el lastre/);
    expect(S.outT).toBe(1);
  });
});

describe('arriostramiento en Y (Y)', () => {
  it('condiciones de la referencia: estabilizadores, pluma recogida y carga apoyada', () => {
    const S = initialState(X);
    expect(toggleYGuy(X, S, free)).toMatch(/estabilizadores/);
    S.out = 1; S.Lb = X.boom.min + 1;
    expect(toggleYGuy(X, S, free)).toMatch(/Retrae la pluma/);
    S.Lb = X.boom.min;
    expect(toggleYGuy(X, S, { loadHanging: true })).toMatch(/Apoya la carga/);
    expect(toggleYGuy(X, S, free)).toMatch(/Montando/);
    expect(S.ygT).toBe(1);
    expect(toggleYGuy(CRANES.at300, S, free)).toMatch(/no lleva/);
  });

  it('solo cuenta tensado al 100 %, con fases levantar → abrir → tensar', () => {
    const { S, C } = standing();
    toggleYGuy(X, S, free);
    const phases: string[] = [];
    for (let t = 0; t < X.yguy!.t + 0.2; t += DT) {
      stepAssembly(X, S, C, DT);
      const p = yGuyPhase(S.yg).split(' ')[0];
      if (phases[phases.length - 1] !== p) phases.push(p);
      if (S.yg < 1) expect(C.yOn).toBe(false);
    }
    expect(phases).toEqual(['levantando', 'abriendo', 'tensando', 'tensado']);
    expect(C.yOn).toBe(true);
    // con pluma larga la capacidad estructural sube (yNoGuy)
    expect(structCap(X, C, 45)).toBeGreaterThan(structCap(X, { ...C, yOn: false }, 45));
  });

  it('sin Y-guy tensado la pluma no pasa de teleMax; tensado llega a boom.max', () => {
    const { S, C } = standing();
    const inp = { ...idle(), tele: 1 };
    const lim = () => ({ lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, teleMax: teleLimit(X, S) });
    for (let i = 0; i < 60 * 60; i++) stepCrane(X, S, inp, DT, lim());
    expect(S.Lb).toBeCloseTo(X.yguy!.teleMax, 6);
    S.Lb = X.boom.min;
    toggleYGuy(X, S, free);
    run(X, S, C, X.yguy!.t + 0.1);
    for (let i = 0; i < 90 * 60; i++) stepCrane(X, S, inp, DT, lim());
    expect(S.Lb).toBe(X.boom.max);
    // las grúas sin Y-guy no tienen tope
    expect(teleLimit(CRANES.at300, initialState(CRANES.at300))).toBe(CRANES.at300.boom.max);
  });
});

describe('bloqueo mientras se monta', () => {
  it('anula los mandos de la grúa y avisa; al terminar se libera', () => {
    const { S, C } = standing();
    toggleBallast(X, S, free);
    stepAssembly(X, S, C, DT);
    expect(assembling(S)).toBe('lastre');
    const inp = { ...idle(), slew: 1, hoist: -1 };
    expect(blockWhileAssembling(S, inp)).toMatch(/lastre/);
    expect(inp.slew).toBe(0);
    expect(inp.hoist).toBe(0);
    expect(blockWhileAssembling(S, idle())).toBeNull(); // sin mandos, sin aviso
    run(X, S, C, X.ballast!.t);
    expect(assembling(S)).toBeNull();
    const inp2 = { ...idle(), slew: 1 };
    expect(blockWhileAssembling(S, inp2)).toBeNull();
    expect(inp2.slew).toBe(1);
  });
});
