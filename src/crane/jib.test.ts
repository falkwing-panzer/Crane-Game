import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES, type WheeledSpec } from './cranes';
import { cableMax, carrierLift, headPos, initialState, jibOn, stepCrane, tipPos, type CraneInput, type CraneState } from './kinematics';
import { baseConfig, lmiStatic, reach, type CraneConfig } from './stability';
import { apply, carrierPose } from './pose';
import { assembling, blockWhileAssembling, jibPhase, JIB_REST_H, outriggersLocked, stepAssembly, toggleMount } from './assembly';
import { Physics } from '../physics/world';
import { jibGeom, jibLattice } from '../render/models/jib';
import { layout } from '../render/models/layout';

// Fase 7: plumín abatible de la AT 650-8 (montaje con M, ángulo con T/G, choques) y contrapeso de dos torres.

const D = Math.PI / 180;
const DT = 1 / 60;
const T = CRANES.at650 as WheeledSpec;
const jd = T.jibDef!;
const idle = (): CraneInput => ({ slew: 0, luff: 0, tele: 0, hoist: 0, fine: false });
const free = { loadAttached: false, groundBlocked: null };

/** De pie sobre estabilizadores, pluma retraída a 5° (lista para montar el plumín) */
function ready() {
  const S = initialState(T), C = baseConfig(T);
  S.out = 1; S.outT = 1; S.ang = 5 * D;
  return { S, C };
}
const assemble = (S: CraneState, C: CraneConfig, s: number) => {
  const msgs: string[] = [];
  for (let i = 0; i < Math.round(s / DT); i++) { const m = stepAssembly(T, S, C, DT); if (m) msgs.push(m); }
  return msgs;
};
function mounted() {
  const { S, C } = ready();
  expect(toggleMount(T, S, free)).toMatch(/Montaje del plumín/);
  assemble(S, C, jd.t + 0.5);
  return { S, C };
}

describe('montaje del plumín (M)', () => {
  it('condiciones de la referencia: estabilizadores, sin carga, pluma retraída y a menos de 10°', () => {
    const S = initialState(T);
    expect(toggleMount(T, S, free)).toMatch(/estabilizadores/);
    S.out = 1;
    expect(toggleMount(T, S, free)).toMatch(/menos de 10°/); // empieza a 40°
    S.ang = 8 * D; S.Lb = T.boom.min + 1;
    expect(toggleMount(T, S, free)).toMatch(/retraída/);
    S.Lb = T.boom.min;
    expect(toggleMount(T, S, { loadAttached: true, groundBlocked: null })).toMatch(/Suelta la carga/);
    expect(toggleMount(T, S, { loadAttached: false, groundBlocked: 'sin sitio' })).toBe('sin sitio');
    expect(S.jgT).toBe(0);
    expect(toggleMount(T, S, free)).toMatch(/Montaje del plumín/);
    expect(S.jgT).toBe(1);
    expect(toggleMount(CRANES.xl, initialState(CRANES.xl), free)).toMatch(/no lleva plumín/);
  });

  it('dura jibDef.t, bloquea los mandos y deja el plumín apoyado con la punta a 0,7 m', () => {
    const { S, C } = ready();
    toggleMount(T, S, free);
    assemble(S, C, jd.t / 2);
    expect(S.jg).toBeCloseTo(0.5, 2);
    expect(jibPhase(S.jg)).toMatch(/bulonando/);
    expect(assembling(S)).toBe('plumín');
    expect(C.jib).toBeNull();
    const inp: CraneInput = { ...idle(), luff: 1, jib: 1 };
    expect(blockWhileAssembling(S, inp)).toMatch(/plumín/);
    expect(inp.luff).toBe(0);
    expect(inp.jib).toBe(0);
    expect(outriggersLocked(S)).toMatch(/plumín/);
    const msgs = assemble(S, C, jd.t / 2 + 0.2);
    expect(msgs.some((m) => /Plumín montado/.test(m))).toBe(true);
    expect(jibOn(T, S)).toBe(true);
    expect(C.jib).toBe(jd);
    expect(C.jibRel).toBe(S.jibRel);
    expect(tipPos(T, S).y + carrierLift(S)).toBeCloseTo(JIB_REST_H, 9);
    expect(S.cable).toBe(3);
    expect(assembling(S)).toBeNull();
  });

  it('la punta es la de reach() de la referencia y el cable llega a la punta + 3 m', () => {
    const { S, C } = mounted();
    for (const [ang, rel] of [[10, 0], [40, 30], [70, 75]]) {
      S.ang = ang * D; S.jibRel = rel * D; C.jibRel = S.jibRel;
      const p = tipPos(T, S), h = headPos(T, S);
      expect(p.x - T.piv).toBeCloseTo(reach(T, C, S.Lb, S.ang), 9);
      expect(Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z)).toBeCloseTo(jd.len, 9);
      expect(cableMax(T, S)).toBeCloseTo(Math.max(70, p.y + 3), 9);
    }
  });

  it('para desmontarlo hay que bajarlo hasta el suelo (G); el cable vuelve a la cabeza', () => {
    const { S, C } = mounted();
    S.jibRel = S.ang; // plumín en línea con la pluma
    expect(toggleMount(T, S, free)).toMatch(/Baja el plumín/);
    S.jibRel = S.ang + 5 * D;
    expect(toggleMount(T, S, free)).toMatch(/Desmontando/);
    assemble(S, C, 0.1);
    expect(jibOn(T, S)).toBe(false);
    expect(C.jib).toBeNull();
    expect(S.cable).toBe(4);
    const msgs = assemble(S, C, jd.t);
    expect(S.jg).toBe(0);
    expect(msgs).toContain('Plumín desmontado');
  });
});

