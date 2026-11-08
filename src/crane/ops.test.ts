import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AT60 } from './cranes';
import { initialState, stepCrane, stepOutriggers, carrierLift, headPos, type CraneInput } from './kinematics';
import { baseConfig, craneMasses, lmiStatic, ratedCap, tipEdge, tipUtil } from './stability';
import { dynamicStability, stepTilt, supportMode, toggleOutriggers, TIP_PHI } from './ops';
import { apply, carrierPose, edgeAxis } from './pose';
import { Physics, FIXED_DT } from '../physics/world';

const D = Math.PI / 180;
const T = AT60;
const C = baseConfig(T);
const idle: CraneInput = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false };

describe('tipEdge', () => {
  it('da la misma utilización que tipUtil y la arista hacia la que apunta la pluma', () => {
    for (const md of ['tire', 'out'] as const) for (const slew of [0, 30, 90, 135, 180, 270].map((a) => a * D)) {
      const ms = craneMasses(T, C, 30, 20 * D, slew);
      ms.push([5, T.piv + 25 * Math.cos(slew), 25 * Math.sin(slew)]);
      const r = tipEdge(T, md, ms);
      expect(r.u).toBeCloseTo(tipUtil(T, md, ms), 12);
    }
    const edgeAt = (slewDeg: number) => {
      const s = slewDeg * D, ms = craneMasses(T, C, 30, 20 * D, s);
      ms.push([20, T.piv + 25 * Math.cos(s), 25 * Math.sin(s)]);
      return tipEdge(T, 'out', ms).edge;
    };
    expect(edgeAt(0)).toBe(0); // delante
    expect(edgeAt(180)).toBe(1); // detrás
    expect(edgeAt(90)).toBe(2); // izquierda (slew +, −z en el mundo)
    expect(edgeAt(-90)).toBe(3);
  });
});

describe('cortes del LMI (guard)', () => {
  // Sobre neumáticos, pluma de 25 m a 35°, con una carga al 99 % de la capacidad
  const setup = () => {
    const S = initialState(T);
    S.Lb = 25; S.ang = 35 * D;
    const m = ratedCap(T, C, 'tire', S.Lb, S.ang, S.slew) * 0.99;
    const lmi = (s: typeof S) => lmiStatic(T, C, 'tire', s.Lb, s.ang, s.slew, m);
    const lim = () => ({ lmi, L0: lmi(S), noHoistUp: false, tilted: false });
    return { S, lmi, lim };
  };

  it('bloquea bajar la pluma al llegar al 100 % y deja subirla', () => {
    const { S, lmi, lim } = setup();
    let cut = false;
    for (let i = 0; i < 300; i++) cut = stepCrane(T, S, { ...idle, luff: -1 }, 1 / 60, lim()) || cut;
    expect(cut).toBe(true);
    expect(lmi(S)).toBeLessThan(1);
    expect(S.v.ang).toBe(0);
    const a = S.ang;
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle, luff: 1 }, 1 / 60, lim());
    expect(S.ang).toBeGreaterThan(a + 1 * D);
  });

  it('bloquea telescopar afuera y deja recoger', () => {
    const { S, lmi, lim } = setup();
    for (let i = 0; i < 300; i++) stepCrane(T, S, { ...idle, tele: 1 }, 1 / 60, lim());
    expect(lmi(S)).toBeLessThan(1);
    expect(S.Lb).toBeLessThan(26);
    const L = S.Lb;
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle, tele: -1 }, 1 / 60, lim());
    expect(S.Lb).toBeLessThan(L - 0.3);
  });

  it('con la carga por encima de la capacidad no deja subirla pero sí bajarla', () => {
    const S = initialState(T);
    const lim = { lmi: () => 0, L0: 0, noHoistUp: true, tilted: false };
    const c0 = S.cable;
    expect(stepCrane(T, S, { ...idle, hoist: -1 }, 1 / 60, lim)).toBe(true);
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle, hoist: -1 }, 1 / 60, lim);
    expect(S.cable).toBe(c0);
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle, hoist: 1 }, 1 / 60, lim);
    expect(S.cable).toBeGreaterThan(c0);
  });

  it('inclinada solo deja subir la pluma y recoger', () => {
    const S = initialState(T);
    S.Lb = 30;
    const lim = { lmi: () => 0, L0: 0, noHoistUp: false, tilted: true };
    const a = S.ang, L = S.Lb;
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle, luff: -1, tele: 1 }, 1 / 60, lim);
    expect(S.ang).toBe(a);
    expect(S.Lb).toBe(L);
  });
});

