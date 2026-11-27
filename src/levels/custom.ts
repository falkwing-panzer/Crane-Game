import { CRANES, type CraneId } from '../crane/cranes';
import type { Env } from '../decor/layout';
import type { LevelEvent } from './events';
import { KIND_COL, type BoxKind, type Level } from './levels';

// Fase 28: obras hechas con el editor. Un enlace puede traer cualquier cosa: antes de jugarla se limpia (solo los
// campos conocidos, números finitos y dentro de rangos, listas con un máximo). Lo que no vale se descarta.

export const ENVS: Env[] = ['industrial', 'urban', 'port', 'field', 'forest', 'refinery', 'logistics', 'electric', 'bridge', 'dense'];
export const BOX_KINDS = Object.keys(KIND_COL) as BoxKind[];
/** Tipos de carga que se pueden elegir en el editor (el dibujo de los de la fase 27 cambia; el resto es una caja) */
export const CRATE_KINDS = ['crate', 'container', 'hvac', 'tank', 'girder', 'tower', 'glass', 'wtower', 'nacelle', 'hub', 'blade'];
/** Grúas que puede pedir una obra del editor (sin tándem ni grúa auxiliar) */
export const EDITOR_CRANES = (Object.keys(CRANES) as CraneId[]);

/** Límites de una obra del editor */
export const CUSTOM_MAX = { size: [30, 240] as const, boxes: 80, crates: 12, zones: 12, lines: 4, soft: 8, workers: 6, lamps: 3, events: 12 };