describe('ángulo del plumín (T/G)', () => {
  it('G lo baja y T lo sube a jibDef.spd, entre relMin y relMax', () => {
    const { S } = mounted();
    const r0 = S.jibRel;
    for (let i = 0; i < 120; i++) stepCrane(T, S, { ...idle(), jib: -1 }, DT);
    expect(r0 - S.jibRel).toBeGreaterThan(jd.spd * 1.5); // 2 s con rampa de 0,4 s
    expect(r0 - S.jibRel).toBeLessThan(jd.spd * 2 + 1e-9);
    for (let i = 0; i < 60 * 80; i++) stepCrane(T, S, { ...idle(), jib: -1 }, DT);
    expect(S.jibRel).toBe(jd.relMin);
    for (let i = 0; i < 60 * 80; i++) stepCrane(T, S, { ...idle(), jib: 1 }, DT);
    expect(S.jibRel).toBe(jd.relMax);
  });

  it('el LMI corta bajarlo (más radio) en 100 % pero deja subirlo', () => {
    const { S, C } = mounted();
    C.mCw = T.cwBase! + T.ballast!.m; C.yOn = true;
    S.ang = 60 * D; S.jibRel = 30 * D;
    const lmi = (s: CraneState) => { C.jibRel = s.jibRel; return lmiStatic(T, C, 'out', s.Lb, s.ang, s.slew, m); };
    let m = 1;
    while (lmi(S) < 0.97) m += 0.25;
    let cut = false;
    for (let i = 0; i < 600; i++) cut = stepCrane(T, S, { ...idle(), jib: 1 }, DT, { lmi, L0: lmi(S), noHoistUp: false, tilted: false }) || cut;
    expect(cut).toBe(true);
    expect(lmi(S)).toBeLessThan(1);
    const r = S.jibRel;
    stepCrane(T, S, { ...idle(), jib: -1 }, DT, { lmi, L0: lmi(S), noHoistUp: false, tilted: false });
    expect(S.jibRel).toBeLessThan(r);
  });

  it('con la grúa inclinada solo se puede subir', () => {
    const { S } = mounted();
    const r = S.jibRel;
    for (let i = 0; i < 60; i++) stepCrane(T, S, { ...idle(), jib: 1 }, DT, { lmi: () => 0, L0: 0, noHoistUp: false, tilted: true });
    expect(S.jibRel).toBe(r);
  });
});

