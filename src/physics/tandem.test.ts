import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRANES } from '../crane/cranes';
import { initialState, tipPos, type CraneState } from '../crane/kinematics';
import { supportMode } from '../crane/ops';
import { apply, carrierPose, type Pose } from '../crane/pose';
import { FIXED_DT, HOOK_HALF_H, Physics, TWO_BLOCK } from './world';
import { slingTensions } from './tandem';

const G = 9.81;
const up = { x: 0, y: 1, z: 0 };

describe('reparto entre eslingas (solucionador)', () => {
  const still = { a: { x: 0, y: 0, z: 0 }, tau: { x: 0, y: 0, z: 0 }, contacts: [], size: 6 };

  it('viga quieta con eslingas verticales: reparto por palanca', () => {
    const T = slingTensions({ m: 20, c: { x: 0, y: 0, z: 0 }, ...still },
      [{ p: { x: 5.5, y: 0.4, z: 0 }, u: up, slack: false }, { p: { x: -3.5, y: 0.4, z: 0 }, u: up, slack: false }]);
    expect(T[0] / G).toBeCloseTo(20 * 3.5 / 9, 4);
    expect(T[1] / G).toBeCloseTo(20 * 5.5 / 9, 4);
  });

  it('eslinga floja: la otra lo lleva todo', () => {
    const T = slingTensions({ m: 20, c: { x: 0, y: 0, z: 0 }, ...still },
      [{ p: { x: 0, y: 0.4, z: 0 }, u: up, slack: false }, { p: { x: -3.5, y: 0.4, z: 0 }, u: up, slack: true }]);
    expect(T[0] / G).toBeCloseTo(20, 4);
    expect(T[1]).toBe(0);
  });

  it('eslingas inclinadas: la componente horizontal se compensa', () => {
    const k = Math.SQRT1_2;
    const T = slingTensions({ m: 10, c: { x: 0, y: 0, z: 0 }, ...still },
      [{ p: { x: 2, y: 0, z: 0 }, u: { x: k, y: k, z: 0 }, slack: false }, { p: { x: -2, y: 0, z: 0 }, u: { x: -k, y: k, z: 0 }, slack: false }]);
    expect(T[0] / G).toBeCloseTo(10 / 2 / k, 4);
    expect(T[1] / G).toBeCloseTo(10 / 2 / k, 4);
  });

  it('un extremo apoyado en el suelo: el apoyo lleva su parte', () => {
    // viga de 12 m con el pie apoyado en x = −6 y la eslinga en x = 5,5: la grúa lleva 20·6/11,5
    const m = 20, fc = m * G * 5.5 / 11.5;
    const T = slingTensions({ m, c: { x: 0, y: 0, z: 0 }, a: still.a, tau: still.tau, size: 6,
      contacts: [{ p: { x: -6, y: -0.4, z: 0 }, f: { x: 0, y: fc, z: 0 } }] },
    [{ p: { x: 5.5, y: 0.4, z: 0 }, u: up, slack: false }]);
    expect(T[0] / G).toBeCloseTo(m * 6 / 11.5, 4);
  });

  it('una eslinga no empuja: tensión nunca negativa', () => {
    // las dos orejetas del mismo lado del centro: la de dentro quedaría negativa
    const T = slingTensions({ m: 20, c: { x: 0, y: 0, z: 0 }, ...still },
      [{ p: { x: 1, y: 0, z: 0 }, u: up, slack: false }, { p: { x: 4, y: 0, z: 0 }, u: up, slack: false }]);
    expect(Math.min(...T)).toBeGreaterThanOrEqual(0);
  });
});

/** Orejetas de la viga de prueba (24 m, centro en x = 0): A lleva 20·6/15 = 8 t y B 20·9/15 = 12 t */
const LUG_A = 9, LUG_B = -6, HALF = 12;

/**
 * Dos AT 60 en paralelo, con la pluma girada 90° hacia −z y una viga de 20 t y 24 m a lo largo de x: A con la
 * cabeza sobre la orejeta 0 (x = +9) y B sobre la orejeta 1 (x = −6). Mismo mundo de Rapier.
 */
