// Terreno blando (soft de los niveles de la referencia): zonas de barro y de agua, alineadas con los ejes.
// La referencia no calcula presión sobre el suelo; solo tiene estas reglas (carrierBlocked y padsBlocked):
// - nadie entra al agua;
// - las ruedas no entran al barro, salvo las grúas todo terreno (offroad: RT 90);
// - las orugas sí (reparten el peso en toda su superficie);
// - las zapatas de los estabilizadores no se apoyan en barro ni en agua.

import type { CraneSpec } from './cranes';
import { bodyHalf } from './cranes';

export type SoftKind = 'mud' | 'water';
/** Centro (x, z) y medidas totales en x (w) y en z (d), como la referencia. */
export interface SoftZone { kind: SoftKind; x: number; z: number; w: number; d: number }

/** inBox de la referencia */
const inBox = (x: number, z: number, s: SoftZone) => Math.abs(x - s.x) < s.w / 2 && Math.abs(z - s.z) < s.d / 2;

export function softAt(zones: SoftZone[], x: number, z: number, kinds: SoftKind[]): SoftZone | undefined {
  return zones.find((s) => kinds.includes(s.kind) && inBox(x, z, s));
}

/** Punto del marco del chasis (x adelante, z lateral) → mundo, con el portador en (cx, cz) y rumbo h. */
function toWorld(x: number, z: number, cx: number, cz: number, h: number): [number, number] {
  const c = Math.cos(h), s = Math.sin(h);
  return [cx + c * x + s * z, cz - s * x + c * z];
}

/** Puntos del borde del apoyo (footprint de la referencia): orugas o caja del chasis. */
export function footprint(T: CraneSpec, cx: number, cz: number, h: number): [number, number][] {
  const r = T.crawler ? T.track! : { xf: T.len[1], xr: T.len[0], hw: bodyHalf(T) };
  const pts: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const x = r.xr + ((r.xf - r.xr) * i) / 8;
    for (const z of [-r.hw, r.hw]) pts.push(toWorld(x, z, cx, cz, h));
  }
  for (let i = 0; i <= 4; i++) {
    const z = -r.hw + (r.hw * i) / 2;
    for (const x of [r.xr, r.xf]) pts.push(toWorld(x, z, cx, cz, h));
  }
  return pts;
}

/** ¿El portador puede estar en (cx, cz, h) según el terreno? Devuelve el motivo o null. */
export function terrainBlocked(T: CraneSpec, zones: SoftZone[], cx: number, cz: number, h: number): string | null {
  if (!zones.length) return null;
  for (const [x, z] of footprint(T, cx, cz, h)) {
    if (softAt(zones, x, z, ['water'])) return 'No se puede entrar al agua';
    if (!T.crawler && !T.offroad && softAt(zones, x, z, ['mud'])) return 'Terreno blando: las ruedas se hundirían';
  }
  return null;
}

/** ¿Alguna zapata (con un margen de 0,6 m, como la referencia) cae en terreno blando? */
export function padsOnSoft(T: CraneSpec, zones: SoftZone[], cx: number, cz: number, h: number): string | null {
  const o = T.out;
  if (!o || !zones.length) return null;
  for (const [lx, lz] of [[o.xf, o.hw], [o.xf, -o.hw], [o.xr, o.hw], [o.xr, -o.hw]]) {
    const [x, z] = toWorld(lx, lz, cx, cz, h);
    for (const [dx, dz] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) {
      if (softAt(zones, x + dx, z + dz, ['water', 'mud'])) return 'Terreno blando bajo un estabilizador';
    }
  }
  return null;
}
