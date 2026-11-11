import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Parts, SHADOW_LAYER } from './builder';
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

  it('los colores por vértice son los de la paleta', () => {
    const out = parts().build(new THREE.Group(), pal);
    const vc = out.find((m) => m.geometry.attributes.color)!.geometry.attributes.color;
    const seen = new Set<string>();
    for (let i = 0; i < vc.count; i++) seen.add([vc.getX(i), vc.getY(i), vc.getZ(i)].map((v) => v.toFixed(4)).join());
    const want = ['yellow', 'grey', 'black'].map((k) => { const c = pal[k as 'grey'].color; return [c.r, c.g, c.b].map((v) => v.toFixed(4)).join(); });
    expect([...seen].sort()).toEqual(want.sort());
  });

  it('sin sombras no hay malla de sombra', () => {
    const out = parts().build(new THREE.Group(), pal, false);
    expect(out).toHaveLength(3);
    expect(out.every((m) => !m.castShadow && !m.receiveShadow)).toBe(true);
  });
});