function tandemWorld() {
  const T = CRANES.medium;
  const mk = () => {
    const S = initialState(T);
    S.slew = Math.PI / 2;
    S.ang = 50 * Math.PI / 180;
    return S;
  };
  const SA = mk(), SB = mk();
  const head = (S: CraneState) => apply(carrierPose(T, S, supportMode(S, T)), tipPos(T, S));
  const lugY = 0.4 + 0.4; // centro de la viga a 0,4 m, orejeta en la cara de arriba
  // colocar cada grúa para que su cabeza quede sobre su orejeta (la viga va en z = 0)
  const hA = head(SA); SA.x = LUG_A - hA.x; SA.z = -hA.z;
  const hB = head(SB); SB.x = LUG_B - hB.x; SB.z = -hB.z;
  for (const S of [SA, SB]) S.cable = head(S).y - lugY - 0.3 - 2 * HOOK_HALF_H;
  const pA: Pose = carrierPose(T, SA, supportMode(SA, T)), pB: Pose = carrierPose(T, SB, supportMode(SB, T));
  const A = new Physics(T, SA, pA, { testLoad: false });
  const B = new Physics(T, SB, pB, { site: A });
  const beam = A.addLoad('Viga', 20, { x: HALF, y: 0.4, z: 0.4 }, { x: 0, y: 0.4, z: 0 },
    { lugs: [{ x: LUG_A, y: 0.4, z: 0 }, { x: LUG_B, y: 0.4, z: 0 }] });
  const units = [{ phys: A, S: SA, pose: pA }, { phys: B, S: SB, pose: pB }];
  const step = (s: number, hoist: [number, number] = [0, 0], luffA = 0) => {
    for (let i = 0; i < Math.round(s / FIXED_DT); i++) {
      SA.cable = Math.max(1, SA.cable + hoist[0] * FIXED_DT);
      SB.cable = Math.max(1, SB.cable + hoist[1] * FIXED_DT);
      SA.ang += luffA * FIXED_DT;
      units[0].pose = carrierPose(T, SA, supportMode(SA, T));
      Physics.stepCrew(units);
    }
  };
  return { T, A, B, SA, SB, beam, step };
}

