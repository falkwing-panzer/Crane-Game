// Montajes de las grúas grandes: lastre (tecla B) y arriostramiento en Y (tecla Y).
// Lógica de toggleBallast(), toggleYGuy() y del avance en step() de la referencia.
// El estado va en CraneState (cw/cwT, yg/ygT) y lo que afecta a la estabilidad se pasa a CraneConfig
// (mCw, yOn), así CRANES no se modifica.

import type { CraneSpec } from './cranes';
import { carrierLift, type CraneInput, type CraneState } from './kinematics';
import type { CraneConfig } from './stability';
import { t } from '../i18n';

const a = t.assembly;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Lo que hace falta saber de la carga para decidir si se puede montar o desmontar. */
export interface AssemblyCtx {
  /** Hay carga enganchada que no está apoyada */
  loadHanging: boolean;
  /** Choque del lastre completo con algo (al montarlo), o null */
  tailBlocked?: string | null;
}

/** Tecla B. Devuelve el mensaje para el operador. */
export function toggleBallast(T: CraneSpec, S: CraneState, ctx: AssemblyCtx): string {
  if (!T.ballast) return a.noBallast;
  if (!S.cwT) {
    if (S.out < 1) return a.ballastOut;
    if (ctx.tailBlocked) return a.ballastBlocked;
    S.cwT = 1;
    return a.ballastMounting(T.ballast.m);
  }
  if (ctx.loadHanging) return a.ballastHanging;
  S.cwT = 0;
  return a.ballastUnmounting;
}

/** Tecla Y. Devuelve el mensaje para el operador. */
export function toggleYGuy(T: CraneSpec, S: CraneState, ctx: AssemblyCtx): string {
  if (!T.yguy) return a.noYGuy;
  if (S.out < 1) return a.yguyOut;
  if (S.Lb > T.boom.min + 0.3) return a.yguyRetract;
  if (ctx.loadHanging) return a.yguyHanging;
  S.ygT = S.ygT ? 0 : 1;
  return S.ygT ? a.yguyMounting : a.yguyFolding;
}

/** Pasa el estado de montaje a la configuración de estabilidad (masa del contrapeso, Y-guy tensado, plumín). */
export function syncConfig(T: CraneSpec, S: CraneState, C: CraneConfig) {
  if (T.ballast) C.mCw = (T.cwBase ?? T.mCw) + T.ballast.m * S.cw;
  C.yOn = !!T.yguy && S.yg >= 1;
  C.jib = T.jibDef && S.jg >= 1 ? T.jibDef : null;
  C.jibRel = S.jibRel;
}

const D = Math.PI / 180;
/** Altura de la punta del plumín al terminar de montarlo (referencia: el plumín queda apoyado, punta a 0,7 m) */
export const JIB_REST_H = 0.7;

export interface MountCtx {
  /** Hay carga enganchada (apoyada o no) */
  loadAttached: boolean;
  /** Motivo por el que no se puede armar el plumín en el suelo delante de la cabeza, o null */
  groundBlocked: string | null;
}

/** Tecla M: montar o desmontar la grúa torre o el plumín (toggleMount de la referencia). Devuelve el mensaje para el operador. */
export function toggleMount(T: CraneSpec, S: CraneState, ctx: MountCtx): string {
  if (T.tower) {
    if (S.out < 1) return a.towerOut;
    if (ctx.loadAttached) return a.towerLoad;
    if (S.erT && (S.Lb > T.boom.min + 0.5 || S.ang > 2 * D)) return a.towerFoldPose;
    if (S.erT && Math.abs(Math.atan2(Math.sin(S.slew), Math.cos(S.slew))) > 3 * D) return a.towerFoldSlew;
    S.erT = S.erT ? 0 : 1;
    return S.erT ? a.towerMounting : a.towerFolding;
  }
  if (!T.jibDef) return a.noJib;
  if (S.out < 1) return a.jibOut;
  if (ctx.loadAttached) return a.jibLoad;
  if (S.Lb > T.boom.min + 0.3 || S.ang > 10 * D) return a.jibPose;
  if (S.jgT && S.jg >= 1 && S.jibRel < S.ang + 3 * D) return a.jibLower;
  // (no está en la referencia) los tramos se arman en el suelo delante de la cabeza: tiene que haber sitio
  if (!S.jgT && ctx.groundBlocked) return ctx.groundBlocked;
  S.jgT = S.jgT ? 0 : 1;
  return S.jgT ? a.jibMounting : a.jibUnmounting;
}

/**
 * Avance de los montajes hacia su objetivo (como step() de la referencia). Devuelve un aviso o null.
 * `towerHit` (no está en la referencia, que solo avisaba del golpe): cuánto tocan la torre y su pluma con el entorno;
 * si el paso del montaje las hace tocar más, se deshace (el montaje se detiene hasta que haya sitio).
 */