describe('estabilizadores', () => {
  it('se despliegan en T.out.t, levantan el chasis y suben la capacidad', () => {
    const S = initialState(T);
    expect(supportMode(S)).toBe('tire');
    toggleOutriggers(T, C, S, { loadHanging: false });
    for (let t = 0; t < T.out.t! - 0.1; t += 1 / 60) stepOutriggers(T, S, 1 / 60);
    expect(supportMode(S)).toBe('tire'); // a medio desplegar sigue sobre neumáticos
    for (let i = 0; i < 30; i++) stepOutriggers(T, S, 1 / 60);
    expect(S.out).toBe(1);
    expect(supportMode(S)).toBe('out');
    expect(carrierLift(S)).toBeCloseTo(0.3);
    // de lado (90°) la base pasa de 1,25 a 3,6 m de media anchura. (Por delante NO: en los datos de la
    // referencia la viga delantera, out.xf = 1,6, está detrás del eje delantero, tire.xf = 3,4.)
    S.Lb = 30; S.ang = 40 * D;
    expect(ratedCap(T, C, 'out', S.Lb, S.ang, 90 * D)).toBeGreaterThan(2 * ratedCap(T, C, 'tire', S.Lb, S.ang, 90 * D));
  });

  it('no se recogen con la carga colgando ni si sobre neumáticos no es estable', () => {
    const S = initialState(T);
    S.out = 1; S.outT = 1;
    expect(toggleOutriggers(T, C, S, { loadHanging: true })).toMatch(/Apoya la carga/);
    S.Lb = 42; S.ang = 0; S.slew = 90 * D;
    expect(toggleOutriggers(T, C, S, { loadHanging: false })).toMatch(/LMI/);
    expect(S.outT).toBe(1);
  });
});

describe('vuelco analítico', () => {
  it('la pose gira sobre la arista: la arista queda quieta y el lado contrario sube', () => {
    const S = initialState(T);
    S.phi = 0.05; S.edge = 0;
    const P = carrierPose(T, S, 'tire');
    const e = apply(P, edgeAxis(T, 'tire', 0).p);
    expect(e.x).toBeCloseTo(T.tire.xf); expect(e.y).toBeCloseTo(0); expect(e.z).toBeCloseTo(0);
    const rear = apply(P, { x: T.tire.xr, y: 0, z: 0 });
    expect(rear.y).toBeCloseTo((T.tire.xf - T.tire.xr) * Math.sin(0.05), 6);
    const head = apply(P, headPos(T, S));
    expect(head.x).toBeGreaterThan(headPos(T, S).x); // la cabeza se va hacia delante
  });

  it('phi crece con utilización > 1 hasta volcar y se recupera si baja', () => {
    const S = initialState(T);
    let t = 0;
    while (!stepTilt(S, { u: 1.1, edge: 2, lmi: 1.7 }, 1 / 60)) t += 1 / 60;
    expect(S.edge).toBe(2);
    expect(S.phi).toBeGreaterThan(TIP_PHI);
    expect(t).toBeGreaterThan(0.5);
    const R = initialState(T);
    for (let i = 0; i < 20; i++) stepTilt(R, { u: 1.05, edge: 0, lmi: 1.6 }, 1 / 60);
    expect(R.phi).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) stepTilt(R, { u: 0.8, edge: 0, lmi: 1.2 }, 1 / 60);
    expect(R.phi).toBe(0);
    expect(R.edge).toBe(-1);
  });
});

describe('física: tensión del cable y caída de la grúa', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('la tensión medida en reposo es la masa del gancho y crece con un tirón', () => {
    const S = initialState(T);
    const P = new Physics(T, S, carrierPose(T, S, 'tire'));
    for (let i = 0; i < 180; i++) P.step(S, carrierPose(T, S, 'tire'));
    expect(P.tension).toBeCloseTo(T.hookM, 2);
    // tirón: subir el gancho de golpe
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      stepCrane(T, S, { ...idle, hoist: -1 }, FIXED_DT);
      P.step(S, carrierPose(T, S, 'tire'));
      peak = Math.max(peak, P.tension);
    }
    expect(peak).toBeGreaterThan(T.hookM * 1.1);
  });

  it('volcada, la grúa cae hacia la arista, no tiembla y se reinicia de pie', () => {
    const S = initialState(T);
    S.Lb = 42; S.ang = 15 * D; S.slew = 90 * D;
    const md = 'tire';
    // forzar el vuelco con una carga enorme en el gancho (tensión ficticia)
    let P0 = carrierPose(T, S, md);
    const P = new Physics(T, S, P0);
    let k = 0;
    while (!stepTilt(S, dynamicStability(T, C, S, md, 12, { x: headPos(T, S).x, z: headPos(T, S).z }), FIXED_DT) && k++ < 600) {
      P0 = carrierPose(T, S, md);
      P.step(S, P0);
    }
    expect(S.edge).toBe(2);
    const { p, axis } = edgeAxis(T, md, S.edge);
    P.tipOver(C, S, md, P0, p, axis);
    let prevY = Infinity, upTicks = 0;
    for (let i = 0; i < 60 * 6; i++) {
      P.step(S, P0);
      const y = P.headWorld().y;
      if (i > 5 && y > prevY + 0.05) upTicks++; // la cabeza no debe rebotar hacia arriba
      prevY = y;
    }
    const q = P.tippedPose()!.q;
    const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
    expect(up.z).toBeLessThan(-0.3); // cayó hacia −z (izquierda)
    expect(P.headWorld().y).toBeLessThan(6);
    expect(upTicks).toBeLessThan(3);
    const v = P.tipped!.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.2); // quieta al final
    P.reset(initialState(T), carrierPose(T, initialState(T), md));
    expect(P.tipped).toBeNull();
  });
});
