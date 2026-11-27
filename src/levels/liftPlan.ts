import { bodyHalf, type CraneSpec } from '../crane/cranes';
import { OUT_LIFT, tipPos } from '../crane/kinematics';
import { baseConfig, lmiStatic, ratedCap, reach, type CraneConfig, type SupportMode } from '../crane/stability';
import { angleFor } from '../crane/loadChart';
import { padsOnSoft, terrainBlocked } from '../crane/terrain';
import { crateBases, levelBoxes, levelSize, levelSofts } from './setup';
import type { Level, LevelBox, LevelCrate } from './levels';
import { t } from '../i18n';

// Plan de izaje (fase 20; no está en la referencia): un "fantasma" de la grúa en la planta de la obra y, para cada
// carga, la mejor capacidad en el radio de recogida y en el de destino, con la grúa montada (estabilizadores, lastre,
// Y-guy y, donde se puede, plumín y superlift). Usa el mismo modelo de estabilidad que el LMI (ratedCap, lmiStatic) y la
// misma geometría que la física (tipPos, pie de pluma, apoyo). Sin three.js ni Rapier.

const D = Math.PI / 180;
const tp = t.plan;

/** Verde si la carga con el gancho no pasa de esta parte de la capacidad */
export const PLAN_MARGIN = 0.8;
/** Altura que hace falta sobre lo alto de la carga hasta la punta: eslinga, gancho y el metro del doble bloqueo */
export const RIG_H = 3;
/** Altura libre del chasis y medio lado de cada zapata (los de Physics: carrierBlocked y padsBlocked) */
const CLEARANCE = 0.35, PAD = 0.6;

/** Pose del fantasma: origen del chasis y rumbo (como S.x, S.z, S.h) */
export interface Ghost { x: number; z: number; h: number }

/** Del mundo al marco del chasis: radio desde el eje de giro y giro (como lmiStatic y headPos) */
export function toCrane(T: CraneSpec, g: Ghost, px: number, pz: number) {
  const c = Math.cos(g.h), s = Math.sin(g.h), dx = px - g.x, dz = pz - g.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const rx = lx - T.piv;
  return { R: Math.hypot(rx, lz), slew: Math.atan2(-lz, rx) };
}

/** Del marco del chasis al mundo */
export function toWorld(g: Ghost, lx: number, lz: number): [number, number] {
  const c = Math.cos(g.h), s = Math.sin(g.h);
  return [g.x + c * lx + s * lz, g.z - s * lx + c * lz];
}

/** Configuraciones que el jugador puede montar en este nivel (las del plan) */
export function planConfigs(T: CraneSpec, L: Level): CraneConfig[] {
  const C0 = baseConfig(T);
  const C: CraneConfig = { ...C0, mCw: T.ballast ? (T.cwBase ?? T.mCw) + T.ballast.m : C0.mCw, yOn: !!T.yguy };
  const out: CraneConfig[] = [C];
  if (T.superlift && T.superlift.rMax !== C.slR) out.push({ ...C, slR: T.superlift.rMax });
  if (T.jibDef && L.jib) {
    const J = T.jibDef;
    for (let a = J.relMin; a <= J.relMax + 1e-9; a += 15 * D) out.push({ ...C, jib: J, jibRel: a });
  }
  return out;
}

export const planMode = (T: CraneSpec): SupportMode => (T.crawler ? 'crawler' : 'out');

/** Un izaje posible: capacidad, largo, ángulo y configuración que la dan */
export interface Lift { cap: number; Lb: number; ang: number; C: CraneConfig; tipH: number }

/** Largos de pluma que se prueban (cada metro y el máximo) */
function lengths(T: CraneSpec) {
  const out: number[] = [];
  for (let L = T.boom.min; L < T.boom.max; L += 1) out.push(L);
  out.push(T.boom.max);
  return out;
}

/**
 * La mejor capacidad (t, con el gancho) para llevar el gancho a radio R y giro slew con la punta a needH o más alta,
 * o null si no se llega. Grúa torre: el carro da el radio con cada ángulo de la pluma.
 */
export function bestLift(T: CraneSpec, configs: CraneConfig[], R: number, slew: number, needH: number): Lift | null {
  const md = planMode(T), lift = md === 'out' ? OUT_LIFT : 0;
  let best: Lift | null = null;
  for (const C of configs) {
    const poses: { Lb: number; ang: number }[] = [];
    if (T.tower) {
      for (let a = T.boom.angMin; a <= T.boom.angMax + 1e-9; a += 2 * D) {
        const Lb = (R - T.foot) / Math.cos(a);
        if (Lb >= T.boom.min && Lb <= T.boom.max) poses.push({ Lb, ang: a });
      }
    } else {
      for (const Lb of lengths(T)) {
        const ang = angleFor(T, C, Lb, R);
        if (ang !== null) poses.push({ Lb, ang });
      }
    }
    for (const p of poses) {
      const tip = tipPos(T, { ...p, slew, jg: C.jib ? 1 : 0, jibRel: C.jibRel, er: 1 });
      const tipH = tip.y + lift;
      if (tipH < needH) continue;
      // primero si mejora con la capacidad estructural (barato); después la búsqueda de ratedCap
      if (best && lmiStatic(T, C, md, p.Lb, p.ang, slew, best.cap) >= 1) continue;
      const cap = ratedCap(T, C, md, p.Lb, p.ang, slew);
      if (!best || cap > best.cap) best = { cap, Lb: p.Lb, ang: p.ang, C, tipH };
    }
  }
  return best;
}