describe('dibujo del plumín', () => {
  const L = layout(T);
  it('los tramos aparecen en el suelo, se bulona en la cabeza y montado su punta es tipPos', () => {
    const shown: number[] = [];
    for (let i = 1; i < 9; i++) shown.push(jibGeom(T, L, jd, (i / 9) * 0.45, 5 * D, T.boom.min, 0, -0.3).shown);
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1]);
    expect(shown[0]).toBeGreaterThan(0);
    const g0 = jibGeom(T, L, jd, 0.2, 5 * D, T.boom.min, 0, -0.3);
    expect(g0.angle).toBe(0);
    expect(g0.at[1]).toBeCloseTo(-0.3 + 0.75, 9); // apoyado en el suelo
    const { S } = mounted();
    const g = jibGeom(T, L, jd, 1, S.ang, S.Lb, S.jibRel, -carrierLift(S));
    const tp = tipPos(T, S);
    // marco de la superestructura (slew 0): x desde el centro de giro
    expect(g.tip![0]).toBeCloseTo(tp.x - T.piv, 9);
    expect(g.tip![1]).toBeCloseTo(tp.y, 9);
    expect(g.struts.length).toBe(4);
    expect(g.ties.length).toBe(3);
    // los puntales quedan por encima del plumín
    for (const s of g.struts) expect(s.b[1]).toBeGreaterThan(g.at[1] + Math.sin(g.angle) * 9);
  });

  it('la celosía va de 1,5 a 0,9 m y llega a la punta', () => {
    const lat = jibLattice(jd.len);
    expect(Math.max(...lat.chords.map((c) => c.b[0]))).toBeCloseTo(jd.len, 9);
    expect(Math.abs(lat.chords[0].a[1]) * 2).toBeCloseTo(1.5, 9);
    expect(Math.abs(lat.chords[lat.chords.length - 1].b[1]) * 2).toBeCloseTo(0.9, 9);
    expect(lat.ends[lat.ends.length - 1]).toBeCloseTo(jd.len, 9);
  });
});

describe('física: cable en la punta del plumín y choques', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('al montarlo el cable pasa a la punta y el gancho queda en el suelo junto a ella', () => {
    const { S, C } = ready();
    let pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    P.step(S, pose);
    toggleMount(T, S, free);
    assemble(S, C, jd.t + 0.5);
    pose = carrierPose(T, S, 'out');
    for (let i = 0; i < 60; i++) P.step(S, pose);
    const tip = apply(pose, tipPos(T, S)), h = P.headWorld();
    expect(Math.hypot(h.x - tip.x, h.y - tip.y, h.z - tip.z)).toBeLessThan(1e-6);
    const hk = P.hookBody.translation();
    expect(hk.y).toBeLessThan(0.7); // apoyado
    expect(Math.hypot(hk.x - tip.x, hk.z - tip.z)).toBeLessThan(2);
    expect(P.tension).toBeLessThan(0.5); // cable flojo
    // al subir la pluma, el gancho cuelga de la punta
    for (let i = 0; i < 60 * 12; i++) { stepCrane(T, S, { ...idle(), luff: 1 }, DT); pose = carrierPose(T, S, 'out'); P.step(S, pose); }
    for (let i = 0; i < 60 * 3; i++) P.step(S, pose);
    const t2 = P.headWorld(), hk2 = P.hookBody.translation();
    // 0,6 m (0,5 hasta la fase 10: el giro del gancho, ahora bloqueado, se comía algo del balanceo)
    expect(Math.hypot(hk2.x - t2.x, hk2.z - t2.z)).toBeLessThan(0.6);
    expect(Math.abs(P.tension - T.hookM)).toBeLessThan(0.3); // todavía balancea un poco tras despegar del suelo
  });

  it('no se puede armar el plumín si hay un obstáculo en el suelo delante de la cabeza', () => {
    const { S } = ready();
    const pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    P.step(S, pose);
    expect(P.jibGroundBlocked(S, pose)).toBeNull();
    P.addObstacle({ label: 'Bloque', kind: 'block', half: { x: 0.6, y: 0.6, z: 1.2 }, pos: { x: 30, y: 0.6, z: 0 }, rotY: 0 });
    P.step(S, pose);
    expect(P.jibGroundBlocked(S, pose)).toMatch(/obstáculo/);
    S.slew = 90 * D; // a la izquierda está libre
    expect(P.jibGroundBlocked(S, pose)).toBeNull();
  });

  it('el plumín no baja del suelo ni atraviesa un obstáculo: se deshace el paso', () => {
    const { S, C } = mounted();
    let pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    P.step(S, pose);
    let hits = 0;
    const lim = () => ({ lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, jibHit: (s: CraneState) => P.jibHits(s, pose).n, onHit: () => { hits++; } });
    // bajar el plumín apoyado: tocaría el suelo
    for (let i = 0; i < 120; i++) stepCrane(T, S, { ...idle(), jib: 1 }, DT, lim());
    expect(hits).toBeGreaterThan(0);
    expect(apply(pose, tipPos(T, S)).y).toBeGreaterThan(0.45);
    expect(P.jibHits(S, pose).what).toBe('');
    // subir la pluma a 25° y poner un bloque bajo la mitad del plumín, 0,4 m por debajo de la caja de choques
    for (let i = 0; i < 60 * 20 && S.ang < 25 * D; i++) stepCrane(T, S, { ...idle(), luff: 1 }, DT, lim());
    S.v.ang = 0;
    pose = carrierPose(T, S, 'out');
    const a = apply(pose, headPos(T, S)), b = apply(pose, tipPos(T, S));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const top = mid.y - 0.75 - 0.4;
    P.addObstacle({ label: 'Torre', kind: 'block', half: { x: 1, y: top / 2, z: 1 }, pos: { x: mid.x, y: top / 2, z: mid.z }, rotY: 0 });
    P.step(S, pose);
    expect(P.jibHits(S, pose).n).toBe(0);
    hits = 0;
    for (let i = 0; i < 60 * 5; i++) stepCrane(T, S, { ...idle(), luff: -1 }, DT, lim());
    expect(hits).toBeGreaterThan(0);
    expect(P.jibHits(S, pose).what).toBe('');
    // subirla sigue permitido
    const ang = S.ang;
    for (let i = 0; i < 30; i++) stepCrane(T, S, { ...idle(), luff: 1 }, DT, lim());
    expect(S.ang).toBeGreaterThan(ang);
    expect(C.jib).toBe(jd);
  });
});

