import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from './cranes';
import { headPos, initialState, stepCrane, tipPos, type CraneInput, type CraneState } from './kinematics';
import { baseConfig, lmiStatic, reach, structCap, type CraneConfig } from './stability';
import { assembling, blockWhileAssembling, outriggersLocked, stepAssembly, toggleMount, towerPhase } from './assembly';
import { apply, carrierPose, edgeAxis } from './pose';
import { dynamicStability, stepTilt } from './ops';
import { FIXED_DT } from '../physics/world';
import { towerGeom } from './tower';
import { loadReference, loadTowerReference } from './reference';
import { Physics } from '../physics/world';

// Fase 8: grúa torre autodesplegable SK 60 (montaje con M, carro con Q/E, curva de la torre).

const D = Math.PI / 180;
const DT = 1 / 60;
const T = CRANES.sk;
const tw = T.tower!;
const idle = (): CraneInput => ({ slew: 0, luff: 0, tele: 0, hoist: 0, fine: false });
const free = { loadAttached: false, groundBlocked: null };

function standing() {
  const S = initialState(T), C = baseConfig(T);
  S.out = 1; S.outT = 1;
  return { S, C };
}
const assemble = (S: CraneState, C: CraneConfig, s: number) => {
  const msgs: string[] = [];
  for (let i = 0; i < Math.round(s / DT); i++) { const m = stepAssembly(T, S, C, DT); if (m) msgs.push(m); }
  return msgs;
};
function mounted() {
  const { S, C } = standing();
  expect(toggleMount(T, S, free)).toMatch(/Montando/);
  assemble(S, C, tw.t + 0.5);
  return { S, C };
}

describe('geometría de la torre (towerGeom de la referencia)', () => {
  const ref = loadReference().CRANES.sk;
  const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
    // marco de la referencia: lateral +y = nuestro −z
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(-b.z, 6);
  };

  it('punta de la torre, punta del cable y extremo de la pluma iguales a la referencia en todo el montaje', () => {
    let n = 0;
    for (const er of [0, 0.1, 0.3, 0.45, 0.5, 0.6, 0.7, 0.75, 0.85, 0.95, 1]) {
      for (const ang of [0, 12 * D, 30 * D]) for (const Lb of [3, 20, 60]) for (const slew of [0, 0.7, -2]) {
        // estabilizadores recogidos: lift() = 0 en la referencia (aquí la elevación va en la pose)
        const RS = { er, ang, Lb, slew, h: 0, cx: 0, cz: 0, outS: 0 };
        const R = loadTowerReference(ref, RS);
        const S = { er, ang, Lb, slew, jg: 0, jibRel: 0 };
        close(tipPos(T, S), R.tipPos());
        close(headPos(T, S), R.headPos());
        const g = towerGeom(T, S), rg = R.towerGeom();
        expect(g.hgt).toBeCloseTo(rg.hgt, 9);
        expect(g.jl).toBeCloseTo(rg.jl, 9);
        expect(g.phi).toBeCloseTo(rg.phi, 9);
        n++;
      }
    }
    expect(n).toBe(11 * 27);
  });

  it('tumbada hacia delante, de pie a 37,2 m y con la pluma a su ángulo al terminar', () => {
    const g0 = towerGeom(T, { er: 0, ang: 0, slew: 0 });
    expect(g0.top[0]).toBeCloseTo(T.piv + tw.H0, 9);
    expect(g0.top[1]).toBeCloseTo(T.deckHi + 0.6, 9);
    const g1 = towerGeom(T, { er: 1, ang: 10 * D, slew: 0 });
    expect(g1.top[1]).toBeCloseTo(T.deckHi + 0.6 + tw.H, 9);
    expect(g1.jl).toBe(tw.J);
    expect(g1.jlVis).toBe(tw.J);
    expect(Math.atan2(g1.jd[1], g1.jd[0])).toBeCloseTo(10 * D, 9);
    // la pluma dibujada se alarga más tarde: su punta nunca baja de 4 m sobre el suelo del chasis
    for (let er = 0.7; er <= 1; er += 0.005) {
      const g = towerGeom(T, { er, ang: 0, slew: 0 });
      expect(g.top[1] + g.jd[1] * g.jlVis).toBeGreaterThan(4);
    }
  });

  it('radio del carro = reach() de la estabilidad', () => {
    const { S, C } = mounted();
    S.Lb = 25; S.ang = 20 * D; S.slew = 1.1;
    const tp = tipPos(T, S);
    expect(Math.hypot(tp.x - T.piv, tp.z)).toBeCloseTo(reach(T, C, S.Lb, S.ang), 9);
  });
});

