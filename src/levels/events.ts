// Clima que cambia y averías durante el turno (fase 24, parte B). Sin three.js ni Rapier. Todo es función del reloj
// del turno (determinista, sin estado: va solo en las instantáneas). Solo en niveles nuevos o en la carrera, nunca en
// los 14 de antes. Valores del juego (la referencia no tiene clima ni averías).

export type LevelEvent =
  /** Ráfaga: v m/s más durante dur s (sube y baja suave); el anemómetro la anuncia 10 s antes */
  | { kind: 'gust'; t: number; v: number; dur: number }
  /** Tormenta con rayos: a los 20 s de empezar, pluma por debajo de 30° y nada colgando, o falla */
  | { kind: 'storm'; t: number; dur: number }
  /** Niebla: se ve hasta `dist` m (solo dibujo) */
  | { kind: 'fog'; t: number; dur: number; dist: number }
  /** Averías: anemómetro sin dato; fuga hidráulica (la pluma baja sola); cable dañado (capacidad al 50 %) */
  | { kind: 'anemo' | 'leak' | 'cable'; t: number; dur: number };

/** Tiempo de aviso de una ráfaga (s), margen de la tormenta (s) y ángulo máximo de pluma en tormenta */
export const GUST_WARN = 10, STORM_GRACE = 20, STORM_ANG = (30 * Math.PI) / 180;
/** La fuga hidráulica baja la pluma (rad/s); con la carga colgada más de LEAK_T s desde que empieza, falla */
export const LEAK_RATE = (0.35 * Math.PI) / 180, LEAK_T = 45;
/** Capacidad con el cable dañado (fracción) */
export const CABLE_K = 0.5;

const on = (e: LevelEvent, t: number) => t >= e.t && t < e.t + e.dur;

/** Viento añadido por las ráfagas en el instante t (m/s): sube y baja como sin² */
export function gustAt(evs: LevelEvent[] | undefined, t: number) {
  let v = 0;
  for (const e of evs ?? []) {
    if (e.kind !== 'gust' || !on(e, t)) continue;
    const s = Math.sin((Math.PI * (t - e.t)) / e.dur);
    v += e.v * s * s;
  }
  return v;
}

/** El evento de ese tipo que está activo (o null) */
export const active = (evs: LevelEvent[] | undefined, kind: LevelEvent['kind'], t: number) =>
  (evs ?? []).find((e) => e.kind === kind && on(e, t)) ?? null;

/** Ráfagas que hay que anunciar en el paso que va de t0 a t1 (cruzan su aviso) */
export const gustWarnings = (evs: LevelEvent[] | undefined, t0: number, t1: number) =>
  (evs ?? []).filter((e): e is Extract<LevelEvent, { kind: 'gust' }> => e.kind === 'gust' && t0 < e.t - GUST_WARN && t1 >= e.t - GUST_WARN);

/** Eventos que empiezan en el paso que va de t0 a t1 */
export const starting = (evs: LevelEvent[] | undefined, t0: number, t1: number) => (evs ?? []).filter((e) => t0 < e.t && t1 >= e.t);

/** Factor de capacidad (1, o 0,5 con el cable dañado) */
export const capFactor = (evs: LevelEvent[] | undefined, t: number) => (active(evs, 'cable', t) ? CABLE_K : 1);
