import { describe, expect, it } from 'vitest';
import { CRANES } from '../crane/cranes';
import { tipPos, type CraneState } from '../crane/kinematics';
import { apply, carrierPose } from '../crane/pose';
import { supportMode } from '../crane/ops';
import { baseConfig, lmiStatic } from '../crane/stability';
import { ALL_LEVELS } from '../levels/tandemSetup';
import { EXAMS, lessonByN } from '../school/lessons';
import { earned, grant, levelOpen } from './licenses';
import { sessionDef } from './session';
import { t } from '../i18n';
import { initialState } from '../crane/kinematics';
import { placeCrane } from '../levels/setup';

describe('licencias (fase 22)', () => {
  it('sin licencias todo cerrado; con la de ruedas, del 1 al 11 (el 7 por la RT 90); torre el 12, orugas el 13, tándem el 14', () => {
    const open = (lic: object) => ALL_LEVELS.map((L) => levelOpen(L, lic, false));
    expect(open({}).every((o) => !o)).toBe(true);
    expect(open({ ruedas: 1 })).toEqual([...Array(11).fill(true), false, false, false]);
    expect(open({ torre: 1 })[11]).toBe(true);
    expect(open({ orugas: 1 })[12]).toBe(true);
    expect(open({ orugas: 1 })[6]).toBe(true); // el 7 también con la LR 300
    expect(open({ tandem: 1 })[13]).toBe(true);
    expect(ALL_LEVELS.every((L) => levelOpen(L, {}, true))).toBe(true);
  });

  it('quien ya tenía récords conserva lo que jugó; la escuela da ruedas; tándem con ruedas, orugas y el nivel 13', () => {
    expect(Object.keys(earned({ 0: {} }, []))).toEqual(['ruedas']);
    expect(Object.keys(earned({ 11: {} }, []))).toEqual(['torre']);
    expect(Object.keys(earned({ 13: {} }, []))).toEqual(['tandem']);
    expect(Object.keys(earned({}, [1, 2, 3, 4, 5, 6]))).toEqual(['ruedas']);
    expect(earned({}, [1, 2, 3, 4, 5])).toEqual({});
    const lic = {};
    expect(grant(lic, 'orugas', {}, [])).toEqual(['orugas']);
    expect(grant(lic, 'ruedas', { 12: {} }, [])).toEqual(expect.arrayContaining(['ruedas', 'tandem']));
    expect(grant(lic, 'ruedas', {}, [])).toEqual([]);
  });

  it('exámenes: ?escuela=7…9 con su grúa; textos con tantos pasos como el examen', () => {
    expect(EXAMS.map((e) => [e.n, e.crane, e.license])).toEqual([[7, 'medium', 'ruedas'], [8, 'crawler', 'orugas'], [9, 'sk', 'torre']]);
    for (const e of EXAMS) {
      expect(sessionDef(`?escuela=${e.n}`).ids).toEqual([e.crane]);
      expect(t.school.lessons[e.n - 1].steps).toHaveLength(e.steps.length);
      expect(lessonByN(e.n)).toBe(e);
    }
  });

  it('cada examen: la carga queda bajo la cabeza (con la grúa lista) y el LMI con ella, lejos del corte en la recogida y en la zona', () => {
    for (const e of EXAMS) {
      const T = CRANES[e.crane!], S = initialState(T) as CraneState, C = baseConfig(T);
      placeCrane(T, S, e.site);
      e.setup(T, S, C);
      if (!T.crawler) S.out = S.outT = 1;
      if (T.tower) { S.er = S.erT = 1; S.Lb = 20; }
      const c = e.site.crates[0], z = e.site.zones[0];
      const at = (slew: number) => { const s = { ...S, slew }; return apply(carrierPose(T, s, supportMode(s, T)), tipPos(T, s)); };
      const D = Math.PI / 180;
      const slews = { medium: [90, -90], crawler: [0, 120], sk: [90, -90] }[e.crane as 'medium' | 'crawler' | 'sk'];
      const p = at(slews[0] * D), q = at(slews[1] * D);
      expect(Math.hypot(p.x - c.x, p.z - c.z), e.crane).toBeLessThan(0.05);
      expect(Math.hypot(q.x - z.x, q.z - z.z), e.crane).toBeLessThan(0.05);
      for (const sl of slews) {
        const lmi = lmiStatic(T, C, supportMode(S, T), S.Lb, S.ang, sl * D, c.m + T.hookM);
        expect(lmi, `${e.crane} ${sl}°`).toBeLessThan(0.85);
      }
    }
  });
});
