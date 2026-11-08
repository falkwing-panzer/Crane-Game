// Montajes de las grúas grandes: lastre (tecla B) y arriostramiento en Y (tecla Y).
// Lógica de toggleBallast(), toggleYGuy() y del avance en step() de la referencia.
// El estado va en CraneState (cw/cwT, yg/ygT) y lo que afecta a la estabilidad se pasa a CraneConfig
// (mCw, yOn), así CRANES no se modifica.

import type { CraneSpec } from './cranes';
import type { CraneInput, CraneState } from './kinematics';
import type { CraneConfig } from './stability';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Lo que hace falta saber de la carga para decidir si se puede montar o desmontar. */
export interface AssemblyCtx {
  /** Hay carga enganchada que no está apoyada */
  loadHanging: boolean;
}

/** Tecla B. Devuelve el mensaje para el operador. */
export function toggleBallast(T: CraneSpec, S: CraneState, ctx: AssemblyCtx): string {
  if (!T.ballast) return 'Esta grúa no monta lastre';
  if (!S.cwT) {
    if (S.out < 1) return 'Despliega los estabilizadores antes de montar el lastre';
    S.cwT = 1;
    return `Montando lastre · ${T.ballast.m} t`;
  }
  if (ctx.loadHanging) return 'Apoya la carga antes de desmontar el lastre';
  S.cwT = 0;
  return 'Desmontando lastre';
}

/** Tecla Y. Devuelve el mensaje para el operador. */
export function toggleYGuy(T: CraneSpec, S: CraneState, ctx: AssemblyCtx): string {
  if (!T.yguy) return 'Esta grúa no lleva arriostramiento en Y';
  if (S.out < 1) return 'Despliega los estabilizadores antes de montar el arriostramiento';
  if (S.Lb > T.boom.min + 0.3) return 'Retrae la pluma por completo para montar o plegar el arriostramiento';
  if (ctx.loadHanging) return 'Apoya la carga antes de mover el arriostramiento';
  S.ygT = S.ygT ? 0 : 1;
  return S.ygT ? 'Montando arriostramiento: brazos arriba → abrir → tensar' : 'Plegando arriostramiento';
}

/** Pasa el estado de montaje a la configuración de estabilidad (masa del contrapeso, Y-guy tensado). */
export function syncConfig(T: CraneSpec, S: CraneState, C: CraneConfig) {
  if (T.ballast) C.mCw = (T.cwBase ?? T.mCw) + T.ballast.m * S.cw;
  C.yOn = !!T.yguy && S.yg >= 1;
}

/** Avance de los montajes hacia su objetivo (como step() de la referencia). Devuelve un aviso o null. */
export function stepAssembly(T: CraneSpec, S: CraneState, C: CraneConfig, dt: number): string | null {
  let msg: string | null = null;
  if (T.ballast) {
    const b0 = S.cw, t = T.ballast.t;
    S.cw = clamp(S.cw + clamp(S.cwT - S.cw, -dt / t, dt / t), 0, 1);
    if (b0 < 1 && S.cw >= 1) msg = 'Lastre montado';
    if (b0 > 0 && S.cw <= 0) msg = 'Lastre desmontado';
  }
  if (T.yguy) {
    const g0 = S.yg, t = T.yguy.t;
    S.yg = clamp(S.yg + clamp(S.ygT - S.yg, -dt / t, dt / t), 0, 1);
    if (g0 < 1 && S.yg >= 1) msg = 'Arriostramiento tensado: pluma larga habilitada';
    if (g0 > 0 && S.yg <= 0) msg = 'Arriostramiento plegado';
  }
  syncConfig(T, S, C);
  return msg;
}

/** Montaje en curso (no está en la referencia para el lastre: allí solo la torre y el plumín bloqueaban). */
export function assembling(S: CraneState): 'lastre' | 'arriostramiento' | null {
  if (S.yg !== S.ygT) return 'arriostramiento';
  if (S.cw !== S.cwT) return 'lastre';
  return null;
}

/**
 * Mientras se monta no se mueve la grúa: anula giro, pluma, telescopio y cable.
 * Devuelve el aviso si el operador intentaba mover algo.
 */
export function blockWhileAssembling(S: CraneState, inp: CraneInput): string | null {
  const what = assembling(S);
  if (!what) return null;
  const tried = inp.slew || inp.luff || inp.tele || inp.hoist;
  inp.slew = inp.luff = inp.tele = inp.hoist = 0;
  return tried ? `Espera a que termine el montaje del ${what}` : null;
}

/** Largo máximo de pluma: sin el Y-guy tensado la pluma solo llega a yguy.teleMax. */
export function teleLimit(T: CraneSpec, S: CraneState) {
  return T.yguy && S.yg < 1 ? T.yguy.teleMax : T.boom.max;
}

/** Motivo por el que no se pueden recoger los estabilizadores (toggleOutriggers de la referencia), o null. */
export function outriggersLocked(S: CraneState): string | null {
  if (S.cw > 0 || S.cwT) return 'Desmonta el lastre antes de recoger los estabilizadores (B)';
  if (S.yg > 0 || S.ygT) return 'Pliega el arriostramiento antes de recoger los estabilizadores (Y)';
  return null;
}

/** Fase del Y-guy para el HUD (yGuyModel de la referencia: 0–0,5 brazos arriba, 0,5–0,8 abrir, 0,8–1 tensar). */
export function yGuyPhase(yg: number) {
  const p = Math.round(yg * 100);
  return yg >= 1 ? 'tensado' : yg <= 0 ? 'plegado' : yg < 0.5 ? `levantando ${p} %` : yg < 0.8 ? `abriendo ${p} %` : `tensando ${p} %`;
}