export type Grade = 'ok' | 'tight' | 'no';
/** need = carga + gancho (t) */
export function grade(lift: Lift | null, need: number): Grade {
  if (!lift || lift.cap < need) return 'no';
  return need <= lift.cap * PLAN_MARGIN ? 'ok' : 'tight';
}
const RANK: Record<Grade, number> = { no: 0, tight: 1, ok: 2 };

export interface PointPlan { x: number; z: number; R: number; lift: Lift | null; grade: Grade; label: string }
export interface CratePlan {
  crate: LevelCrate; need: number;
  pick: PointPlan;
  /** destino: la zona más fácil (o, en pilas, la más difícil: hay que usarlas todas) */
  place: PointPlan | null;
  grade: Grade;
}
export interface Plan { site: string | null; crates: CratePlan[] }

function point(T: CraneSpec, configs: CraneConfig[], g: Ghost, x: number, z: number, needH: number, need: number, label: string): PointPlan {
  const { R, slew } = toCrane(T, g, x, z);
  const lift = bestLift(T, configs, R, slew, needH);
  return { x, z, R, lift, grade: grade(lift, need), label };
}

/** Altura de punta que pide una carga en su peor punto (recogida o la zona más alta) */
export function crateNeedH(L: Level, k: number, bases = crateBases(L)) {
  const c = L.crates[k];
  return Math.max(bases[k], ...L.zones.map((z) => z.y)) + c.h + RIG_H;
}

/** El plan entero para el fantasma g */
export function liftPlan(T: CraneSpec, L: Level, g: Ghost, configs = planConfigs(T, L)): Plan {
  const boxes = levelBoxes(L), bases = crateBases(L, boxes);
  const crates = L.crates.map((c, i): CratePlan => {
    const need = c.m + T.hookM;
    const pick = point(T, configs, g, c.x, c.z, bases[i] + c.h + RIG_H, need, c.label);
    const zones = L.zones.map((zn) => point(T, configs, g, zn.x, zn.z, zn.y + c.h + RIG_H, need, zn.label));
    const stack = L.zones.some((zn) => zn.stack !== undefined);
    const place = zones.length ? zones.reduce((a, b) => ((stack ? RANK[b.grade] < RANK[a.grade] : RANK[b.grade] > RANK[a.grade]) ? b : a)) : null;
    const gr = place && RANK[place.grade] < RANK[pick.grade] ? place.grade : pick.grade;
    return { crate: c, need, pick, place, grade: gr };
  });
  return { site: siteProblem(T, L, g, boxes), crates };
}

// --- sitio para la grúa ---------------------------------------------------------------------------------------------

/** Caja en planta con su altura de fondo (y0) y de arriba (h) */
type Rect = { cx: number; cz: number; hx: number; hz: number; h: number; y0: number };

/** ¿Se tocan un rectángulo girado (marco del chasis) y una caja alineada con los ejes? (ejes separadores; tocarse justo
 * en el borde cuenta, como en Rapier) */
function hitsBox(g: Ghost, lx0: number, lx1: number, lz0: number, lz1: number, b: Rect) {
  const corners = [[lx0, lz0], [lx1, lz0], [lx1, lz1], [lx0, lz1]].map(([x, z]) => toWorld(g, x, z));
  const bx = [b.cx - b.hx, b.cx + b.hx], bz = [b.cz - b.hz, b.cz + b.hz];
  // ejes del mundo
  if (Math.max(...corners.map((p) => p[0])) < bx[0] || Math.min(...corners.map((p) => p[0])) > bx[1]) return false;
  if (Math.max(...corners.map((p) => p[1])) < bz[0] || Math.min(...corners.map((p) => p[1])) > bz[1]) return false;
  // ejes del chasis: la caja en el marco del chasis
  const c = Math.cos(g.h), s = Math.sin(g.h);
  const loc = [[bx[0], bz[0]], [bx[1], bz[0]], [bx[1], bz[1]], [bx[0], bz[1]]].map(([x, z]) => {
    const dx = x - g.x, dz = z - g.z;
    return [c * dx - s * dz, s * dx + c * dz];
  });
  if (Math.max(...loc.map((p) => p[0])) < lx0 || Math.min(...loc.map((p) => p[0])) > lx1) return false;
  if (Math.max(...loc.map((p) => p[1])) < lz0 || Math.min(...loc.map((p) => p[1])) > lz1) return false;
  return true;
}

