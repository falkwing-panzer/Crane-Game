// Prueba libre del tándem (fase 10, ?tandem=1): LR 3000 de grúa principal y AT 500-8 de cola con una columna de
// prueba tumbada en el suelo. Sin three.js (se usa en las pruebas).
//
// La columna NO es de la referencia (su nivel 13 tiene una de 1.200 t que la AT 500-8 no podría llevar de cola):
// medidas y masa propuestas para la prueba; el nivel de tándem (parte B) espera la aprobación de Jesús.

import type { CraneId, CraneSpec } from '../crane/cranes';
import { tipPos, type CraneState } from '../crane/kinematics';
import { syncConfig } from '../crane/assembly';
import type { CraneConfig } from '../crane/stability';
import { supportMode } from '../crane/ops';
import { apply, carrierPose } from '../crane/pose';
import type { V3 } from '../crane/pose';

/** Grúa principal (cabeza de la columna) y de cola (pie) */
export const TANDEM_IDS: [CraneId, CraneId] = ['lr', 'xl'];

/**
 * Columna de prueba: 40 m × 5 × 5, 400 t, tumbada a lo largo de x con la cabeza hacia +x. Orejetas: la de cabeza
 * sale 1,5 m del centro de la cara del extremo (de pie, la columna cuelga recta; tumbada, el gancho cuelga libre al
 * lado: el gancho de la LR 3000 mide 2,3 m y apoyado contra la cara se llevaba parte de la carga) y la de cola va
 * sobre la cara de arriba, a 2 m del pie.
 */
export const TEST_COLUMN = {
  label: 'Columna', mass: 400,
  half: { x: 20, y: 2.5, z: 2.5 },
  pos: { x: 0, y: 2.5, z: 0 },
  lugs: [{ x: 21.5, y: 0, z: 0 }, { x: -18, y: 2.5, z: 0 }] as V3[],
};

/** Montajes hechos: estabilizadores fuera, lastre y Y-guy montados (lo que haya en la grúa) */
export function rigged(T: CraneSpec, S: CraneState, C: CraneConfig) {
  if (T.out) { S.out = S.outT = 1; }
  if (T.ballast) { S.cw = S.cwT = 1; }
  if (T.yguy) { S.yg = S.ygT = 1; }
  syncConfig(T, S, C);
}

/** Mueve la grúa (sin cambiar rumbo, giro ni pluma) para que la cabeza quede sobre (x, z), y cuelga el gancho a `y`. */
export function aimHead(T: CraneSpec, S: CraneState, x: number, z: number, hookBottomY: number) {
  const h = apply(carrierPose(T, S, supportMode(S, T)), tipPos(T, S));
  S.x += x - h.x;
  S.z += z - h.z;
  // gancho de 1 m (HOOK_HALF_H · 2) con el fondo a hookBottomY
  S.cable = Math.max(1, h.y - hookBottomY - 1);
}

/**
 * Coloca las dos grúas del tándem: la principal al sur de la cabeza de la columna con la pluma hacia el norte (+z)
 * y la de cola al norte del pie con la pluma hacia el sur, los ganchos junto a sus orejetas.
 */
export function placeTandem(main: { T: CraneSpec; S: CraneState; C: CraneConfig }, tail: { T: CraneSpec; S: CraneState; C: CraneConfig }) {
  const c = TEST_COLUMN;
  rigged(main.T, main.S, main.C);
  rigged(tail.T, tail.S, tail.C);
  // principal: pluma hacia +z (giro −90°), a 70° (la de la referencia)
  main.S.slew = -Math.PI / 2;
  const h = c.lugs[0];
  aimHead(main.T, main.S, c.pos.x + h.x, c.pos.z + h.z, c.pos.y + h.y + 0.3);
  // cola: pluma hacia −z (giro +90°), 16 m a 55° (unos 9 m de radio)
  tail.S.slew = Math.PI / 2;
  tail.S.ang = 55 * Math.PI / 180;
  const t = c.lugs[1];
  aimHead(tail.T, tail.S, c.pos.x + t.x, c.pos.z + t.z, c.pos.y + t.y + 0.3);
}
