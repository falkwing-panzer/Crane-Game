import { describe, expect, it } from 'vitest';
import { beepOn, soundTargets, type SoundInput } from './audio';

const idle: SoundInput = { speed: 0, work: 0, hoist: 0, lmi: 0.3, cut: false, prox: false, off: false };

describe('sonido (fase 11)', () => {
  it('motor al ralentí y más fuerte y agudo trabajando o conduciendo', () => {
    const r = soundTargets(idle);
    expect(r.engineGain).toBeGreaterThan(0);
    expect(r.winchGain).toBe(0);
    for (const k of [{ speed: -4 }, { work: 1 }]) {
      const w = soundTargets({ ...idle, ...k });
      expect(w.engineGain).toBeGreaterThan(r.engineGain);
      expect(w.engineHz).toBeGreaterThan(r.engineHz);
    }
  });

  it('cabrestante solo con el cable en marcha', () => {
    expect(soundTargets({ ...idle, hoist: 1 }).winchGain).toBeGreaterThan(0);
  });

  it('alarma del LMI: aviso desde el 90 %, corte desde el 100 % o con corte', () => {
    expect(soundTargets({ ...idle, lmi: 0.89 }).lmi).toBe('none');
    expect(soundTargets({ ...idle, lmi: 0.9 }).lmi).toBe('warn');
    expect(soundTargets({ ...idle, lmi: 1 }).lmi).toBe('cut');
    expect(soundTargets({ ...idle, lmi: 0.5, cut: true }).lmi).toBe('cut');
  });

  it('volcada o en pausa: silencio', () => {
    const r = soundTargets({ ...idle, speed: 3, hoist: 1, lmi: 1.2, prox: true, off: true });
    expect(r).toMatchObject({ engineGain: 0, winchGain: 0, lmi: 'none', prox: false });
  });

  it('pitidos intermitentes', () => {
    expect(beepOn('warn', 0.1)).toBe(true);
    expect(beepOn('warn', 0.5)).toBe(false);
    expect(beepOn('cut', 0.2)).toBe(false);
    expect(beepOn('cut', 0.35)).toBe(true);
  });
});
