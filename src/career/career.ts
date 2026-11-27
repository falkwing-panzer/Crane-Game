import { CRANES, type CraneId } from '../crane/cranes';
import { familyOf } from '../game/achievements';
import type { Licenses } from '../game/licenses';
import { rng } from '../decor/layout';
import { GEN_CRANES, doable, generateSite } from '../levels/generate';
import type { LevelEvent } from '../levels/events';
import type { Level } from '../levels/levels';
import { ALL_LEVELS } from '../levels/tandemSetup';

/**
 * Modo carrera (fase 25): dinero, flota, contratos, desgaste y averías. Sin DOM ni three.js: se prueba suelto (también
 * el equilibrio: `game/career.test.ts` juega 30 minutos de contratos). Valores del juego (aproximación).
 *
 * Equilibrio (euros de juego):
 * - Empiezas con 15 000 € y una City 25 en propiedad (y la licencia de ruedas).
 * - Alquiler de una grúa por contrato: R = 400 + 15 · carga máxima (t), redondeado a 50 € (City 25 800 €, AT 60
 *   1 300 €, AT 220 3 700 €, AT 300-6 4 900 €, AT 500-8 7 900 €). Comprarla: 30 · R (AT 60 39 000 €).
 * - Pago de un contrato: 1 200 + 25 · toneladas de las cargas + 1,5 · R de la grúa recomendada, por (0,7 + 0,1 ·
 *   estrellas) y + 5/10/15 % con medalla de suavidad bronce/plata/oro.
 * - Multas: golpe 300 €, aterrizaje duro 300 €, alarma de línea 1 000 €, carga sobre una persona 800 €, izaje sin
 *   lista 500 €, retraso de camiones 20 €/s. Fallar: sin pago y 1 500 € de multa; volcar una grúa propia, además la
 *   reparación (25 % de su precio); una alquilada, la franquicia (5 000 €).
 * - Desgaste: +10 por contrato en la grúa propia que trabaja; mantenimiento = 0,06 % del precio por punto. Con 60 o
 *   más, el contrato trae una avería (fuga o cable dañado); con 90 o más, dos.
 */

export interface Owned { id: CraneId; wear: number }

/** Una oferta: un nivel fijo (índice en ALL_LEVELS) o una obra generada (semilla) */
export type Offer = { kind: 'nivel'; li: number; pay: number } | { kind: 'obra'; seed: number; pay: number; cranes: CraneId[]; name: string };

export interface Career {
  v: 1;
  money: number;
  day: number;
  seed: number;
  fleet: Owned[];
  offers: Offer[];
  /** Contratos hechos y fallados, dinero ganado en total */
  done: number; failed: number; earned: number;
  /** Último resultado (para el cartel) */
  last: Settle | null;
}

export const START_MONEY = 15000;
export const START_CRANE: CraneId = 'small';
const r50 = (v: number) => Math.round(v / 50) * 50, r100 = (v: number) => Math.round(v / 100) * 100;

/** Alquiler por contrato y precio de compra */
export const rentOf = (id: CraneId) => r50(400 + 15 * CRANES[id].structMax);
export const priceOf = (id: CraneId) => 30 * rentOf(id);
/** Coste de mantenimiento de una grúa propia (vuelve el desgaste a 0) */
export const maintenanceOf = (o: Owned) => r50(0.0006 * priceOf(o.id) * o.wear);

/** Grúas que se pueden usar en la carrera: las de ruedas, orugas y torre (el tándem y la grúa auxiliar, no) */
export const CAREER_CRANES = Object.keys(CRANES) as CraneId[];

/** Pago base de un trabajo */
export function payFor(L: Level) {
  const t = L.crates.reduce((a, c) => a + c.m, 0);
  return r100(1200 + 25 * t + 1.5 * rentOf(L.rec));
}

/** Niveles fijos que pueden salir como contrato: sin tándem ni dos grúas */
export const CAREER_LEVELS = ALL_LEVELS.map((L, i) => ({ L, i })).filter(({ L }) => !L.tandem && !L.crew);

