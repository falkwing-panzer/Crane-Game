import { CRANES, type CraneId } from '../crane/cranes';
import { initialState } from '../crane/kinematics';
import { blankLevel, sanitizeLevel } from '../levels/custom';
import type { Level } from '../levels/levels';
import { liftPlan, planConfigs } from '../levels/liftPlan';
import { placeCrane } from '../levels/setup';

// Fase 28: lo que se edita (sin DOM, se prueba suelto). El documento es una obra como las de los niveles; antes de
// jugarla o compartirla se limpia con sanitizeLevel.

export type Doc = Level;
export type Tool = 'select' | 'box' | 'crate' | 'zone' | 'line' | 'mud' | 'water' | 'worker' | 'truck' | 'lamp' | 'crane' | 'rigger';
export const TOOLS: Tool[] = ['select', 'crane', 'crate', 'zone', 'box', 'truck', 'line', 'mud', 'water', 'worker', 'lamp', 'rigger'];

/** Lo seleccionado: una lista de la obra y su índice (start y rigger no tienen índice) */
export type Sel = { list: 'boxes' | 'crates' | 'zones' | 'lines' | 'soft' | 'workers' | 'lamps'; i: number } | { list: 'start' | 'rigger'; i: 0 };

export const newDoc = (): Doc => structuredClone(blankLevel());

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Añade lo de la herramienta en (x, z); devuelve lo seleccionado */
export function addAt(doc: Doc, tool: Tool, x: number, z: number): Sel | null {
  x = r1(x); z = r1(z);
  switch (tool) {
    case 'box': doc.boxes.push({ x, z, w: 6, d: 4, h: 4, kind: 'building' }); return { list: 'boxes', i: doc.boxes.length - 1 };
    case 'truck':
      doc.boxes.push({ x, z, w: 9, d: 2.5, h: 1.4, kind: 'bed' }, { x: r1(x + 6.1), z, w: 3, d: 2.5, h: 3.2, kind: 'cab' });
      return { list: 'boxes', i: doc.boxes.length - 2 };
    case 'crate': {
      const n = doc.crates.length + 1;
      doc.crates.push({ x, z, w: 2.4, d: 2.4, h: 1.5, m: 3, label: `CARGA ${n}`, color: '#9a6a3a', kind: 'crate' });
      return { list: 'crates', i: doc.crates.length - 1 };
    }
    case 'zone': doc.zones.push({ x, z, w: 6, d: 6, y: 0, label: 'ZONA' }); return { list: 'zones', i: doc.zones.length - 1 };
    case 'line': (doc.lines ??= []).push({ a: [x - 15, z], b: [x + 15, z], y: 10, kv: '20 kV', clear: 3, poles: [] }); return { list: 'lines', i: doc.lines.length - 1 };
    case 'mud': case 'water': (doc.soft ??= []).push({ x, z, w: 10, d: 8, kind: tool }); return { list: 'soft', i: doc.soft.length - 1 };
    case 'worker': (doc.workers ??= []).push({ pts: [[x - 6, z], [x + 6, z]], speed: 1.1, wait: 4 }); return { list: 'workers', i: doc.workers.length - 1 };
    case 'lamp': if ((doc.lamps ??= []).length >= 3) return null; doc.lamps.push([x, z, 10]); return { list: 'lamps', i: doc.lamps.length - 1 };
    case 'crane': doc.start = { ...doc.start, x, z }; return { list: 'start', i: 0 };
    case 'rigger': doc.rigger = { x, z, y: 0 }; return { list: 'rigger', i: 0 };
    default: return null;
  }
}

const inRect = (x: number, z: number, c: { x: number; z: number; w: number; d: number }, m = 0) =>
  Math.abs(x - c.x) <= c.w / 2 + m && Math.abs(z - c.z) <= c.d / 2 + m;
const near = (x: number, z: number, px: number, pz: number, r = 1.5) => Math.hypot(x - px, z - pz) <= r;
const segD = (x: number, z: number, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - k * dx, z - a[1] - k * dz);
};

