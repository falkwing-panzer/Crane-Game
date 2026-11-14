// Fase 18: terreno de cada partida. Los 14 niveles (y el tándem) son planos en toda la zona de juego, como siempre;
// solo cambian las colinas del horizonte, que ahora son alturas reales más allá de todo el decorado. La prueba
// libre tiene además una meseta de prueba con taludes de distinta pendiente (rampa para subir, bajada, talud lateral
// y un desnivel), que es el único sitio con heightfield en Rapier.

import type { Decor } from '../decor/layout';
import { rng } from '../decor/layout';
import { Terrain, makePatch, mesaHeight, mesaRect, type Hills, type Mesa, type Rect } from './terrain';

/**
 * Meseta de la prueba libre (aproximación de prueba, no está en la referencia): 3 m de alto, arriba 30 × 40 m, a la
 * izquierda por delante de la grúa (lejos de los bloques, la caja y el barro). Taludes: hacia −x 30 m (5,7°, rampa
 * de subida), hacia +x 14 m (12°), hacia −z 9,2 m (18°: solo orugas) y hacia +z 3 m (45°: desnivel que nadie sube).
 */
export const TEST_MESA: Mesa = { top: { x0: 50, x1: 80, z0: -75, z1: -35 }, h: 3, run: [30, 14, 9.23, 3] };
/** Celda del heightfield de la meseta (m) */
export const MESA_CELL = 1;

/** Distancia del centro a la que llega el decorado (piezas, suelos, calles, cables y caminos; el agua no cuenta) */
export function decorReach(D: Decor) {
  const [cx, cz] = D.center;
  let r = 0;
  const pt = (x: number, z: number) => { r = Math.max(r, Math.hypot(x - cx, z - cz)); };
  for (const l of [D.kit.near, D.kit.far, D.kit.detail]) for (const p of l) {
    if (p.k === 'cyl') { pt(p.a[0], p.a[2]); pt(p.b[0], p.b[2]); } else pt(p.x, p.z);
  }
  for (const f of D.flats) { pt(f.x0, f.z0); pt(f.x1, f.z1); pt(f.x0, f.z1); pt(f.x1, f.z0); }
  for (const rt of D.routes) for (const [x, z] of rt.pts) pt(x, z);
  for (const [a, b] of D.wires) { pt(a[0], a[2]); pt(b[0], b[2]); }
  return r;
}

/** Colinas del horizonte de una partida: empiezan 30 m más allá del decorado (y nunca antes de 420 m) */
export function hillsFor(D: Decor): Hills {
  const R = rng(D.seed + 2);
  const r0 = Math.max(420, decorReach(D) + 30);
  const cut: Rect[] = D.water.filter((w) => (w.x1 - w.x0) * (w.z1 - w.z0) > 4000);
  return {
    center: D.center, r0, r1: r0 + 150, hMin: D.city ? 10 : 18, hMax: D.city ? 32 : 60,
    phase: [R() * 6.3, R() * 6.3, R() * 6.3], cut, cutFade: 90,
  };
}

export function terrainFor(D: Decor, free: boolean): Terrain {
  const patches = [];
  if (free) {
    const r = mesaRect(TEST_MESA);
    patches.push(makePatch({ x0: r.x0 - 2, x1: r.x1 + 2, z0: r.z0 - 2, z1: r.z1 + 2 }, MESA_CELL, (x, z) => mesaHeight(TEST_MESA, x, z)));
  }
  return new Terrain(patches, hillsFor(D));
}