export function newCareer(seed = Date.now() % 1e9): Career {
  const c: Career = { v: 1, money: START_MONEY, day: 1, seed, fleet: [{ id: START_CRANE, wear: 0 }], offers: [], done: 0, failed: 0, earned: 0, last: null };
  c.offers = offersFor(c, { ruedas: 1 });
  return c;
}

/** Grúas con las que se puede trabajar: las de las familias con licencia (propias o de alquiler) */
export const usable = (lic: Licenses) => CAREER_CRANES.filter((id) => lic[familyOf(id)]);

/** Las grúas de un trabajo que se pueden usar ahora */
export const cranesFor = (L: Level, lic: Licenses) => L.cranes.filter((id) => usable(lic).includes(id));

/** Cuatro ofertas para el día: dos niveles fijos y dos obras generadas, todas posibles con alguna grúa usable */
export function offersFor(c: Career, lic: Licenses): Offer[] {
  const R = rng(c.seed * 31 + c.day * 7919);
  const fixed = CAREER_LEVELS.filter(({ L }) => cranesFor(L, lic).length > 0);
  const out: Offer[] = [];
  const pool = [...fixed];
  for (let k = 0; k < 2 && pool.length; k++) {
    const j = Math.floor(R() * pool.length) % pool.length, { L, i } = pool.splice(j, 1)[0];
    out.push({ kind: 'nivel', li: i, pay: payFor(L) });
  }
  const gen = GEN_CRANES.map((g) => g.id).filter((id) => usable(lic).includes(id));
  for (let k = 0; k < 2 && gen.length; k++) {
    const seed = Math.floor(R() * 1e9), name = `Obra ${c.day}-${k + 1}`;
    const L = generateSite(seed, { cranes: gen, type: 'Contrato', name });
    if (L) out.push({ kind: 'obra', seed, pay: payFor(L), cranes: gen, name });
  }
  return out;
}

/** La obra de una oferta (con las averías por desgaste de la grúa propia que vaya a usarse) */
export function offerLevel(o: Offer, wear = 0, seed = 0): Level | null {
  let L: Level | null;
  if (o.kind === 'nivel') L = ALL_LEVELS[o.li] ?? null;
  else L = generateSite(o.seed, { cranes: o.cranes, type: 'Contrato', name: o.name });
  if (!L) return null;
  const faults = wearFaults(wear, seed);
  return faults.length ? { ...L, events: [...(L.events ?? []), ...faults] } : L;
}

/** Averías por desgaste: con 60 o más, una; con 90 o más, dos (deterministas con la semilla del contrato) */
export function wearFaults(wear: number, seed: number): LevelEvent[] {
  const n = wear >= 90 ? 2 : wear >= 60 ? 1 : 0;
  const R = rng(seed + 17);
  const out: LevelEvent[] = [];
  for (let i = 0; i < n; i++) {
    const t = 60 + Math.floor(R() * 120) + i * 90;
    out.push(R() < 0.5 ? { kind: 'leak', t, dur: 50 } : { kind: 'cable', t, dur: 9999 });
  }
  return out;
}

/** Lo que pasó en un contrato (lo que la carrera necesita del turno) */
export interface Outcome {
  ok: boolean; stars: number; medal: 'oro' | 'plata' | 'bronce' | null;
  bumps: number; hard: number; prox: number; excl: number; skips: number; late: number; tipped: boolean;
}

export interface Settle { pay: number; fines: { what: string; eur: number }[]; rent: number; repair: number; total: number; crane: CraneId; ok: boolean }