describe('montaje de la grúa torre (M)', () => {
  it('empieza plegada con la pluma horizontal, el carro adentro y 1,5 m de cable (referencia)', () => {
    const S = initialState(T);
    expect(S.ang).toBe(0);
    expect(S.Lb).toBe(T.boom.min);
    expect(S.cable).toBe(1.5);
    expect(S.er).toBe(0);
  });

  it('condiciones de la referencia para montar', () => {
    const S = initialState(T);
    expect(toggleMount(T, S, free)).toMatch(/estabilizadores/);
    S.out = 1;
    expect(toggleMount(T, S, { loadAttached: true, groundBlocked: null })).toMatch(/Suelta la carga/);
    expect(toggleMount(T, S, free)).toMatch(/Montando/);
    expect(S.erT).toBe(1);
  });

  it('tarda 45 s; mientras tanto (y plegada) no hay giro, pluma, carro ni cable', () => {
    const { S, C } = standing();
    const inp = { ...idle(), slew: 1 };
    expect(blockWhileAssembling(S, inp, T)).toMatch(/Monta la grúa torre primero/);
    expect(inp.slew).toBe(0);
    toggleMount(T, S, free);
    assemble(S, C, 20);
    expect(S.er).toBeCloseTo(20 / tw.t, 6);
    expect(assembling(S, T)).toBe('torre');
    expect(towerPhase(S.er, S.erT)).toMatch(/levantando torre/);
    const inp2 = { ...idle(), tele: 1, hoist: 1 };
    expect(blockWhileAssembling(S, inp2, T)).toMatch(/Espera/);
    expect(inp2.tele + inp2.hoist).toBe(0);
    expect(outriggersLocked(S)).toMatch(/torre/);
    const msgs = assemble(S, C, tw.t - 20 + 0.2);
    expect(msgs).toContain('Grúa torre montada');
    expect(S.er).toBe(1);
    expect(assembling(S, T)).toBeNull();
    expect(towerPhase(S.er, S.erT)).toBe('montada');
    // otras grúas no cambian
    expect(assembling(S)).toBeNull();
  });

  it('para plegar: carro adentro, pluma horizontal y girada hacia delante', () => {
    const { S, C } = mounted();
    S.Lb = 10;
    expect(toggleMount(T, S, free)).toMatch(/carro adentro/);
    S.Lb = T.boom.min; S.ang = 5 * D;
    expect(toggleMount(T, S, free)).toMatch(/carro adentro/);
    S.ang = 0; S.slew = 10 * D;
    expect(toggleMount(T, S, free)).toMatch(/Gira la pluma/);
    S.slew = 2 * Math.PI + 1 * D; // una vuelta completa cuenta como 1°
    expect(toggleMount(T, S, free)).toMatch(/Plegando/);
    const msgs = assemble(S, C, tw.t + 0.5);
    expect(msgs).toContain('Grúa torre plegada para transporte');
    expect(S.er).toBe(0);
    expect(outriggersLocked(S)).toBeNull();
  });
});

describe('modo torre: carro (Q/E), pluma (W/S) y curva de la torre', () => {
  it('curva de la referencia: 10 t hasta 13,2 m y 1,7 t en la punta', () => {
    const C = baseConfig(T);
    expect(structCap(T, C, 13.2)).toBe(10);
    expect(structCap(T, C, 60)).toBeCloseTo(1.7, 4); // (132 − 46,8·0,641) / 60 = 1,70002
  });

  it('el carro sale con Q/E y la pluma se inclina de 0 a 30°', () => {
    const { S } = mounted();
    for (let i = 0; i < 60 * 60; i++) stepCrane(T, S, { ...idle(), tele: 1, luff: 1 }, DT);
    expect(S.Lb).toBe(T.boom.max);
    expect(S.ang).toBeCloseTo(30 * D, 9);
  });

  it('con 9,7 t el LMI corta el carro cerca de 13,2 m (la capacidad baja a partir de ahí)', () => {
    const { S, C } = mounted();
    const m = 9.7 + T.hookM;
    const lim = () => ({ lmi: (s: CraneState) => lmiStatic(T, C, 'out', s.Lb, s.ang, s.slew, m), L0: lmiStatic(T, C, 'out', S.Lb, S.ang, S.slew, m), noHoistUp: false, tilted: false });
    let cut = false;
    for (let i = 0; i < 60 * 30; i++) cut = stepCrane(T, S, { ...idle(), tele: 1 }, DT, lim()) || cut;
    expect(cut).toBe(true);
    expect(S.Lb).toBeGreaterThan(12.5);
    expect(S.Lb).toBeLessThan(13.5);
    // recoger el carro sigue permitido
    const Lb = S.Lb;
    for (let i = 0; i < 30; i++) stepCrane(T, S, { ...idle(), tele: -1 }, DT, lim());
    expect(S.Lb).toBeLessThan(Lb);
  });
});

