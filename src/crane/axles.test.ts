import { expect, it } from 'vitest';
import { CRANES } from './cranes';
import { baseConfig } from './stability';
import { axleLoad } from './axles';
it('carga por eje (fase 24): masa con la pluma recogida entre los ejes; orugas sin ejes', () => {
  for (const id of ['small', 'medium', 'large', 'at300', 'xl'] as const) {
    const T = CRANES[id], q = axleLoad(T, baseConfig(T))!;
    console.log('EJE', id, q.toFixed(2));
    expect(q).toBeGreaterThan(5);
  }
  expect(axleLoad(CRANES.lr, baseConfig(CRANES.lr))).toBeNull();
});