describe('tándem en Rapier', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('las dos grúas comparten el mundo y se ven como obstáculo', () => {
    const { A, B, SA, SB, beam, step } = tandemWorld();
    step(0.1); // las consultas ven los cuerpos después de un paso
    expect(B.world).toBe(A.world);
    expect(B.loads).toContain(beam);
    expect(A.crew).toEqual([A, B]);
    // el chasis de A, llevado a donde está B, chocaría con B
    expect(A.carrierBlocked(SB.x, SB.z, SB.h)).toBeTruthy();
    expect(A.carrierBlocked(SA.x, SA.z, SA.h)).toBeNull();
  });

  it('cada grúa engancha su orejeta y lleva su parte por palanca', () => {
    const { T, A, B, beam, step } = tandemWorld();
    step(1);
    expect(A.toggleHook()).toContain('por la cabeza');
    expect(B.toggleHook()).toContain('por el pie');
    expect(A.attachedLug).toBe(0);
    expect(B.attachedLug).toBe(1);
    // izar las dos a la vez hasta despegar ~1 m, y esperar quietas
    step(3.5, [-0.3, -0.3]);
    step(4);
    expect(beam.body.translation().y).toBeGreaterThan(1.0);
    const sa = A.slingShare()!, sb = B.slingShare()!;
    expect(sa + sb).toBeCloseTo(20, 0);
    expect(sa).toBeCloseTo(20 * -LUG_B / (LUG_A - LUG_B), 0);
    expect(sb).toBeCloseTo(20 * LUG_A / (LUG_A - LUG_B), 0);
    // la tensión del cable = gancho + su parte
    expect(A.tension).toBeCloseTo(sa + T.hookM, 0);
    expect(B.tension).toBeCloseTo(sb + T.hookM, 0);
    // la carga sigue colgada de las dos: no está "colocada"
    expect(A.placed(beam)).toBeNull();
  });

  it('con el pie apoyado en el suelo, el apoyo lleva su parte', () => {
    const { A, beam, step } = tandemWorld();
    step(1);
    A.toggleHook();
    // A levanta su extremo ~1,5 m; el otro extremo queda en el suelo (B no está enganchada)
    step(5, [-0.3, 0]);
    step(3);
    const t = beam.body.translation();
    expect(t.y).toBeGreaterThan(0.6);
    // pivota sobre la arista del pie (x ≈ −12): la grúa lleva cerca de 20·12/21 = 11,4 t
    expect(A.slingShare()!).toBeGreaterThan(20 * HALF / (HALF + LUG_A) - 1.2);
    expect(A.slingShare()!).toBeLessThan(20 * HALF / (HALF + LUG_A) + 1.2);
  });

  it('una grúa suelta con la viga colgada si la otra la sostiene; sola lleva todo', () => {
    const { A, B, beam, step } = tandemWorld();
    step(1);
    A.toggleHook(); B.toggleHook();
    step(3.5, [-0.3, -0.3]);
    step(2);
    expect(B.toggleHook()).toContain('la sostiene la otra grúa');
    expect(B.attached).toBeNull();
    step(6);
    // la viga cuelga de A (un extremo baja hasta el suelo o queda colgada inclinada)
    expect(A.attached).toBe(beam);
    expect(A.slingShare()!).toBeLessThanOrEqual(20.5);
    expect(A.slingShare()!).toBeGreaterThan(9);
    // ahora A no puede soltar sin apoyar del todo (nadie más la sostiene) salvo que esté apoyada
    const msg = A.toggleHook();
    expect(msg === 'Apoya la carga antes de soltarla' || msg.includes('soltada')).toBe(true);
  });

  it('una orejeta lleva una sola grúa; una carga sin orejetas, también', () => {
    const { A, B, step } = tandemWorld();
    step(1);
    A.toggleHook();
    // B intenta enganchar donde ya está A: su gancho está lejos de la orejeta 0, y la 0 está ocupada
    expect(B.toggleHook()).toContain('por el pie');
    expect(B.attachedLug).not.toBe(A.attachedLug);
  });

  it('el gancho no atraviesa la cabeza: doble bloqueo', () => {
    // la carga de la grúa de cola, subida por la principal, tiraba del gancho hacia arriba a través de la pluma
    const { B, SB, step } = tandemWorld();
    SB.cable = 3;
    let minD = Infinity, maxRise = -Infinity, blocked = false;
    for (let i = 0; i < 180; i++) {
      B.hookBody.setLinvel({ x: 0, y: 6, z: 0 }, true); // un tirón hacia arriba en cada paso
      step(FIXED_DT);
      const h = B.headWorld(), t = B.hookTop();
      minD = Math.min(minD, Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z));
      maxRise = Math.max(maxRise, t.y - h.y);
      blocked ||= B.twoBlocked();
    }
    // con un tirón de 6 m/s cada paso entra algo (la junta corrige de a poco), pero nunca pasa la cabeza
    expect(minD).toBeGreaterThan(0.1);
    expect(maxRise).toBeLessThan(0);
    expect(blocked).toBe(true);
    step(1);
    const h = B.headWorld(), t = B.hookTop();
    expect(Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z)).toBeGreaterThan(TWO_BLOCK - 0.05);
    expect(B.hookTop().y).toBeLessThan(B.headWorld().y);
  });

  it('bajar la pluma de una sola grúa lleva su extremo de costado: la carga gira sobre la vertical', () => {
    const { A, B, beam, step } = tandemWorld();
    step(1);
    A.toggleHook(); B.toggleHook();
    step(3.5, [-0.3, -0.3]);
    step(2);
    const a0 = A.lugWorld(beam, 0), b0 = B.lugWorld(beam, 1);
    // A baja la pluma 0,3 rad (de 50° a 33°: la cabeza se aleja unos 2 m, hacia −z); B se queda quieta
    // (iza a la vez: al bajar la pluma la cabeza baja 2,5 m y la viga apoyaría en el suelo)
    step(6, [-0.45, 0], -0.05);
    step(3);
    const a1 = A.lugWorld(beam, 0), b1 = B.lugWorld(beam, 1);
    expect(a0.z - a1.z, 'el extremo de A se va de costado').toBeGreaterThan(1);
    expect(Math.abs(b0.z - b1.z), 'el de B, mucho menos').toBeLessThan(0.3 * (a0.z - a1.z));
    // la viga ya no apunta a lo largo de x (sin el giro libre sobre la vertical no podía)
    const yaw = Math.atan2(a1.z - b1.z, a1.x - b1.x);
    expect(Math.abs(yaw) * 180 / Math.PI).toBeGreaterThan(4);
    // sigue colgada de las dos y el reparto suma la viga
    expect(A.slingShare()! + B.slingShare()!).toBeCloseTo(20, 0);
  });
});
