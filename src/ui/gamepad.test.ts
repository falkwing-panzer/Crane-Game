import { describe, expect, it } from 'vitest';
import { dz, PAD, padAxes, padEdges, pressedList } from './gamepad';

const btns = (on: Record<number, number> = {}) => Array.from({ length: 17 }, (_, i) => ({ pressed: (on[i] ?? 0) > 0.5, value: on[i] ?? 0 }));

describe('mando (fase 11)', () => {
  it('zona muerta reescalada', () => {
    expect(dz(0.1)).toBe(0);
    expect(dz(-0.14)).toBe(0);
    expect(dz(1)).toBe(1);
    expect(dz(-1)).toBe(-1);
    expect(dz(0.575)).toBeCloseTo(0.5);
  });

  it('sticks con los signos de las teclas', () => {
    // stick izquierdo arriba e izquierda: adelante y a la izquierda; derecho a la izquierda y arriba: A y W
    const a = padAxes([-1, -1, -1, -1], btns());
    expect(a).toMatchObject({ throttle: 1, steer: 1, slew: 1, luff: 1, tele: 0, hoist: 0 });
    const b = padAxes([0.05, 0.05, 1, 1], btns());
    expect(b).toMatchObject({ throttle: 0, steer: 0, slew: -1, luff: -1 });
  });

  it('gatillos: RT baja el cable (F), LT lo sube (R), proporcional', () => {
    expect(padAxes([0, 0, 0, 0], btns({ [PAD.RT]: 1 })).hoist).toBe(1);
    expect(padAxes([0, 0, 0, 0], btns({ [PAD.LT]: 1 })).hoist).toBe(-1);
    expect(padAxes([0, 0, 0, 0], btns({ [PAD.RT]: 0.575 })).hoist).toBeCloseTo(0.5);
  });

  it('botones de telescopio, plumín, superlift y fino', () => {
    const a = padAxes([], btns({ [PAD.RB]: 1, [PAD.DOWN]: 1, [PAD.RIGHT]: 1, [PAD.L3]: 1 }));
    expect(a).toMatchObject({ tele: 1, jib: 1, sl: 1, fine: true });
    const b = padAxes([], btns({ [PAD.LB]: 1, [PAD.UP]: 1, [PAD.LEFT]: 1 }));
    expect(b).toMatchObject({ tele: -1, jib: -1, sl: -1, fine: false });
  });

  it('acciones de un toque solo al pulsar (flanco)', () => {
    const down = btns({ [PAD.A]: 1, [PAD.Y]: 1 });
    expect(padEdges([], down)).toEqual(['hook', 'view']);
    expect(padEdges(pressedList(down), down)).toEqual([]);
    expect(padEdges(pressedList(down), btns({ [PAD.B]: 1, [PAD.R3]: 1 }))).toEqual(['outriggers', 'switch']);
  });
});