const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const str = (v: unknown, max: number, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
const arr = <T>(v: unknown, max: number, f: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v.slice(0, max).map((x) => (x && typeof x === 'object' ? f(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : []);

/** Obra limpia, o null si no se puede jugar (sin cargas, sin zonas o sin grúa) */
export function sanitizeLevel(v: unknown): Level | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const W = num((o.size as number[] | undefined)?.[0], CUSTOM_MAX.size[0], CUSTOM_MAX.size[1], 84);
  const D = num((o.size as number[] | undefined)?.[1], CUSTOM_MAX.size[0], CUSTOM_MAX.size[1], 56);
  const X = (x: unknown) => num(x, 0, W, W / 2), Z = (z: unknown) => num(z, 0, D, D / 2);
  const cranes = Array.isArray(o.cranes) ? [...new Set(o.cranes.filter((c): c is CraneId => typeof c === 'string' && EDITOR_CRANES.includes(c as CraneId)))] : [];
  if (!cranes.length) return null;
  const rec = cranes.includes(o.rec as CraneId) ? (o.rec as CraneId) : cranes[0];
  const wind = (o.wind as unknown[] | undefined) ?? [];
  const L: Level = {
    name: str(o.name, 40, 'Obra sin nombre') || 'Obra sin nombre', type: 'Editor',
    par: num(o.par, 30, 3600, 600), ground: color(o.ground, '#3b3d41'),
    wind: [num(wind[0], 0, 15, 0), num(wind[1], 0, 10, 0), num(wind[2], -360, 360, 0)],
    cranes, rec, why: {},
    start: { x: X((o.start as Record<string, unknown> | undefined)?.x), z: Z((o.start as Record<string, unknown> | undefined)?.z), h: num((o.start as Record<string, unknown> | undefined)?.h, -7, 7, 0) },
    brief: str(o.brief, 400), tips: Array.isArray(o.tips) ? o.tips.filter((x): x is string => typeof x === 'string').slice(0, 4).map((x) => x.slice(0, 200)) : [],
    size: [W, D],
    boxes: arr(o.boxes, CUSTOM_MAX.boxes, (b) => ({
      x: X(b.x), z: Z(b.z), w: num(b.w, 0.2, W, 4), d: num(b.d, 0.2, D, 4), h: num(b.h, 0.1, 80, 3),
      kind: BOX_KINDS.includes(b.kind as BoxKind) ? (b.kind as BoxKind) : 'building',
      ...(b.color ? { color: color(b.color, '#8e959c') } : {}),
    })),
    crates: arr(o.crates, CUSTOM_MAX.crates, (c) => ({
      x: X(c.x), z: Z(c.z), w: num(c.w, 0.3, 40, 2), d: num(c.d, 0.3, 40, 2), h: num(c.h, 0.3, 30, 1.5), m: num(c.m, 0.1, 1000, 2),
      label: str(c.label, 16, 'CARGA') || 'CARGA', color: color(c.color, '#9a6a3a'),
      kind: CRATE_KINDS.includes(c.kind as string) ? (c.kind as string) : 'crate',
      ...(typeof c.fragile === 'number' ? { fragile: num(c.fragile, 0.2, 3, 0.5) } : {}),
    })),
    zones: arr(o.zones, CUSTOM_MAX.zones, (z) => ({
      x: X(z.x), z: Z(z.z), w: num(z.w, 0.5, W, 6), d: num(z.d, 0.5, D, 6), y: num(z.y, 0, 80, 0), label: str(z.label, 16, 'ZONA') || 'ZONA',
      ...(typeof z.stack === 'number' ? { stack: Math.round(num(z.stack, 0, 9, 0)) } : {}),
    })),
  };
  if (!L.crates.length || !L.zones.length) return null;
  const lines = arr(o.lines, CUSTOM_MAX.lines, (l) => {
    const a = l.a as number[] | undefined, b = l.b as number[] | undefined;
    if (!a || !b) return null;
    return { a: [X(a[0]), Z(a[1])] as [number, number], b: [X(b[0]), Z(b[1])] as [number, number], y: num(l.y, 4, 40, 10), kv: str(l.kv, 10, '20 kV') || '20 kV', clear: num(l.clear, 1, 10, 3), poles: [] };
  });
  if (lines.length) L.lines = lines;
  const soft = arr(o.soft, CUSTOM_MAX.soft, (s) => ({ x: X(s.x), z: Z(s.z), w: num(s.w, 1, W, 8), d: num(s.d, 1, D, 8), kind: s.kind === 'water' ? 'water' as const : 'mud' as const }));
  if (soft.length) L.soft = soft;
  const workers = arr(o.workers, CUSTOM_MAX.workers, (w) => {
    const pts = Array.isArray(w.pts) ? (w.pts as unknown[]).slice(0, 6).map((p) => [X((p as number[])[0]), Z((p as number[])[1])] as [number, number]) : [];
    return pts.length >= 2 ? { pts, speed: num(w.speed, 0.3, 2, 1.1), wait: num(w.wait, 0, 30, 4), phase: num(w.phase, 0, 60, 0) } : null;
  });
  if (workers.length) L.workers = workers;
  const lamps = Array.isArray(o.lamps) ? o.lamps.slice(0, CUSTOM_MAX.lamps).filter((p): p is number[] => Array.isArray(p))
    .map((p) => [X(p[0]), Z(p[1]), num(p[2], 3, 30, 10)] as [number, number, number]) : [];
  if (lamps.length) L.lamps = lamps;
  if (o.light === 'atardecer' || o.light === 'noche') L.light = o.light;
  const events = arr(o.events, CUSTOM_MAX.events, (e): LevelEvent | null => {
    const t = num(e.t, 0, 3600, 60), dur = num(e.dur, 5, 3600, 60);
    if (e.kind === 'gust') return { kind: 'gust', t, v: num(e.v, 1, 15, 5), dur };
    if (e.kind === 'fog') return { kind: 'fog', t, dur, dist: num(e.dist, 30, 400, 80) };
    if (e.kind === 'storm') return { kind: 'storm', t, dur };
    return null;
  });
  if (events.length) L.events = events;
  if (typeof o.time === 'number') L.time = num(o.time, 60, 7200, 900);
  if (o.checklist === true) L.checklist = true;
  if (o.ridge === true) L.ridge = true;
  const rg = o.rigger as Record<string, unknown> | undefined;
  if (rg) L.rigger = { x: X(rg.x), z: Z(rg.z), y: num(rg.y, 0, 80, 0) };
  L.env = ENVS.includes(o.env as Env) ? (o.env as Env) : 'industrial';
  L.seed = Math.round(num(o.seed, 0, 1e9, 28028));
  return L;
}

/** Una obra nueva del editor: la grúa en el centro, una caja y su zona */
export function blankLevel(): Level {
  return sanitizeLevel({
    name: 'Mi obra', size: [84, 56], cranes: ['medium'], rec: 'medium', start: { x: 20, z: 40, h: 0 }, wind: [0, 0, 0], par: 400,
    crates: [{ x: 32, z: 40, w: 2.4, d: 2.4, h: 1.5, m: 3, label: 'CARGA 1', color: '#9a6a3a', kind: 'crate' }],
    zones: [{ x: 36, z: 22, w: 6, d: 6, y: 0, label: 'ZONA' }],
    brief: 'Lleva la carga a su zona.', env: 'industrial',
  })!;
}
