import { describe, it, expect } from 'vitest';
import { CRANES, type CraneId } from './cranes';
import { baseConfig, craneMasses, lmiStatic, ratedCap, reach, structCap, KF, type CraneConfig, type SupportMode } from './stability';
import { loadReference } from './reference';

// Compara el port con las funciones originales de referencia/crane-v20.html (tolerancia 1e-6).

const ref = loadReference();
const D = Math.PI / 180;
const TOL = 1e-6;

/** Copia de la grúa de la referencia con el estado de montaje guardado en el objeto, como lo hace la referencia. */
function refCrane(id: CraneId, C: CraneConfig) {
  const T = structuredClone(ref.CRANES[id]);
  T.mCw = C.mCw;
  T.yOn = C.yOn;
  T.jib = C.jib;
  T.jibRel = C.jibRel;
  if (T.superlift) T.superlift.r = C.slR;
  return T;
}

function close(a: number, b: number, what: string) {
  if (!(Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b)))) throw new Error(`${what}: port ${a} ≠ referencia ${b}`);
}

const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1)));
const SLEWS = [0, 0.4, Math.PI / 2, 2.5, Math.PI, -1.2, -Math.PI / 2];

/** Recorre una malla de largo, ángulo, giro y masa y compara todas las funciones. Devuelve nº de puntos. */
function compare(id: CraneId, C: CraneConfig, modes: SupportMode[]) {
  const T = CRANES[id];
  const R = refCrane(id, C);
  const masses = [0, T.hookM, T.structMin * 0.5, T.structMax * 0.3, T.structMax];
  let n = 0;
  for (const Lb of lin(T.boom.min, T.boom.max, T.boom.min === T.boom.max ? 1 : 6)) {
    close(structCap(T, C, Lb), ref.structCap(R, Lb), `${T.name} structCap Lb=${Lb}`);
    for (const ang of lin(T.boom.angMin, T.boom.angMax, 7)) {
      close(reach(T, C, Lb, ang), ref.reach(R, Lb, ang), `${T.name} reach`);
      for (const slew of SLEWS) {
        const a = craneMasses(T, C, Lb, ang, slew), b = ref.craneMasses(R, Lb, ang, slew);
        expect(a.length).toBe(b.length);
        a.forEach((p, i) => p.forEach((v, j) => close(v!, b[i][j], `${T.name} craneMasses[${i}][${j}]`)));
        for (const md of modes) {
          const w = `${T.name} ${md} Lb=${Lb.toFixed(2)} ang=${(ang / D).toFixed(1)}° slew=${slew.toFixed(2)}`;
          for (const m of masses) close(lmiStatic(T, C, md, Lb, ang, slew, m), ref.lmiStatic(R, md, Lb, ang, slew, m), `${w} lmi m=${m}`);
          close(ratedCap(T, C, md, Lb, ang, slew), ref.ratedCap(R, md, Lb, ang, slew), `${w} ratedCap`);
          n++;
        }
      }
    }
  }
  return n;
}

describe('datos de grúas', () => {
  it('CRANES es idéntico al de la referencia', () => {
    expect(Object.keys(CRANES).sort()).toEqual(Object.keys(ref.CRANES).sort());
    expect(JSON.parse(JSON.stringify(CRANES))).toEqual(JSON.parse(JSON.stringify(ref.CRANES)));
  });
  it('factores KF iguales', () => expect(KF).toEqual(ref.KF));
});

describe('estabilidad: port frente a referencia', () => {
  it('AT 60 con estabilizadores y sobre ruedas', () => {
    expect(compare('medium', baseConfig(CRANES.medium), ['out', 'tire', 'move'])).toBeGreaterThan(0);
  });

  it('AT 500-8 sin y con Y-guy, sin y con lastre', () => {
    const T = CRANES.xl;
    for (const yOn of [false, true])
      for (const mCw of [T.cwBase!, T.cwBase! + T.ballast!.m]) compare('xl', { ...baseConfig(T), yOn, mCw }, ['out', 'tire']);
  });

  it('LR 3000 con superlift en varios radios', () => {
    const T = CRANES.lr;
    for (const slR of [T.superlift!.rMin, T.superlift!.r0, 26.5, T.superlift!.rMax])
      compare('lr', { ...baseConfig(T), slR }, ['crawler', 'crawlMove']);
  });

  it('SK 60: curva de capacidad de la torre', () => {
    compare('sk', baseConfig(CRANES.sk), ['out']);
  });

  it('AT 650-8 con plumín montado', () => {
    const T = CRANES.at650;
    for (const jibRel of [0, 30 * D, T.jibDef!.relMax])
      compare('at650', { ...baseConfig(T), mCw: T.cwBase! + T.ballast!.m, yOn: true, jib: T.jibDef!, jibRel }, ['out']);
  });

  it('resto de grúas en su modo principal', () => {
    for (const id of ['small', 'large', 'rt', 'at300', 'at450', 'crawler'] as CraneId[])
      compare(id, baseConfig(CRANES[id]), CRANES[id].crawler ? ['crawler', 'crawlMove'] : ['out', 'tire']);
  });
});

describe('comportamiento físico esperado', () => {
  const T = CRANES.medium, C = baseConfig(T);
  it('la capacidad baja al bajar la pluma y al alargarla', () => {
    expect(ratedCap(T, C, 'out', 20, 30 * D, 0)).toBeLessThan(ratedCap(T, C, 'out', 20, 60 * D, 0));
    expect(ratedCap(T, C, 'out', 40, 45 * D, 0)).toBeLessThan(ratedCap(T, C, 'out', 20, 45 * D, 0));
  });
  it('sobre ruedas la capacidad es menor que con estabilizadores', () => {
    expect(ratedCap(T, C, 'tire', 20, 45 * D, Math.PI / 2)).toBeLessThan(ratedCap(T, C, 'out', 20, 45 * D, Math.PI / 2));
  });
  it('en la capacidad nominal el LMI queda justo por debajo de 100 %', () => {
    const cap = ratedCap(T, C, 'out', 25, 40 * D, 1);
    expect(lmiStatic(T, C, 'out', 25, 40 * D, 1, cap)).toBeLessThan(1);
    expect(lmiStatic(T, C, 'out', 25, 40 * D, 1, cap * 1.001)).toBeGreaterThanOrEqual(1);
  });
  it('sin Y-guy la AT 500-8 con pluma larga pierde capacidad estructural', () => {
    const X = CRANES.xl, c0 = baseConfig(X);
    expect(structCap(X, c0, 50)).toBeLessThan(structCap(X, { ...c0, yOn: true }, 50));
    expect(structCap(X, c0, 20)).toBe(structCap(X, { ...c0, yOn: true }, 20));
  });
});
