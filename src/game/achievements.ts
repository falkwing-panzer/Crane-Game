import { CRANES, isCrawler } from '../crane/cranes';
import type { Stats } from '../ui/progress';
import { medalFor } from './smooth';

/**
 * Logros (fase 22): cada uno mira las estadísticas guardadas, los récords, las notas de suavidad, la escuela y, si
 * hace falta, lo que acaba de pasar (un izaje, un nivel ganado, un vuelco). Sin DOM: se prueba suelto.
 */

/** Lo que acaba de pasar */
export type AchEvent =
  | { kind: 'lift'; mass: number; jib: boolean; slMax: boolean }
  | { kind: 'win'; li: number; t: number; par: number; maxLmi: number; glass: boolean; glassMax: number; smooth: number | null }
  | { kind: 'tip'; bypass: boolean }
  | { kind: 'tick' };

export interface AchCtx {
  st: Stats;
  /** Récords por índice de nivel */
  rec: Record<number, { stars: number; time: number }>;
  /** Mejor suavidad por índice de nivel */
  smooth: Record<number, number>;
  /** Lecciones de la escuela hechas */
  school: number[];
  /** Niveles que hay (14) y lecciones (6) */
  nLevels: number; nLessons: number;
  ev: AchEvent;
}

export type AchGroup = 'inicio' | 'constancia' | 'maestria' | 'gruas' | 'curiosos';

export interface Achievement {
  id: string;
  group: AchGroup;
  test: (c: AchCtx) => boolean;
}

/** Familia de una grúa (las licencias de la parte C usarán lo mismo) */
export const familyOf = (id: string): 'ruedas' | 'orugas' | 'torre' => {
  const T = CRANES[id as keyof typeof CRANES];
  return !T ? 'ruedas' : T.tower ? 'torre' : isCrawler(T) ? 'orugas' : 'ruedas';
};

const famSecs = (st: Stats, f: string) => Object.entries(st.secs).reduce((a, [id, s]) => a + (familyOf(id) === f ? s : 0), 0);
const win = (c: AchCtx) => (c.ev.kind === 'win' ? c.ev : null);
const lift = (c: AchCtx) => (c.ev.kind === 'lift' ? c.ev : null);
const golds = (c: AchCtx) => Object.values(c.smooth).filter((s) => medalFor(s) === 'oro').length;
const range = (n: number) => [...Array(n).keys()];
/** El nivel de tándem (14) */
const TANDEM_LI = 13;

export const ACHIEVEMENTS: Achievement[] = [
  // primeros pasos
  { id: 'primer-izaje', group: 'inicio', test: (c) => c.st.lifts >= 1 },
  { id: 'primer-nivel', group: 'inicio', test: (c) => c.st.levels >= 1 },
  { id: 'escuela', group: 'inicio', test: (c) => range(c.nLessons).every((i) => c.school.includes(i + 1)) },
  { id: 'tandem', group: 'inicio', test: (c) => win(c)?.li === TANDEM_LI || !!c.rec[TANDEM_LI] },
  // constancia
  { id: 'izajes-50', group: 'constancia', test: (c) => c.st.lifts >= 50 },
  { id: 'limpio-25', group: 'constancia', test: (c) => c.st.bestClean >= 25 },
  { id: 'limpio-100', group: 'constancia', test: (c) => c.st.bestClean >= 100 },
  { id: 't-1000', group: 'constancia', test: (c) => c.st.tons >= 1000 },
  { id: 't-10000', group: 'constancia', test: (c) => c.st.tons >= 10000 },
  { id: 'km-10', group: 'constancia', test: (c) => c.st.meters >= 10000 },
  // maestría
  { id: 'lmi-80', group: 'maestria', test: (c) => { const w = win(c); return !!w && w.li === TANDEM_LI && w.maxLmi <= 0.8; } },
  { id: 'vidrio', group: 'maestria', test: (c) => { const w = win(c); return !!w && w.glass && w.glassMax <= 0.2; } },
  { id: 'rapido', group: 'maestria', test: (c) => { const w = win(c); return !!w && w.t <= w.par / 2; } },
  { id: 'seda', group: 'maestria', test: (c) => { const w = win(c); return !!w && (w.smooth ?? 0) >= 95; } },
  { id: 'oro-1', group: 'maestria', test: (c) => golds(c) >= 1 },
  { id: 'oro-5', group: 'maestria', test: (c) => golds(c) >= 5 },
  { id: 'todos', group: 'maestria', test: (c) => range(c.nLevels).every((i) => !!c.rec[i]) },
  { id: 'tres-todos', group: 'maestria', test: (c) => range(c.nLevels).every((i) => (c.rec[i]?.stars ?? 0) >= 3) },
  // grúas
  { id: 'ruedas-1h', group: 'gruas', test: (c) => famSecs(c.st, 'ruedas') >= 3600 },
  { id: 'orugas-1h', group: 'gruas', test: (c) => famSecs(c.st, 'orugas') >= 3600 },
  { id: 'torre-1h', group: 'gruas', test: (c) => famSecs(c.st, 'torre') >= 3600 },
  { id: 'flota', group: 'gruas', test: (c) => Object.keys(CRANES).every((id) => (c.st.secs[id] ?? 0) >= 60) },
  { id: 'plumin', group: 'gruas', test: (c) => !!lift(c)?.jib },
  { id: 'superlift', group: 'gruas', test: (c) => !!lift(c)?.slMax },
  { id: 'pesado', group: 'gruas', test: (c) => c.st.heaviest >= 300 },
  // curiosos
  { id: 'puenteado', group: 'curiosos', test: (c) => c.ev.kind === 'tip' && c.ev.bypass },
  { id: 'amarre', group: 'curiosos', test: (c) => c.st.tiedMeters >= 1000 },
];

/** Los logros que se consiguen ahora (los que ya estaban no se repiten) */
export function newAchievements(c: AchCtx, have: Record<string, number>): string[] {
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.test(c)).map((a) => a.id);
}