describe('física de la grúa torre', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('el gancho sigue a la punta de la torre durante todo el montaje y queda colgando del carro', () => {
    const { S, C } = standing();
    let pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    toggleMount(T, S, free);
    let maxStretch = 0;
    for (let i = 0; i < Math.round((tw.t + 1) / DT); i++) {
      stepAssembly(T, S, C, DT, (s) => P.towerHits(s, pose));
      pose = carrierPose(T, S, 'out');
      P.step(S, pose);
      const h = P.headWorld(), k = P.hookTop();
      maxStretch = Math.max(maxStretch, Math.hypot(k.x - h.x, k.y - h.y, k.z - h.z) - S.cable);
    }
    expect(S.er).toBe(1);
    expect(maxStretch).toBeLessThan(0.1);
    for (let i = 0; i < 60 * 4; i++) P.step(S, pose);
    const tip = apply(pose, tipPos(T, S)), hk = P.hookTop();
    expect(tip.y).toBeGreaterThan(39);
    expect(Math.hypot(hk.x - tip.x, hk.z - tip.z)).toBeLessThan(0.5);
    expect(Math.abs(P.tension - T.hookM)).toBeLessThan(0.05);
  });

  it('el montaje se detiene si la pluma va a tocar un obstáculo, y sigue al quitarlo de en medio (girando)', () => {
    const { S, C } = standing();
    const pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    // una pared alta delante, donde barre la pluma al desplegarse
    P.addObstacle({ label: 'Pared', kind: 'block', half: { x: 0.5, y: 15, z: 3 }, pos: { x: 30, y: 15, z: 0 }, rotY: 0 });
    P.step(S, pose);
    toggleMount(T, S, free);
    const msgs: string[] = [];
    for (let i = 0; i < Math.round((tw.t + 1) / DT); i++) {
      const m = stepAssembly(T, S, C, DT, (s) => P.towerHits(s, pose));
      if (m) msgs.push(m);
    }
    expect(S.er).toBeLessThan(1);
    expect(S.er).toBeGreaterThan(0.7);
    expect(msgs.some((m) => /pluma golpearía/.test(m))).toBe(true);
    expect(P.towerHits(S, pose).n).toBe(0);
  });

  it('montada, el giro se deshace si la pluma golpearía un obstáculo', () => {
    const { S } = mounted();
    const pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    // poste alto a la izquierda, a 30 m del centro de giro, que llega a la altura de la pluma
    P.addObstacle({ label: 'Poste', kind: 'block', half: { x: 0.5, y: 22, z: 0.5 }, pos: { x: T.piv, y: 22, z: -30 }, rotY: 0 });
    P.step(S, pose);
    let hits = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepCrane(T, S, { ...idle(), slew: 1 }, DT, {
        lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, jibHit: (s) => P.towerHits(s, pose).n, onHit: () => { hits++; },
      });
    }
    expect(hits).toBeGreaterThan(0);
    expect(S.slew).toBeLessThan(90 * D);
    expect(S.slew).toBeGreaterThan(45 * D);
  });

  it('plegada, al conducir cuenta la torre que sobresale por delante del camión', () => {
    const S = initialState(T);
    const pose = carrierPose(T, S, 'tire');
    const P = new Physics(T, S, pose);
    // a la altura de la torre tumbada (de 2,6 a 6 m), 3 m por delante del camión: el chasis no lo toca
    P.addObstacle({ label: 'Viga', kind: 'block', half: { x: 0.3, y: 0.5, z: 2 }, pos: { x: T.len[1] + 3, y: 4, z: 0 }, rotY: 0 });
    P.step(S, pose);
    expect(P.carrierBlocked(0, 0, 0)).toMatch(/torre plegada/);
    expect(P.carrierBlocked(-8, 0, 0)).toBeNull();
  });

  it('volcada, la torre cae de lado como un cuerpo y se queda quieta', () => {
    const { S, C } = mounted();
    S.Lb = 50; S.slew = 90 * D;
    const md = 'out';
    let P0 = carrierPose(T, S, md);
    const P = new Physics(T, S, P0);
    // forzar el vuelco con una carga enorme en el carro (tensión ficticia)
    let k = 0;
    while (!stepTilt(S, dynamicStability(T, C, S, md, 25, { x: tipPos(T, S).x, z: tipPos(T, S).z }), FIXED_DT) && k++ < 900) {
      P0 = carrierPose(T, S, md);
      P.step(S, P0);
    }
    expect(S.edge).toBe(2);
    const { p, axis } = edgeAxis(T, md, S.edge);
    P.tipOver(C, S, md, P0, p, axis);
    for (let i = 0; i < 60 * 10; i++) P.step(S, P0);
    const q = P.tippedPose()!.q;
    const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
    expect(up.z).toBeLessThan(-0.5); // cayó hacia −z (izquierda)
    expect(P.headWorld().y).toBeLessThan(8);
    const v = P.tipped!.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.3);
  });
});