/** Cuentas de un contrato */
export function settle(o: Offer, crane: CraneId, owned: boolean, out: Outcome): Settle {
  const fines: Settle['fines'] = [];
  const add = (what: string, n: number, eur: number) => { if (n > 0) fines.push({ what, eur: Math.round(n * eur) }); };
  add('golpes', out.bumps, 300);
  add('aterrizajes duros', out.hard, 300);
  add('alarmas de línea', out.prox, 1000);
  add('carga sobre personas', out.excl, 800);
  add('izajes sin lista', out.skips, 500);
  add('retraso de camiones (s)', out.late, 20);
  if (!out.ok) fines.push({ what: 'contrato fallado', eur: 1500 });
  const bonus = { oro: 0.15, plata: 0.1, bronce: 0.05 }[out.medal ?? 'x' as never] ?? 0;
  const pay = out.ok ? r50(o.pay * (0.7 + 0.1 * out.stars) * (1 + bonus)) : 0;
  const rent = owned ? 0 : rentOf(crane);
  const repair = out.tipped ? (owned ? r50(priceOf(crane) * 0.25) : 5000) : 0;
  const total = pay - rent - repair - fines.reduce((a, f) => a + f.eur, 0);
  return { pay, fines, rent, repair, total, crane, ok: out.ok };
}

/** Aplica un contrato a la carrera: dinero, desgaste, día siguiente y ofertas nuevas */
export function finish(c: Career, s: Settle, lic: Licenses) {
  c.money += s.total;
  c.earned += Math.max(0, s.total);
  if (s.ok) c.done++; else c.failed++;
  const o = c.fleet.find((f) => f.id === s.crane);
  if (o) o.wear = Math.min(100, o.wear + 10);
  c.day++;
  c.last = s;
  c.offers = offersFor(c, lic);
}

/** Comprar, vender (al 60 %) y mantener */
export function buy(c: Career, id: CraneId) {
  const p = priceOf(id);
  if (c.money < p || c.fleet.some((f) => f.id === id)) return false;
  c.money -= p;
  c.fleet.push({ id, wear: 0 });
  return true;
}
export function sell(c: Career, id: CraneId) {
  const i = c.fleet.findIndex((f) => f.id === id);
  if (i < 0 || c.fleet.length === 1) return false;
  c.money += r50(priceOf(id) * 0.6 * (1 - c.fleet[i].wear / 200));
  c.fleet.splice(i, 1);
  return true;
}
export function maintain(c: Career, id: CraneId) {
  const o = c.fleet.find((f) => f.id === id);
  if (!o || !o.wear) return false;
  const cost = maintenanceOf(o);
  if (c.money < cost) return false;
  c.money -= cost;
  o.wear = 0;
  return true;
}

/** Comprobación: cada oferta se puede hacer con alguna grúa usable */
export function offerDoable(o: Offer, lic: Licenses) {
  const L = offerLevel(o);
  if (!L) return false;
  const ids = cranesFor(L, lic);
  return ids.length > 0 && (o.kind === 'nivel' || ids.some((id) => doable(id, L)));
}

// --- guardado ---

const KEY = 'gruas-carrera';
const store = () => (typeof window !== 'undefined' && typeof localStorage !== 'undefined' ? localStorage : null);

export function loadCareer(): Career | null {
  try {
    const v = JSON.parse(store()?.getItem(KEY) ?? 'null');
    return isCareer(v) ? v : null;
  } catch { return null; }
}
export function saveCareer(c: Career) {
  try { store()?.setItem(KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}
export function clearCareer() { try { store()?.removeItem(KEY); } catch { /* nada */ } }

export function isCareer(v: unknown): v is Career {
  const c = v as Career;
  return !!c && c.v === 1 && Number.isFinite(c.money) && Number.isFinite(c.day) && Array.isArray(c.fleet) && Array.isArray(c.offers)
    && c.fleet.every((f) => f && typeof f.id === 'string' && f.id in CRANES && Number.isFinite(f.wear));
}

/** Exportar a texto (archivo) e importar */
export const exportCareer = (c: Career) => JSON.stringify(c, null, 1);
export function importCareer(text: string): Career | null {
  try { const v = JSON.parse(text); return isCareer(v) ? v : null; } catch { return null; }
}
