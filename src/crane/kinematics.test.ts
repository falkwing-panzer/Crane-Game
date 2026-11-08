import { describe, it, expect } from 'vitest';
import { AT60 } from './cranes';
import { headPos, headReach, stepCrane, initialState } from './kinematics';

describe('cinemática de pluma AT 60', () => {
  it('pluma horizontal y retraída: alcance = pie + largo', () => {
    expect(headReach(AT60, { ang: 0, Lb: 11 })).toBeCloseTo(-2.1 + 11);
    const p = headPos(AT60, { slew: 0, ang: 0, Lb: 11 });
    expect(p.x).toBeCloseTo(-1.8 - 2.1 + 11);
    expect(p.y).toBeCloseTo(2.75);
    expect(p.z).toBeCloseTo(0);
  });
  it('giro de 90° a la izquierda lleva la cabeza a -z', () => {
    const p = headPos(AT60, { slew: Math.PI / 2, ang: 0, Lb: 11 });
    expect(p.x).toBeCloseTo(-1.8);
    expect(p.z).toBeCloseTo(-8.9);
  });
  it('respeta los límites de pluma de la referencia', () => {
    const S = initialState(AT60);
    for (let i = 0; i < 6000; i++) stepCrane(AT60, S, { slew: 0, luff: 1, tele: 1, hoist: 0, fine: false }, 1 / 60);
    expect(S.ang).toBeCloseTo(80 * Math.PI / 180);
    expect(S.Lb).toBeCloseTo(42);
  });
});
