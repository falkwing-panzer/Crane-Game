import { describe, expect, it } from 'vitest';
import { CRANES } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { baseConfig, reach } from '../crane/stability';
import { trackLift } from './control';
import { newRun, type Session, type Unit } from './session';
import { liftHtml } from '../ui/levelUi';

const D = Math.PI / 180;

describe('izaje más exigente (fase 20)', () => {
  it('guarda la carga, la masa y el radio del LMI máximo, el radio máximo y la carga más pesada', () => {
    const T = CRANES.medium, S = initialState(T), C = baseConfig(T);
    const run = newRun();
    let label = 'A', mass = 2, lmi = 0.4;
    const u = { T, S, C, get dyn() { return { lmi }; }, phys: { get attached() { return { label }; } } } as unknown as Unit;
    const ses = { run, loadOnHook: () => mass } as unknown as Session;

    S.Lb = 20; S.ang = 50 * D;
    trackLift(ses, u);
    const R1 = reach(T, C, 20, 50 * D);
    expect(run).toMatchObject({ maxLmi: 0.4, peakLabel: 'A', peakMass: 2, peakCrane: 'AT 60', maxRLabel: 'A', heavy: 2 });
    expect(run.peakR).toBeCloseTo(R1, 9);

    // más lejos con otra carga más liviana pero con más LMI: cambia el pico y el radio máximo, no la más pesada
    label = 'B'; mass = 1.5; lmi = 0.7; S.ang = 30 * D;
    trackLift(ses, u);
    expect(run).toMatchObject({ maxLmi: 0.7, peakLabel: 'B', peakMass: 1.5, maxRLabel: 'B', heavy: 2, heavyLabel: 'A' });
    expect(run.maxR).toBeCloseTo(reach(T, C, 20, 30 * D), 9);

    // otra más pesada, cerca y con menos LMI: solo cambia la más pesada
    label = 'C'; mass = 3; lmi = 0.5; S.ang = 70 * D;
    trackLift(ses, u);
    expect(run).toMatchObject({ maxLmi: 0.7, peakLabel: 'B', maxRLabel: 'B', heavy: 3, heavyLabel: 'C' });

    const html = liftHtml(run, false);
    expect(html).toContain('B · 1,5 t');
    expect(html).toContain('C · 3,0 t');
    expect(liftHtml(newRun(), false)).toBe('');
  });
});
