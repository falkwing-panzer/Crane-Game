// Armado de un nivel sin three.js (lo usan el juego y las pruebas): obstáculos (cajas y postes de las líneas),
// cargas apoyadas sobre lo que tengan debajo, terreno blando, límites de la obra y posición inicial de la grúa
// (loadLevel de la referencia).

import type { CraneSpec } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';
import type { SoftZone } from '../crane/terrain';
import type { Bounds, Obstacle, Physics } from '../physics/world';
import { WD, WW, type Level, type LevelBox, type LevelCrate, type LevelZone } from './levels';

export const LEVEL_BOUNDS: Bounds = { x0: 0, x1: WW, z0: 0, z1: WD };
/** Medidas de la obra del nivel (fase 10: el de tándem es más grande) */
export const levelSize = (L: Level): [number, number] => L.size ?? [WW, WD];
export const levelBounds = (L: Level): Bounds => { const [w, d] = levelSize(L); return { x0: 0, x1: w, z0: 0, z1: d }; };

/** Nombres de los tipos de caja para los mensajes */
const KIND_LABEL: Record<string, string> = {
  building: 'Edificio', wall: 'Muro', pier: 'Pila', pad: 'Base', bed: 'Plataforma', cab: 'Cabina', pole: 'Poste',
  container: 'Contenedor', rack: 'Rack', shelter: 'Caseta', tank: 'Depósito',
};

/** Cajas del nivel más un poste por cada poste de las líneas eléctricas (loadLevel de la referencia). */
export function levelBoxes(L: Level): LevelBox[] {
  const out = L.boxes.map((b) => ({ ...b }));
  for (const l of L.lines ?? []) for (const p of l.poles) {
    const vertical = l.a[0] === l.b[0];
    out.push({ x: vertical ? l.a[0] : p, z: vertical ? p : l.a[1], w: 0.6, d: 0.6, h: l.y + 1.2, kind: 'pole' });
  }
  return out;
}

export function boxObstacle(b: LevelBox): Obstacle {
  return {
    label: KIND_LABEL[b.kind] ?? b.kind, kind: b.kind, color: b.color,
    half: { x: b.w / 2, y: b.h / 2, z: b.d / 2 }, pos: { x: b.x, y: b.h / 2, z: b.z }, rotY: 0,
  };
}

const ov = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && a2 > b1;

/**
 * Altura de apoyo de cada carga (surface() de la referencia): lo más alto de las cajas y de las cargas anteriores
 * que pisan su planta.
 */
export function crateBases(L: Level, boxes = levelBoxes(L)): number[] {
  const ys: number[] = [];
  L.crates.forEach((c, i) => {
    const x1 = c.x - c.w / 2, x2 = c.x + c.w / 2, z1 = c.z - c.d / 2, z2 = c.z + c.d / 2;
    let s = 0;
    for (const b of boxes) if (ov(x1, x2, b.x - b.w / 2, b.x + b.w / 2) && ov(z1, z2, b.z - b.d / 2, b.z + b.d / 2)) s = Math.max(s, b.h);
    for (let j = 0; j < i; j++) {
      const d = L.crates[j];
      if (ov(x1, x2, d.x - d.w / 2, d.x + d.w / 2) && ov(z1, z2, d.z - d.d / 2, d.z + d.d / 2)) s = Math.max(s, ys[j] + d.h);
    }
    ys.push(s);
  });
  return ys;
}

export const levelSofts = (L: Level): SoftZone[] => (L.soft ?? []).map((s) => ({ ...s }));

/**
 * Coloca la grúa al principio del nivel: x = max(start.x, 1,2 − trasera del chasis) como la referencia (que el
 * chasis no salga de la obra). El rumbo de la referencia tiene el signo contrario (todos los niveles empiezan en 0).
 */
export function placeCrane(T: CraneSpec, S: CraneState, L: Level) {
  S.x = Math.max(L.start.x, 1.2 - (T.crawler ? T.track!.xr : T.len[0]));
  S.z = L.start.z;
  S.h = -L.start.h;
}

/** Los datos de la carga para Physics.addLoad: medias medidas, centro y extras */
export function crateLoad(c: LevelCrate, base: number) {
  return {
    label: c.label, mass: c.m,
    half: { x: c.w / 2, y: c.h / 2, z: c.d / 2 },
    pos: { x: c.x, y: base + c.h / 2, z: c.z },
    extra: { color: c.color, kind: c.kind, fragile: c.fragile, lugs: c.lugs, stand: c.stand },
  };
}

/** Caja envolvente en planta de un cuerpo (centro, medias medidas y giro completo) y altura de su fondo */
export interface Placed { x: number; z: number; hx: number; hz: number; bottom: number; tilt: number }

/**
 * ¿La carga está dentro de la zona? (inZone de la referencia): su planta dentro de la de la zona (± 1 cm) y su fondo a
 * la altura de apoyo de la zona. Aquí la carga es un cuerpo de Rapier: su envolvente en planta, y la altura con 0,1 m
 * de tolerancia (la referencia pide 6 cm con alturas exactas). Además, que no esté volcada (inclinación < 5°).
 */
export function inZone(p: Placed, z: LevelZone) {
  return p.x - p.hx >= z.x - z.w / 2 - 0.01 && p.x + p.hx <= z.x + z.w / 2 + 0.01 &&
    p.z - p.hz >= z.z - z.d / 2 - 0.01 && p.z + p.hz <= z.z + z.d / 2 + 0.01 &&
    Math.abs(p.bottom - z.y) < 0.1 && p.tilt < (5 * Math.PI) / 180;
}

/**
 * checkWin de la referencia: cada carga (suelta y quieta: null si no) en alguna zona. Una zona puede recibir varias
 * cargas (los palés del contrarreloj); las pilas de la torre son zonas a distintas alturas.
 */
export function allPlaced(placed: (Placed | null)[], zones: LevelZone[]) {
  return placed.every((p) => !!p && zones.some((z) => inZone(p, z)));
}

/** Pone en el mundo de Rapier las cajas, las cargas y el terreno del nivel (la grúa ya está colocada). */
export function populate(phys: Physics, L: Level) {
  const boxes = levelBoxes(L);
  for (const b of boxes) phys.addObstacle(boxObstacle(b));
  const ys = crateBases(L, boxes);
  L.crates.forEach((c, i) => {
    const d = crateLoad(c, ys[i]);
    phys.addLoad(d.label, d.mass, d.half, d.pos, d.extra);
  });
  phys.softs.push(...levelSofts(L));
}
