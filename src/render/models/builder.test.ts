import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DETAIL, Parts, SHADOW_LAYER } from './builder';
import { AO_MAX } from './ao';
import { palette } from './materials';
import { CRANES } from '../../crane/cranes';

// Fase 11: menos draw calls. Los colores lisos de un grupo van en una sola malla con colores por vértice;
// cabina, cristal y luces conservan su malla; una sola malla de sombra por grupo.
describe('Parts.build', () => {
  const pal = palette(CRANES.medium);
  const parts = () => {
    const P = new Parts();
    P.box('yellow', 0, 1, 0, 1, 0, 1);
    P.box('grey', 1, 2, 0, 1, 0, 1);
    P.box('black', 2, 3, 0, 1, 0, 1);
    P.box('glass', 0, 1, 1, 2, 0, 1);
    P.box('cabin', 1, 2, 1, 2, 0, 1);
    return P;
  };

  it('una malla de colores, cabina y cristal aparte, y una de sombra', () => {
    const g = new THREE.Group();
    const out = parts().build(g, pal);
    expect(out).toHaveLength(4);
    const vc = out.filter((m) => (m.material as THREE.Material & { vertexColors: boolean }).vertexColors);
    expect(vc).toHaveLength(1);
    expect(out.some((m) => m.material === pal.cabin)).toBe(true);
    expect(out.some((m) => m.material === pal.glass)).toBe(true);
    const sh = out[out.length - 1];
    expect(sh.castShadow).toBe(true);
    expect(sh.layers.mask).toBe(1 << SHADOW_LAYER);
    // solo la malla de sombra proyecta; el cristal no está en ella (4 cajas de 12 triángulos)
    expect(out.filter((m) => m.castShadow)).toEqual([sh]);
    expect(sh.geometry.attributes.position.count).toBe(4 * 36);
  });

  it('los colores por vértice son los de la paleta (piezas separadas: sin oclusión)', () => {
    const P = new Parts();
    P.box('yellow', 0, 1, 0, 1, 0, 1);
    P.box('grey', 5, 6, 0, 1, 0, 1);
    P.box('black', 10, 11, 0, 1, 0, 1);
    const out = P.build(new THREE.Group(), pal);
    const vc = out.find((m) => m.geometry.attributes.color)!.geometry.attributes.color;
    const seen = new Set<string>();
    for (let i = 0; i < vc.count; i++) seen.add([vc.getX(i), vc.getY(i), vc.getZ(i)].map((v) => v.toFixed(4)).join());
    const want = ['yellow', 'grey', 'black'].map((k) => { const c = pal[k as 'grey'].color; return [c.r, c.g, c.b].map((v) => v.toFixed(4)).join(); });
    expect([...seen].sort()).toEqual(want.sort());
  });

  it('oclusión ambiental (fase 16): el rincón entre dos piezas se oscurece, la cara de fuera no', () => {
    const P = new Parts();
    P.box('grey', -3, 3, 0, 1, -1, 1); // "chasis"
    P.box('grey', 0, 1.5, 1, 3, -1, 1); // "cabina" encima
    const out = P.build(new THREE.Group(), pal);
    const g = out.find((m) => m.geometry.attributes.color)!.geometry;
    const pos = g.attributes.position, col = g.attributes.color, c = pal.grey.color;
    let corner = 1, far = 0;
    for (let i = 0; i < pos.count; i++) {
      const f = col.getX(i) / c.r;
      // techo del chasis junto a la cabina
      if (Math.abs(pos.getY(i) - 1) < 1e-6 && Math.abs(pos.getX(i)) < 0.3 && g.attributes.normal.getY(i) > 0.9) corner = Math.min(corner, f);
      // punta del chasis lejos de la cabina
      if (pos.getX(i) < -2.9) far = Math.max(far, f);
    }
    expect(corner).toBeLessThan(0.85);
    expect(corner).toBeGreaterThanOrEqual(1 - AO_MAX - 1e-6);
    expect(far).toBeCloseTo(1, 6);
  });

  it('detalles (fase 16): malla aparte que no proyecta ni entra en la de sombra', () => {
    const P = new Parts();
    P.box('yellow', 0, 1, 0, 1, 0, 1);
    P.detail(() => P.box('dark', 3, 3.05, 0, 1, 0, 0.05));
    const out = P.build(new THREE.Group(), pal);
    const det = out.find((m) => m.name === DETAIL)!;
    expect(det).toBeTruthy();
    expect(det.castShadow).toBe(false);
    expect(out[out.length - 1].geometry.attributes.position.count).toBe(36);
  });

  it('sin sombras no hay malla de sombra', () => {
    const out = parts().build(new THREE.Group(), pal, false);
    expect(out).toHaveLength(3);
    expect(out.every((m) => !m.castShadow && !m.receiveShadow)).toBe(true);
  });
});
