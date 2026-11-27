import { CRANES, type CraneId } from '../crane/cranes';
import type { Level } from '../levels/levels';
import { ALL_LEVELS } from '../levels/tandemSetup';
import { familyOf } from './achievements';

/**
 * Licencias de operador (fase 22). Cuatro familias: ruedas, orugas, torre (cada una con su examen en la escuela,
 * ?escuela=7…9; terminar las seis lecciones también da la de ruedas) y tándem, que se da al tener ruedas y orugas y
 * haber completado el nivel 13 (la LR 3000): un examen con dos grúas no cabe en la escuela.
 * Un nivel queda bloqueado si ninguna de sus grúas tiene licencia (el de tándem pide la de tándem). Opción "Todo
 * desbloqueado" en Opciones. Quien ya tenía récords de antes recibe las licencias de las familias con las que terminó
 * algún nivel (nadie encuentra cerrado lo que ya jugó). Sin DOM salvo el almacenamiento.
 */

export type Family = 'ruedas' | 'orugas' | 'torre' | 'tandem';
export const FAMILIES: Family[] = ['ruedas', 'orugas', 'torre', 'tandem'];
export type Licenses = Partial<Record<Family, number>>;

const KEY = 'gruas-licencias';
const LR_LI = 12;

const storage = () => (typeof window !== 'undefined' && typeof localStorage !== 'undefined' ? localStorage : null);

/** Licencias que da lo ya hecho: récords de niveles y escuela terminada */
export function earned(rec: Record<number, unknown>, school: number[], lic: Licenses = {}): Licenses {
  const out: Licenses = { ...lic }, now = Date.now();
  for (const i of Object.keys(rec).map(Number)) {
    const L = ALL_LEVELS[i];
    if (!L) continue;
    if (L.tandem) { out.tandem ??= now; continue; }
    for (const id of L.cranes) out[familyOf(id)] ??= now;
  }
  if ([1, 2, 3, 4, 5, 6].every((n) => school.includes(n))) out.ruedas ??= now;
  if (out.ruedas && out.orugas && rec[LR_LI]) out.tandem ??= now;
  return out;
}

/** Las guardadas; la primera vez, las que da lo hecho antes de esta fase */
export function loadLicenses(rec: Record<number, unknown>, school: number[]): Licenses {
  const st = storage();
  let lic: Licenses | null = null;
  try { lic = JSON.parse(st?.getItem(KEY) ?? 'null'); } catch { lic = null; }
  if (!lic || typeof lic !== 'object') {
    lic = earned(rec, school);
    saveLicenses(lic);
  }
  return lic;
}

export function saveLicenses(l: Licenses) {
  try { storage()?.setItem(KEY, JSON.stringify(l)); } catch { /* sin almacenamiento */ }
}

/** Da una licencia (y la de tándem si ya se cumple); devuelve las nuevas */
export function grant(lic: Licenses, f: Family | null, rec: Record<number, unknown>, school: number[]): Family[] {
  const before = new Set(Object.keys(lic));
  const next = earned(rec, school, f ? { ...lic, [f]: lic[f] ?? Date.now() } : lic);
  const added = FAMILIES.filter((k) => next[k] && !before.has(k));
  Object.assign(lic, next);
  if (added.length) saveLicenses(lic);
  return added;
}

/** ¿Se puede usar esta grúa? */
export const craneOk = (id: CraneId, lic: Licenses, all: boolean) => all || !!lic[familyOf(id)];

/** ¿Está abierto este nivel? Con alguna grúa permitida con licencia (tándem: la de tándem) */
export function levelOpen(L: Level, lic: Licenses, all: boolean) {
  if (all) return true;
  if (L.tandem) return !!lic.tandem;
  return L.cranes.some((id) => craneOk(id, lic, false));
}

/** La familia que falta para un nivel (la de la grúa recomendada) */
export const missingFor = (L: Level): Family => (L.tandem ? 'tandem' : familyOf(L.rec));

/** Para la tabla: cuántas grúas de cada familia */
export const familyCranes = (f: Family) => Object.keys(CRANES).filter((id) => f !== 'tandem' && familyOf(id) === f);
