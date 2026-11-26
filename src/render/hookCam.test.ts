import { describe, expect, it } from 'vitest';
import { HOOK_CAM_DROP, hookCamPose } from './camera';
import { cabLines } from './cabScreen';
import { lmiCls } from '../ui/hud';
import { Rumble } from '../ui/rumble';

describe('cámara del gancho (fase 21)', () => {
  it('cuelga bajo la cabeza, mira hacia abajo y arriba de la imagen es hacia donde apunta la pluma', () => {
    const p = hookCamPose({ head: { x: 10, y: 30, z: 4 }, piv: { x: 0, y: 0, z: 4 } });
    expect(p.pos).toEqual({ x: 10, y: 30 - HOOK_CAM_DROP, z: 4 });
    const d = { x: p.at.x - p.pos.x, y: p.at.y - p.pos.y, z: p.at.z - p.pos.z };
    expect(d.y / Math.hypot(d.x, d.y, d.z)).toBeLessThan(-0.999);
    expect(p.up).toEqual({ x: 1, y: 0, z: 0 });
    // cabeza justo sobre el eje (grúa torre con el carro en el eje): no queda indefinida
    const q = hookCamPose({ head: { x: 0, y: 40, z: 0 }, piv: { x: 0, y: 0, z: 0 } });
    expect(Math.hypot(q.up.x, q.up.z)).toBeCloseTo(1, 9);
  });
});

describe('pantalla de la cabina y estado del LMI (fase 21)', () => {
  const d = { name: 'AT 60', radius: 12.34, load: 4.5, rated: 9.81, lmi: 0.6, Lb: 20, angDeg: 45, tower: false, cut: false, expert: false };
  it('muestra radio, carga, capacidad, pluma y ángulo; en experto, sin capacidad', () => {
    expect(cabLines(d)).toEqual([['Radio', '12,3 m'], ['Carga', '4,5 t'], ['Capacidad', '9,8 t'], ['Pluma', '20,0 m'], ['Ángulo', '45,0°']]);
    expect(cabLines({ ...d, expert: true, load: null }).map((r) => r[0])).toEqual(['Radio', 'Carga', 'Pluma', 'Ángulo']);
    expect(cabLines({ ...d, load: null })[1][1]).toBe('libre');
    expect(cabLines({ ...d, tower: true })[3][0]).toBe('Carro');
  });
  it('el estado del LMI tiene tres niveles (forma y texto además del color)', () => {
    expect([0.5, 0.9, 0.99, 1, 1.3].map(lmiCls)).toEqual(['ok', 'warn', 'warn', 'bad', 'bad']);
  });
});

describe('vibración del mando (fase 21)', () => {
  it('nada por debajo del 90 %; suave y creciente desde ahí; con sobrecarga también el motor fuerte', () => {
    const r = new Rumble();
    expect(r.frame(0.016, { lmi: 0.85, prox: false, off: false })).toBeNull();
    const a = r.frame(0.016, { lmi: 0.92, prox: false, off: false })!;
    expect(a.strong).toBe(0);
    expect(a.weak).toBeGreaterThan(0.15);
    // no se repite hasta que pase el intervalo
    expect(r.frame(0.016, { lmi: 0.92, prox: false, off: false })).toBeNull();
    const b = new Rumble().frame(0.016, { lmi: 1.05, prox: false, off: false })!;
    expect(b.weak).toBeGreaterThan(a.weak);
    expect(b.strong).toBeGreaterThan(0);
    expect(new Rumble().frame(0.016, { lmi: 1.2, prox: false, off: true })).toBeNull();
  });
  it('pulsos de la línea cada medio segundo; golpes fuertes, aterrizajes duros más que los suaves', () => {
    const r = new Rumble();
    let n = 0;
    for (let i = 0; i < 120; i++) if (r.frame(1 / 60, { lmi: 0.2, prox: true, off: false })) n++;
    expect(n).toBe(4); // 2 s
    expect(r.hit('land', 0.3)).toBeNull();
    expect(r.hit('land', 0.8)!.strong).toBeLessThan(r.hit('land', 1.6)!.strong);
    expect(r.hit('strike', 0.1)).toBeNull();
    expect(r.hit('strike', 0.8)!.strong).toBeGreaterThan(0.5);
    expect(r.hit('tip')!.ms).toBeGreaterThan(500);
  });
});
