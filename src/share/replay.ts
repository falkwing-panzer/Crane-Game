import { sessionDef, type SessionDef } from '../game/session';
import type { GameStep } from '../game/step';
import type { Session } from '../game/session';
import { cached, codeOf, pack } from './codec';

// Fase 28: repeticiones completas. Una repetición son las entradas de cada paso de un turno (la grabación de la fase
// 15) y la URL de la obra: al abrirla se monta la misma partida y se vuelve a simular con esas entradas (la simulación
// es determinista en el mismo navegador; entre máquinas distintas no está garantizado, y se avisa).

export interface ReplayData {
  v: 1;
  /** Búsqueda de la partida (?nivel=3&grua=medium, ?reto=…, ?obra=…) */
  s: string;
  /** Tramos de la grabación (Recording.toJSON) */
  rec: unknown[];
  /** Cabecera para el cartel (nivel y grúa) y tiempo del turno */
  head: string;
  t: number;
}

const isReplay = (v: unknown): v is ReplayData => {
  const r = v as ReplayData;
  return !!r && r.v === 1 && typeof r.s === 'string' && r.s.startsWith('?') && Array.isArray(r.rec) && typeof r.head === 'string';
};

/** La repetición de esta URL (?repeticion=código o ?repeticion=h#código), si ya está descomprimida */
export function replayOf(search: string, hash = ''): ReplayData | null {
  const v = cached(codeOf(new URLSearchParams(search), 'repeticion', hash));
  return isReplay(v) ? v : null;
}

/** La partida de una repetición: la misma de siempre, con las entradas grabadas (null si no es un nivel) */
export function replayDef(r: ReplayData): SessionDef | null {
  const def = sessionDef(r.s);
  if (!def.L) return null;
  def.replay = { rec: r.rec, head: r.head };
  return def;
}

/**
 * Enlace para compartir la repetición del turno que acaba de terminar (null si no se puede: el turno siguió una
 * partida guardada o se rebobinó, y la grabación no empieza en el principio). Va detrás de #: puede ser larga.
 */
export async function shareLink(ses: Session, game: GameStep, search: string, head: string): Promise<string | null> {
  if (!game.cleanRun) return null;
  const s = new URLSearchParams(search);
  for (const k of ['continuar', 'repeticion', 'fps', 'calidad', 'pr']) s.delete(k);
  const data: ReplayData = { v: 1, s: `?${s.toString()}`, rec: game.rec.toJSON(), head, t: ses.run.t };
  const code = await pack(data);
  return `${location.origin}${location.pathname}?repeticion=h#${code}`;
}
