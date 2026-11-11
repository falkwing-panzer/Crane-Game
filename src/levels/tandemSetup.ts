// Izaje en tándem (fase 10): la prueba libre (?tandem=1) y el nivel 14 "Columna en tándem". Sin three.js (se usa en
// las pruebas). Nada de esto está en la referencia (su nivel 13 tiene una columna de 1.200 t que la AT 500-8 no podría
// llevar de cola): columna de 40 m, Ø 5 m y 400 t, límites y obra de 120 × 80 m aprobados por Jesús.

import type { CraneId, CraneSpec } from '../crane/cranes';
import { tipPos, type CraneState } from '../crane/kinematics';
import { syncConfig } from '../crane/assembly';
import type { CraneConfig } from '../crane/stability';
import { supportMode } from '../crane/ops';
import { apply, carrierPose } from '../crane/pose';
import type { V3 } from '../crane/pose';
import { LEVELS, type Level, type TandemCrane } from './levels';
import { crateBases } from './setup';

/** Grúa principal (cabeza de la columna) y de cola (pie) */
export const TANDEM_IDS: [CraneId, CraneId] = ['lr', 'xl'];

const D = Math.PI / 180;

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

/** Prueba libre: la principal al sur con la pluma hacia el norte (+z), la de cola al norte con la pluma hacia el sur */
export const TANDEM_FREE: { main: TandemCrane; tail: TandemCrane } = {
  main: { id: 'lr', h: 0, slew: -Math.PI / 2 },
  tail: { id: 'xl', h: 0, slew: Math.PI / 2, ang: 55 * D },
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

type Unit = { T: CraneSpec; S: CraneState; C: CraneConfig };

/**
 * Coloca las dos grúas del tándem montadas, con rumbo, giro y pluma de `def` y la cabeza sobre su orejeta (la
 * principal sobre la 0, la de cola sobre la 1), los ganchos 0,3 m por encima. La carga va a lo largo de x (sin girar).
 */
export function placeTandem(main: Unit, tail: Unit, def = TANDEM_FREE, col: { pos: V3; lugs: V3[] } = TEST_COLUMN) {
  ([[main, def.main, col.lugs[0]], [tail, def.tail, col.lugs[1]]] as const).forEach(([u, d, lug]) => {
    rigged(u.T, u.S, u.C);
    u.S.h = d.h;
    u.S.slew = d.slew;
    if (d.ang !== undefined) u.S.ang = d.ang;
    if (d.Lb !== undefined) u.S.Lb = d.Lb;
    aimHead(u.T, u.S, col.pos.x + lug.x, col.pos.z + lug.z, col.pos.y + lug.y + 0.3);
  });
}

/** Altura del transportador modular (plataforma sin cabina) del nivel de tándem */
const BED_H = 1.8;

/**
 * Nivel 14 (fase 10): poner de pie una columna de 400 t con la LR 3000 (cabeza) y la AT 500-8 (pie) y llevarla a su
 * cimentación. Obra de 120 × 80 m. La columna llega tumbada a lo largo de x, con la cabeza al oeste (orejeta 0, que
 * sobresale 1,5 m) y el pie al este, junto a la LR 3000: al ponerla de pie el radio de la principal baja de unos 72 m a
 * unos 32 m, y la cimentación queda a 30 m de ella hacia el norte (−z).
 */
export const TANDEM_LEVEL: Level = {
  name: 'Columna en tándem', type: 'Tándem', par: 1500, wind: [1.5, 1, 0], ground: '#3a3c3f',
  size: [120, 80],
  cranes: ['lr'], rec: 'lr', why: {},
  start: { x: 0, z: 0, h: 0 },
  tandem: {
    // principal: pluma hacia el oeste (−x), a 50° (unos 72 m de radio) sobre la cabeza de la columna
    main: { id: 'lr', h: 0, slew: Math.PI, ang: 50 * D },
    // cola: al sur del pie (+z) con la pluma hacia el norte (−z), 30 m a 67° (10 m de radio, como 16 m a 45°: sus
    // estabilizadores quedan a 2 m del transportador). Con la pluma de 16 m el cable medía 6,7 m: medio metro de
    // desplazamiento ya eran 4–5° y el límite de 6° obligaba a cambiar de grúa cada segundo; con unos 20 m, un tercio.
    tail: { id: 'xl', h: 0, slew: Math.PI / 2, ang: 67 * D, Lb: 30 },
  },
  brief: 'Pon de pie la columna de 400 t y 40 m que llegó tumbada en el transportador y apóyala en su cimentación. La LR 3000 la levanta por la cabeza y la AT 500-8 sostiene el pie hasta que quede vertical. Tab cambia de grúa: la otra se queda quieta.',
  tips: [
    'Engancha las dos (Espacio, Tab, Espacio) y separa la columna del transportador izando con las dos.',
    'Para ponerla de pie, iza con la LR 3000 y sube su pluma (W) para que su cable siga vertical mientras la cabeza se acerca al pie; la AT 500-8 sostiene el pie.',
    'Cuando la AT 500-8 ya casi no lleve nada (mira su panel, abajo a la derecha), suéltala (Espacio): si la columna sigue subiendo con ella enganchada, arrastra su gancho hasta la cabeza de la pluma. Después gira con la LR 3000 hasta la cimentación y apóyala despacio.',
    'Falla si una grúa pasa del 100 % de LMI, si un cable se aparta más de 6° de la vertical (tiro lateral), si la columna se ladea más de 10° sobre su eje o si un gancho choca con su cabeza.',
  ],
  boxes: [
    { x: 40, z: 40, w: 44, d: 6, h: BED_H, kind: 'bed' },
    { x: 92, z: 10, w: 9, d: 9, h: 2, kind: 'pad' },
    { x: 10, z: 10, w: 8, d: 8, h: 18, kind: 'tank' },
    { x: 12, z: 70, w: 8, d: 8, h: 14, kind: 'tank' },
    { x: 60, z: 72, w: 14, d: 6, h: 8, kind: 'rack' },
  ],
  crates: [{
    x: 40, z: 40, w: 40, d: 5, h: 5, m: 400, label: 'C-14', color: '#9aa3aa', kind: 'vessel', stand: 'x',
    lugs: [{ x: -21.5, y: 0, z: 0 }, { x: 18, y: 2.5, z: 0 }],
  }],
  zones: [{ x: 92, z: 10, w: 9, d: 9, y: 2, label: 'CIMENTACIÓN' }],
};

/** Los 13 niveles de la referencia y el de tándem (fase 10) */
export const ALL_LEVELS: Level[] = [...LEVELS, TANDEM_LEVEL];

/** La columna del nivel de tándem en el mundo: centro (sobre el transportador) y orejetas */
export function tandemColumn(L: Level): { pos: V3; lugs: V3[] } {
  const c = L.crates[0];
  return { pos: { x: c.x, y: crateBases(L)[0] + c.h / 2, z: c.z }, lugs: c.lugs! };
}

/** Nivel de tándem (aprobado por Jesús): cable a más de 6° de la vertical o columna ladeada más de 10° = fallo */
export const SIDE_MAX = 6 * D, SIDE_WARN = 4 * D, ROLL_MAX = 10 * D;
/** Tiempo seguido por encima del límite antes de fallar (s): LMI > 100 % y tiro lateral. Un balanceo corto no cuenta */
export const OVER_T = 0.5, SIDE_T = 1;
/** Parte mínima de la carga (t) para que cuente el tiro lateral de un cable */
export const SIDE_LOAD = 5;

/** Ángulo del cable con la vertical (rad), de la cabeza a lo alto del gancho */
export function cableAngle(head: V3, hookTop: V3) {
  return Math.atan2(Math.hypot(hookTop.x - head.x, hookTop.z - head.z), Math.max(1e-6, head.y - hookTop.y));
}

/**
 * Ladeo de una carga sobre su eje largo x (rad): cuánto sale su eje z del plano horizontal. Al ponerla de pie gira
 * alrededor de un eje horizontal perpendicular a ella, y el eje z sigue horizontal (0); de pie, girar sobre sí misma
 * tampoco lo cambia.
 */
export function rollOf(q: { x: number; y: number; z: number; w: number }) {
  // componente y del eje z del cuerpo en el mundo
  return Math.asin(Math.min(1, Math.abs(2 * (q.y * q.z - q.w * q.x))));
}