/**
 * Motivo por el que la grúa no cabe ahí, o null: chasis (u orugas) y zapatas contra los edificios, las cargas, el
 * borde de la obra y el terreno blando, con las medidas de carrierBlocked y padsBlocked de la física.
 */
export function siteProblem(T: CraneSpec, L: Level, g: Ghost, boxes: LevelBox[] = levelBoxes(L)): string | null {
  const [W, Dp] = levelSize(L);
  const bases = crateBases(L, boxes);
  const solids: Rect[] = [
    ...boxes.map((b) => ({ cx: b.x, cz: b.z, hx: b.w / 2, hz: b.d / 2, h: b.h, y0: 0 })),
    ...L.crates.map((c, i) => ({ cx: c.x, cz: c.z, hx: c.w / 2, hz: c.d / 2, h: bases[i] + c.h, y0: bases[i] })),
  ];
  const out = (x: number, z: number, m: number) => x < m || z < m || x > W - m || z > Dp - m;
  const [L0, L1] = T.len, hw = bodyHalf(T);
  for (const lx of [L0, L1]) for (const lz of [-hw, hw]) {
    const [x, z] = toWorld(g, lx, lz);
    if (out(x, z, 0.3)) return tp.bounds;
  }
  const soft = terrainBlocked(T, levelSofts(L), g.x, g.z, g.h);
  if (soft) return soft;
  if (solids.some((b) => b.h > CLEARANCE && b.y0 < T.deckHi && hitsBox(g, L0, L1, -hw, hw, b))) return tp.chassis;
  const o = T.out;
  if (o) {
    for (const lx of [o.xf, o.xr]) for (const lz of [-o.hw, o.hw]) {
      const [x, z] = toWorld(g, lx, lz);
      if (out(x, z, 0)) return tp.padsOut;
      if (solids.some((b) => b.h > 0.05 && b.y0 < 1.05 && hitsBox(g, lx - PAD, lx + PAD, lz - PAD, lz + PAD, b))) return tp.pads;
    }
    const s = padsOnSoft(T, levelSofts(L), g.x, g.z, g.h);
    if (s) return s;
  }
  return null;
}

/**
 * Radio útil en un giro: el mayor radio donde la carga need cabe con capacidad ≥ need/frac y la punta queda a needH o
 * más alta.
 */
export function usefulRadius(T: CraneSpec, configs: CraneConfig[], slew: number, need: number, frac = 1, needH = 0) {
  const md = planMode(T), lift = md === 'out' ? OUT_LIFT : 0;
  const r1 = Math.max(...configs.map((C) => reach(T, C, T.boom.max, T.boom.angMin)));
  const fits = (C: CraneConfig, Lb: number, ang: number) =>
    tipPos(T, { Lb, ang, slew, jg: C.jib ? 1 : 0, jibRel: C.jibRel, er: 1 }).y + lift >= needH &&
    lmiStatic(T, C, md, Lb, ang, slew, need / frac) < 1;
  const can = (R: number) => {
    for (const C of configs) {
      if (T.tower) {
        for (let a = T.boom.angMin; a <= T.boom.angMax + 1e-9; a += 5 * D) {
          const Lb = (R - T.foot) / Math.cos(a);
          if (Lb >= T.boom.min && Lb <= T.boom.max && fits(C, Lb, a)) return true;
        }
        continue;
      }
      for (const Lb of lengths(T)) {
        const ang = angleFor(T, C, Lb, R);
        if (ang !== null && fits(C, Lb, ang)) return true;
      }
    }
    return false;
  };
  // de fuera hacia dentro a pasos de 2 m hasta el primer radio que sirve; después, más fino
  let R = Math.floor(r1);
  while (R > 0 && !can(R)) R -= 2;
  if (R <= 0) return 0;
  let lo = R, hi = Math.min(R + 2, r1);
  for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (can(m)) lo = m; else hi = m; }
  return lo;
}

/**
 * Contorno del radio útil (marco del chasis, desde el eje de giro) en n giros, sin plumín, con la punta a needH. El apoyo es simétrico a los lados:
 * se calcula la mitad y se refleja.
 */
export function usefulContour(T: CraneSpec, configs: CraneConfig[], need: number, frac = 1, n = 36, needH = 0) {
  // sin plumín: con sus ángulos el cálculo tardaría ~0,5 s, y el contorno es orientativo (no mira alturas)
  const noJib = configs.filter((c) => !c.jib);
  if (noJib.length) configs = noJib;
  const half = Array.from({ length: n / 2 + 1 }, (_, i) => usefulRadius(T, configs, (i / n) * 2 * Math.PI, need, frac, needH));
  return Array.from({ length: n }, (_, i) => ({ slew: (i / n) * 2 * Math.PI, R: half[i <= n / 2 ? i : n - i] }));
}

