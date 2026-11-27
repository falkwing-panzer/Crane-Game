import { CRANES, type CraneId } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { rng } from '../decor/layout';
import { WD, WW, type Level, type LevelBox, type LevelCrate, type LevelZone } from './levels';
import { liftPlan, planConfigs, type Ghost } from './liftPlan';
import { placeCrane } from './setup';

/**
 * Obras generadas (fase 22: reto diario; fase 25: contratos de la carrera). Con una semilla sale siempre la misma
 * obra: la generación usa solo `rng` (mulberry32, aritmética entera) y sumas y productos, sin `Math.sin` ni nada que
 * cambie entre navegadores. La obra se acepta si el plan de izaje (fase 20) dice que la grúa recomendada, desde donde
 * empieza, tiene sitio y llega con cada carga a su zona (verde o ámbar); si no, se prueba la siguiente.
 * El plan de izaje sí usa trigonometría: dos motores distintos solo podrían diferir en una obra justo en el límite.
 */

/** Hash de un texto (FNV-1a de 32 bits) */
export function hashSeed(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Fecha de hoy en UTC (AAAA-MM-DD): el mismo reto en todo el mundo a la vez */
export const todayUTC = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Grúas de las obras generadas y masa de las cargas (t) para cada una (aproximación del juego) */
export const GEN_CRANES: { id: CraneId; m: [number, number] }[] = [
  { id: 'small', m: [1, 5] },
  { id: 'medium', m: [2, 10] },
  { id: 'large', m: [5, 25] },
  { id: 'at300', m: [8, 35] },
  { id: 'xl', m: [10, 50] },
];

/** Tipos de carga: medidas (m), etiqueta, color y tipo */
const CRATES = [
  { w: 6.1, d: 2.44, h: 2.6, label: 'CONT', color: '#3d6f8f', kind: 'container' },
  { w: 2, d: 2, h: 1.5, label: 'PALÉ', color: '#a98454', kind: 'crate' },
  { w: 8, d: 0.6, h: 0.8, label: 'VIGA', color: '#c06a2b', kind: 'beam' },
  { w: 2.5, d: 2.5, h: 2, label: 'BLOQUE', color: '#9aa3aa', kind: 'block' },
  { w: 4, d: 2.2, h: 2.4, label: 'EQUIPO', color: '#5b7a5e', kind: 'crate' },
];
const OBST: LevelBox['kind'][] = ['building', 'container', 'rack', 'tank', 'shelter'];
const NAMES = ['Patio de la mañana', 'Descarga en la nave', 'Obra en la esquina', 'Acopio del muelle', 'Nave nueva',
  'Planta de hormigón', 'Almacén del puerto', 'Taller de montaje', 'Parque de equipos', 'Explanada norte'];
const ENVS = ['port', 'urban', 'logistics', 'industrial', 'field', 'refinery'];

export interface GenOpts {
  /** Grúas posibles (por defecto todas las de GEN_CRANES) */
  cranes?: CraneId[];
  /** Cargas: mínimo y máximo */
  crates?: [number, number];
  /** Multiplica las masas (carrera: contratos más pesados) */
  massK?: number;
  type?: string;
  name?: string;
}

interface Item { x: number; z: number; r: number }

/** Una obra con esta semilla, o null si en `tries` intentos ninguna se podía hacer */
export function generateSite(seed: number, o: GenOpts = {}, tries = 60): Level | null {
  const R = rng(seed);
  const rnd = (a: number, b: number) => a + R() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T,>(l: readonly T[]) => l[Math.floor(R() * l.length) % l.length];
  const pool = GEN_CRANES.filter((c) => !o.cranes || o.cranes.includes(c.id));
  for (let k = 0; k < tries; k++) {
    const gc = pick(pool), T = CRANES[gc.id];
    const start = { x: int(26, 58), z: int(22, 34), h: 0 };
    const keep: Item[] = [{ x: start.x, z: start.z, r: T.structMax >= 200 ? 12 : 9.5 }];
    const free = (x: number, z: number, r: number, m = 1.5) =>
      x - r > 2 && x + r < WW - 2 && z - r > 2 && z + r < WD - 2 && keep.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + r + m);
    // cargas y sus zonas: alrededor de la grúa, a 8–22 m
    const n = int(...(o.crates ?? [1, 3]));
    const crates: LevelCrate[] = [], zones: LevelZone[] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const c = pick(CRATES);
      const m = Math.round(rnd(gc.m[0], gc.m[1]) * (o.massK ?? 1) * 10) / 10;
      const rot = R() < 0.5;
      const w = rot ? c.d : c.w, d = rot ? c.w : c.d, r = Math.hypot(w, d) / 2;
      const place = (rr: number) => {
        for (let j = 0; j < 30; j++) {
          // dirección sin trigonometría: un punto al azar en el anillo, por rechazo
          const dx = rnd(-1, 1), dz = rnd(-1, 1), l = Math.hypot(dx, dz);
          if (l < 0.3 || l > 1) continue;
          const dist = rnd(8, 22), x = Math.round(start.x + (dx / l) * dist), z = Math.round(start.z + (dz / l) * dist);
          if (free(x, z, rr)) { keep.push({ x, z, r: rr }); return { x, z }; }
        }
        return null;
      };
      const pc = place(r), pz = place(r + 1.5);
      if (!pc || !pz) { ok = false; break; }
      crates.push({ x: pc.x, z: pc.z, w, d, h: c.h, m, label: `${c.label} ${i + 1}`, color: c.color, kind: c.kind });
      zones.push({ x: pz.x, z: pz.z, w: Math.round(w + 3), d: Math.round(d + 3), y: 0, label: `ZONA ${i + 1}` });
    }
    if (!ok) continue;
    // obstáculos fuera de todo lo anterior
    const boxes: LevelBox[] = [];
    for (let i = int(2, 5), j = 0; i > 0 && j < 40; j++) {
      const w = int(4, 14), d = int(4, 12), x = int(4, WW - 4), z = int(4, WD - 4), r = Math.hypot(w, d) / 2;
      if (!free(x, z, r, 2.5)) continue;
      keep.push({ x, z, r });
      boxes.push({ x, z, w, d, h: int(3, 12), kind: pick(OBST) });
      i--;
    }
    const L: Level = {
      name: o.name ?? pick(NAMES), type: o.type ?? 'Reto diario',
      par: 120 + 75 * n, wind: [int(0, 6), int(0, 4), int(0, 359)], ground: '#3a3c3f',
      cranes: [gc.id], rec: gc.id, why: {}, start, brief: '', tips: [], boxes, crates, zones,
      env: pick(ENVS), seed: seed + k,
    };
    if (!doable(gc.id, L)) continue;
    // las otras grúas que también podrían, desde el mismo sitio
    L.cranes = pool.map((c) => c.id).filter((id) => id === gc.id || doable(id, L));
    return L;
  }
  return null;
}

/** La grúa, desde donde empieza, tiene sitio y llega con cada carga a alguna zona */
export function doable(id: CraneId, L: Level) {
  const T = CRANES[id], S = initialState(T);
  placeCrane(T, S, L);
  const g: Ghost = { x: S.x, z: S.z, h: S.h };
  const p = liftPlan(T, L, g, planConfigs(T, L));
  return !p.site && p.crates.every((c) => c.grade !== 'no');
}

/** El reto de un día (AAAA-MM-DD) */
export function dailySite(date: string): Level | null {
  return generateSite(hashSeed(`reto-${date}`));
}