describe('contrapeso de dos torres: choques al girar', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('con el lastre montado, el giro se detiene antes de que una torre toque un obstáculo', () => {
    const S = initialState(T);
    S.out = 1; S.cw = 1; S.cwT = 1;
    const pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    const b = P.towerBox(1)!;
    expect(b).not.toBeNull();
    // obstáculo donde estaría la torre derecha con la superestructura girada 90° a la izquierda
    const px = T.piv + b.cz, pz = -b.cx;
    P.addObstacle({ label: 'Pilar', kind: 'block', half: { x: 0.5, y: 3, z: 0.5 }, pos: { x: px, y: 3, z: pz }, rotY: 0 });
    P.step(S, pose);
    expect(P.tailBlocked(S, 0, 1)).toBeNull();
    expect(P.tailBlocked(S, 90 * D, 1)).toMatch(/contrapeso/);
    for (let i = 0; i < 60 * 80; i++) {
      stepCrane(T, S, { ...idle(), slew: 1 }, DT, {
        lmi: () => 0, L0: 0, noHoistUp: false, tilted: false, slewBlocked: (s) => !!P.tailBlocked(s, s.slew, s.cw),
      });
    }
    expect(S.slew).toBeGreaterThan(30 * D);
    expect(S.slew).toBeLessThan(90 * D);
    expect(P.tailBlocked(S, S.slew, 1)).toBeNull();
  });

  it('las torres son colisionadores de la superestructura que crecen con el montaje', () => {
    const S = initialState(T);
    S.out = 1;
    const pose = carrierPose(T, S, 'out');
    const P = new Physics(T, S, pose);
    const h0 = P.towerBox(0)!, h1 = P.towerBox(1)!;
    expect(h1.hy).toBeGreaterThan(h0.hy + 2); // la torre crece 4,4 m
    expect(h1.cz).toBeGreaterThan(0.3 + h1.hz); // hueco central
    expect(P.towerBox(0.5)!.hy).toBeGreaterThan(h0.hy);
  });
});
