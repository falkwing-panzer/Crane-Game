import { describe, expect, it } from 'vitest';
import { Loop } from './loop';
import { pauseText } from '../ui/autoPause';

const DT = 1 / 60;

function make() {
  const r = { ticks: 0, draws: 0 };
  const loop = new Loop(() => { r.ticks++; }, () => { r.draws++; }, DT, 4);
  return { loop, r };
}

describe('bucle de paso fijo', () => {
  it('un paso por cuadro a 60 Hz, dos a 30 Hz, y como mucho 4 sin acumular', () => {
    const { loop, r } = make();
    loop.frame(0); // primer cuadro: sin tiempo previo
    expect(r.ticks).toBe(0);
    let t = 0;
    for (let i = 0; i < 60; i++) loop.frame((t += 1000 / 60) + 0.01);
    expect(r.ticks).toBeGreaterThanOrEqual(59);
    expect(r.ticks).toBeLessThanOrEqual(60);
    r.ticks = 0;
    for (let i = 0; i < 30; i++) loop.frame((t += 1000 / 30));
    expect(Math.abs(r.ticks - 60)).toBeLessThanOrEqual(1);
    // un cuadro largo: 4 pasos y el resto se tira
    expect(loop.frame((t += 2000))).toBe(4);
    expect(loop.frame((t += 1000 / 60) + 0.01)).toBeLessThanOrEqual(1);
    expect(r.draws).toBe(1 + 60 + 30 + 2);
  });

  it('en pausa no da pasos pero dibuja; al volver, no hay pasos acumulados', () => {
    const { loop, r } = make();
    const seen: string[][] = [];
    loop.onPause = (w) => seen.push(w);
    let t = 0;
    loop.frame(t);
    loop.pause('foco', true);
    loop.pause('foco', true); // repetido: no cambia nada
    for (let i = 0; i < 120; i++) loop.frame((t += 1000 / 60));
    expect(r.ticks).toBe(0);
    expect(r.draws).toBe(121);
    loop.pause('pestaña', true);
    loop.pause('foco', false);
    expect(loop.paused).toBe(true);
    t += 30_000; // 30 s con la pestaña oculta (sin cuadros)
    loop.pause('pestaña', false);
    expect(loop.paused).toBe(false);
    expect(loop.frame(t)).toBe(0); // el primer cuadro al volver no recupera el tiempo perdido
    expect(loop.frame((t += 1000 / 60) + 0.01)).toBe(1);
    expect(seen).toEqual([['foco'], ['foco', 'pestaña'], ['pestaña'], []]);
  });

  it('textos de la pausa: la gráfica manda', () => {
    expect(pauseText([])).toBe('');
    expect(pauseText(['foco'])).toMatch(/clic/);
    expect(pauseText(['foco', 'pestaña'])).toMatch(/pestaña/);
    expect(pauseText(['foco', 'gráfica'])).toMatch(/gráfica/);
  });
});
