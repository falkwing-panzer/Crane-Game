import type { GameSnap, GameStep } from '../game/step';
import type { Session } from '../game/session';
import type { CraneId } from '../crane/cranes';

/**
 * Partida guardada a mitad de un nivel (fase 15): una por nivel, en localStorage, con la grúa con la que se jugaba.
 * Es la instantánea de la partida (el mundo de Rapier en base64 y el resto en JSON). Cuenta para los récords (es la
 * misma partida: el reloj sigue donde estaba). Se borra al terminar el nivel (victoria o fallo).
 */

/** Cambia si cambia la forma de la instantánea: las guardadas de antes se descartan */
// 2 (fase 17): el mundo lleva los colisionadores del decorado; las partidas guardadas antes no valen
const VERSION = 2;
const key = (nivel: number) => `gruas-guardado-${nivel}`;

export interface SavedGame { v: number; nivel: number; crane: CraneId; t: number; snap: GameSnap }

function toB64(u: Uint8Array) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

// JSON no tiene NaN ni ±Infinity (los guarda como null): van como {"$n": "Infinity"}
const replacer = (_: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? { $n: String(v) } : v);
const reviver = (_: string, v: unknown) => (v && typeof v === 'object' && '$n' in v ? Number((v as { $n: string }).$n) : v);

/** Texto guardable de una instantánea */
export function encodeSnap(s: GameSnap): string {
  return JSON.stringify({ ...s, phys: { ...s.phys, world: toB64(s.phys.world) } }, replacer);
}

export function decodeSnap(txt: string): GameSnap {
  const o = JSON.parse(txt, reviver);
  o.phys.world = fromB64(o.phys.world);
  return o as GameSnap;
}

/** Guarda la partida del nivel en marcha; false si no cupo */
export function saveGame(ses: Session, game: GameStep): boolean {
  const nivel = ses.def.nivel;
  if (!nivel) return false;
  const snap = game.snapshot();
  const txt = JSON.stringify({ v: VERSION, nivel, crane: ses.units[0].id, t: ses.run.t, snap: '' })
    .replace('"snap":""', () => `"snap":${encodeSnap(snap)}`);
  try { localStorage.setItem(key(nivel), txt); return true; } catch { return false; }
}

/** La partida guardada de un nivel (null si no hay o es de una versión vieja) */
export function loadSave(nivel: number): SavedGame | null {
  try {
    const txt = localStorage.getItem(key(nivel));
    if (!txt) return null;
    const o = JSON.parse(txt, reviver);
    if (o.v !== VERSION || o.nivel !== nivel) return null;
    o.snap.phys.world = fromB64(o.snap.phys.world);
    return o as SavedGame;
  } catch { return null; }
}

export function clearSave(nivel: number) {
  try { localStorage.removeItem(key(nivel)); } catch { /* sin almacenamiento */ }
}