/** Lo que hay en (x, z): primero lo pequeño (puntos, cargas, zonas), después las cajas y el terreno */
export function hitTest(doc: Doc, x: number, z: number): Sel | null {
  if (doc.rigger && near(x, z, doc.rigger.x, doc.rigger.z)) return { list: 'rigger', i: 0 };
  if (near(x, z, doc.start.x, doc.start.z, 3)) return { list: 'start', i: 0 };
  const lamp = (doc.lamps ?? []).findIndex((p) => near(x, z, p[0], p[1]));
  if (lamp >= 0) return { list: 'lamps', i: lamp };
  const wk = (doc.workers ?? []).findIndex((w) => w.pts.some((p, k) => k > 0 && segD(x, z, w.pts[k - 1], p) < 1));
  if (wk >= 0) return { list: 'workers', i: wk };
  const c = doc.crates.findIndex((q) => inRect(x, z, q, 0.2));
  if (c >= 0) return { list: 'crates', i: c };
  const zn = doc.zones.findIndex((q) => inRect(x, z, q));
  if (zn >= 0) return { list: 'zones', i: zn };
  const ln = (doc.lines ?? []).findIndex((l) => segD(x, z, l.a, l.b) < 1.5);
  if (ln >= 0) return { list: 'lines', i: ln };
  for (let i = doc.boxes.length - 1; i >= 0; i--) if (inRect(x, z, doc.boxes[i])) return { list: 'boxes', i };
  const sf = (doc.soft ?? []).findIndex((q) => inRect(x, z, q));
  if (sf >= 0) return { list: 'soft', i: sf };
  return null;
}

/** Mueve lo seleccionado (dx, dz) */
export function moveSel(doc: Doc, s: Sel, dx: number, dz: number) {
  const W = doc.size?.[0] ?? 84, D = doc.size?.[1] ?? 56;
  const cx = (v: number) => r1(Math.max(0, Math.min(W, v))), cz = (v: number) => r1(Math.max(0, Math.min(D, v)));
  switch (s.list) {
    case 'start': doc.start.x = cx(doc.start.x + dx); doc.start.z = cz(doc.start.z + dz); return;
    case 'rigger': if (doc.rigger) { doc.rigger.x = cx(doc.rigger.x + dx); doc.rigger.z = cz(doc.rigger.z + dz); } return;
    case 'lamps': { const p = doc.lamps![s.i]; p[0] = cx(p[0] + dx); p[1] = cz(p[1] + dz); return; }
    case 'lines': { const l = doc.lines![s.i]; l.a = [cx(l.a[0] + dx), cz(l.a[1] + dz)]; l.b = [cx(l.b[0] + dx), cz(l.b[1] + dz)]; return; }
    case 'workers': { const w = doc.workers![s.i]; w.pts = w.pts.map(([x, z]) => [cx(x + dx), cz(z + dz)]); return; }
    default: { const o = (doc[s.list] as { x: number; z: number }[])[s.i]; o.x = cx(o.x + dx); o.z = cz(o.z + dz); }
  }
}

/** Borra lo seleccionado (la grúa no se borra) */
export function removeSel(doc: Doc, s: Sel) {
  if (s.list === 'start') return;
  if (s.list === 'rigger') { delete doc.rigger; return; }
  (doc[s.list] as unknown[]).splice(s.i, 1);
}

/** El objeto seleccionado (para el panel de propiedades) */
export function selObj(doc: Doc, s: Sel): Record<string, unknown> | null {
  if (s.list === 'start') return doc.start as unknown as Record<string, unknown>;
  if (s.list === 'rigger') return (doc.rigger ?? null) as Record<string, unknown> | null;
  if (s.list === 'lamps') return null;
  return ((doc[s.list] as unknown[] | undefined)?.[s.i] ?? null) as Record<string, unknown> | null;
}

/** Comprobación con el plan de izaje (fase 20): cada grúa permitida tiene sitio y llega con cada carga */
export function check(doc: Doc): { id: CraneId; ok: boolean; why: 'site' | 'reach' | null; label?: string }[] | null {
  const L = sanitizeLevel(doc);
  if (!L) return null;
  return L.cranes.map((id) => {
    const T = CRANES[id], S = initialState(T);
    placeCrane(T, S, L);
    const p = liftPlan(T, L, { x: S.x, z: S.z, h: S.h }, planConfigs(T, L));
    if (p.site) return { id, ok: false, why: 'site' as const };
    const bad = p.crates.find((c) => c.grade === 'no');
    return bad ? { id, ok: false, why: 'reach' as const, label: bad.crate.label } : { id, ok: true, why: null };
  });
}

/** Obras guardadas en este navegador */
const STORE = 'gruas-editor';
export interface SavedSite { name: string; code: string; at: number }
export function loadSaved(): SavedSite[] {
  try {
    const v = JSON.parse(typeof localStorage !== 'undefined' ? localStorage.getItem(STORE) ?? '[]' : '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.code === 'string' && typeof x.name === 'string') : [];
  } catch { return []; }
}
export function saveSite(name: string, code: string) {
  const list = loadSaved().filter((s) => s.name !== name);
  list.unshift({ name, code, at: Date.now() });
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 30))); } catch { /* sin almacenamiento */ }
}