export function stepAssembly(T: CraneSpec, S: CraneState, C: CraneConfig, dt: number,
  towerHit?: (S: CraneState) => { n: number; what: string }): string | null {
  let msg: string | null = null;
  if (T.tower && S.er !== S.erT) {
    const e0 = S.er, t = T.tower.t, h0 = towerHit ? towerHit(S).n : 0;
    S.er = clamp(S.er + clamp(S.erT - S.er, -dt / t, dt / t), 0, 1);
    const h = towerHit?.(S);
    if (h && h.n > h0 + 1e-9) { S.er = e0; return h.what; }
    if (e0 < 1 && S.er >= 1) {
      msg = a.towerUp;
      S.cable = Math.max(1.5, Math.min(S.cable, 4));
      S.v.cable = 0;
    }
    if (e0 > 0 && S.er <= 0) msg = a.towerDown;
  }
  if (T.ballast) {
    const b0 = S.cw, t = T.ballast.t;
    S.cw = clamp(S.cw + clamp(S.cwT - S.cw, -dt / t, dt / t), 0, 1);
    if (b0 < 1 && S.cw >= 1) msg = a.ballastUp;
    if (b0 > 0 && S.cw <= 0) msg = a.ballastDown;
  }
  if (T.yguy) {
    const g0 = S.yg, t = T.yguy.t;
    S.yg = clamp(S.yg + clamp(S.ygT - S.yg, -dt / t, dt / t), 0, 1);
    if (g0 < 1 && S.yg >= 1) msg = a.yguyUp;
    if (g0 > 0 && S.yg <= 0) msg = a.yguyDown;
  }
  const jd = T.jibDef;
  if (jd) {
    const g0 = S.jg;
    S.jg = clamp(S.jg + clamp(S.jgT - S.jg, -dt / jd.t, dt / jd.t), 0, 1);
    if (g0 < 1 && S.jg >= 1) {
      // como la referencia: el plumín queda apoyado, con la punta a 0,7 m del suelo
      const hy = T.pivH + S.Lb * Math.sin(S.ang) + carrierLift(S);
      S.jibRel = clamp(S.ang + Math.asin(clamp((hy - JIB_REST_H) / jd.len, 0, 1)), jd.relMin, jd.relMax);
      // el cable pasa a la punta del plumín: el gancho queda en el suelo junto a ella, con el cable flojo
      S.cable = 3;
      S.v.cable = 0;
      msg = a.jibUp;
    }
    // al empezar a desmontarlo, el cable vuelve a la cabeza de la pluma
    if (g0 >= 1 && S.jg < 1) { S.cable = 4; S.v.cable = 0; }
    if (g0 > 0 && S.jg <= 0) msg = a.jibDown;
  }
  syncConfig(T, S, C);
  return msg;
}

/** Montaje en curso (no está en la referencia para el lastre: allí solo la torre y el plumín bloqueaban). */
export function assembling(S: CraneState, T?: CraneSpec): 'torre' | 'lastre' | 'arriostramiento' | 'plumín' | null {
  if (T?.tower && S.er < 1) return 'torre';
  if (S.jg !== S.jgT) return 'plumín';
  if (S.yg !== S.ygT) return 'arriostramiento';
  if (S.cw !== S.cwT) return 'lastre';
  return null;
}

/**
 * Mientras se monta no se mueve la grúa: anula giro, pluma, telescopio y cable.
 * Devuelve el aviso si el operador intentaba mover algo.
 */
export function blockWhileAssembling(S: CraneState, inp: CraneInput, T?: CraneSpec): string | null {
  const what = assembling(S, T);
  if (!what) return null;
  const tried = inp.slew || inp.luff || inp.tele || inp.hoist || inp.jib;
  inp.slew = inp.luff = inp.tele = inp.hoist = inp.jib = 0;
  if (!tried) return null;
  // grúa torre plegada: sin montar no hay giro, pluma, carro ni cable (referencia)
  if (what === 'torre') return S.er > 0 || S.erT ? a.waitTower : a.mountTower;
  return a.wait[what];
}

/** Largo máximo de pluma: sin el Y-guy tensado la pluma solo llega a yguy.teleMax. */
export function teleLimit(T: CraneSpec, S: CraneState) {
  return T.yguy && S.yg < 1 ? T.yguy.teleMax : T.boom.max;
}

/** Motivo por el que no se pueden recoger los estabilizadores (toggleOutriggers de la referencia), o null. */
export function outriggersLocked(S: CraneState): string | null {
  if (S.cw > 0 || S.cwT) return a.lockBallast;
  if (S.yg > 0 || S.ygT) return a.lockYGuy;
  if (S.jg > 0 || S.jgT) return a.lockJib;
  if (S.er > 0 || S.erT) return a.lockTower;
  return null;
}

/** Fase del Y-guy para el HUD (yGuyModel de la referencia: 0–0,5 brazos arriba, 0,5–0,8 abrir, 0,8–1 tensar). */
export function yGuyPhase(yg: number) {
  const p = Math.round(yg * 100);
  const y = a.yguyPhase;
  return yg >= 1 ? y.done : yg <= 0 ? y.off : yg < 0.5 ? y.up(p) : yg < 0.8 ? y.open(p) : y.tension(p);
}

/** Fase del montaje del plumín para el HUD (dibujo de la referencia: tramos hasta 45 %, bulonar, puntales 60–85 %, tensar). */
export function jibPhase(jg: number) {
  const p = Math.round(jg * 100);
  const j = a.jibPhase;
  return jg >= 1 ? j.done : jg <= 0 ? j.off : jg < 0.45 ? j.ground(p) : jg < 0.6 ? j.pin(p) : jg < 0.85 ? j.struts(p) : j.tension(p);
}

/** Fase del montaje de la grúa torre para el HUD (tramos de towerGeom: levantar 0–45 %, telescopar 45–70 %, pluma). */
export function towerPhase(er: number, erT: number) {
  const p = Math.round(er * 100);
  const w = a.towerPhase;
  if (er >= 1) return w.done;
  if (er <= 0 && !erT) return w.off;
  return er < 0.45 ? w.raise(p) : er < 0.7 ? w.tele(p) : w.boom(p);
}
