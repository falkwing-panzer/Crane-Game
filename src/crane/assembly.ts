// Montajes de las grúas grandes: lastre (tecla B) y arriostramiento en Y (tecla Y).
// Lógica de toggleBallast(), toggleYGuy() y del avance en step() de la referencia.
// El estado va en CraneState (cw/cwT, yg/ygT) y lo que afecta a la estabilidad se pasa a CraneConfig
// (mCw, yOn), así CRANES no se modifica.

import type { CraneSpec } from './cranes';
import { carrierLift, type CraneInput, type CraneState } from './kinematics';
import type { CraneConfig } from './stability';

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
  if (!T.ballast) return 'Esta grúa no monta lastre';
  if (!S.cwT) {
    if (S.out < 1) return 'Despliega los estabilizadores antes de montar el lastre';
    if (ctx.tailBlocked) return 'No hay sitio para el lastre: el contrapeso tocaría un obstáculo';
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
    if (S.out < 1) return 'Despliega los estabilizadores antes de montar la grúa torre';
    if (ctx.loadAttached) return 'Suelta la carga antes de mover la torre';
    if (S.erT && (S.Lb > T.boom.min + 0.5 || S.ang > 2 * D)) return 'Para plegar: carro adentro (Q) y pluma horizontal (S)';
    if (S.erT && Math.abs(Math.atan2(Math.sin(S.slew), Math.cos(S.slew))) > 3 * D) return 'Gira la pluma hacia delante (0°) antes de plegar';
    S.erT = S.erT ? 0 : 1;
    return S.erT ? 'Montando: levantar torre → telescopar → desplegar pluma' : 'Plegando la grúa torre';
  }
  if (!T.jibDef) return 'Esta grúa no lleva plumín';
  if (S.out < 1) return 'Despliega los estabilizadores antes de montar el plumín';
  if (ctx.loadAttached) return 'Suelta la carga antes de montar o desmontar el plumín';
  if (S.Lb > T.boom.min + 0.3 || S.ang > 10 * D) return 'Para el plumín: pluma retraída del todo y casi horizontal (menos de 10°)';
  if (S.jgT && S.jg >= 1 && S.jibRel < S.ang + 3 * D) return 'Baja el plumín hasta el suelo (G) antes de desmontarlo';
  // (no está en la referencia) los tramos se arman en el suelo delante de la cabeza: tiene que haber sitio
  if (!S.jgT && ctx.groundBlocked) return ctx.groundBlocked;
  S.jgT = S.jgT ? 0 : 1;
  return S.jgT ? 'Montaje del plumín: tramos en el suelo → bulonar → puntales → tensar' : 'Desmontando el plumín';
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
      msg = 'Grúa torre montada';
      S.cable = Math.max(1.5, Math.min(S.cable, 4));
      S.v.cable = 0;
    }
    if (e0 > 0 && S.er <= 0) msg = 'Grúa torre plegada para transporte';
  }
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
      msg = 'Plumín montado y tensado: súbelo con la pluma (W) y T/G';
    }
    // al empezar a desmontarlo, el cable vuelve a la cabeza de la pluma
    if (g0 >= 1 && S.jg < 1) { S.cable = 4; S.v.cable = 0; }
    if (g0 > 0 && S.jg <= 0) msg = 'Plumín desmontado';
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
  if (what === 'torre') return S.er > 0 || S.erT ? 'Espera a que termine el montaje' : 'Monta la grúa torre primero (M)';
  return `Espera a que termine el montaje del ${what}`;
}

/** Largo máximo de pluma: sin el Y-guy tensado la pluma solo llega a yguy.teleMax. */
export function teleLimit(T: CraneSpec, S: CraneState) {
  return T.yguy && S.yg < 1 ? T.yguy.teleMax : T.boom.max;
}

/** Motivo por el que no se pueden recoger los estabilizadores (toggleOutriggers de la referencia), o null. */
export function outriggersLocked(S: CraneState): string | null {
  if (S.cw > 0 || S.cwT) return 'Desmonta el lastre antes de recoger los estabilizadores (B)';
  if (S.yg > 0 || S.ygT) return 'Pliega el arriostramiento antes de recoger los estabilizadores (Y)';
  if (S.jg > 0 || S.jgT) return 'Desmonta el plumín antes de recoger los estabilizadores (M)';
  if (S.er > 0 || S.erT) return 'Desmonta la torre antes de recoger los estabilizadores (M)';
  return null;
}

/** Fase del Y-guy para el HUD (yGuyModel de la referencia: 0–0,5 brazos arriba, 0,5–0,8 abrir, 0,8–1 tensar). */
export function yGuyPhase(yg: number) {
  const p = Math.round(yg * 100);
  return yg >= 1 ? 'tensado' : yg <= 0 ? 'plegado' : yg < 0.5 ? `levantando ${p} %` : yg < 0.8 ? `abriendo ${p} %` : `tensando ${p} %`;
}

/** Fase del montaje del plumín para el HUD (dibujo de la referencia: tramos hasta 45 %, bulonar, puntales 60–85 %, tensar). */
export function jibPhase(jg: number) {
  const p = Math.round(jg * 100);
  return jg >= 1 ? 'montado' : jg <= 0 ? 'desmontado' : jg < 0.45 ? `tramos en el suelo ${p} %`
    : jg < 0.6 ? `bulonando ${p} %` : jg < 0.85 ? `puntales ${p} %` : `tensando ${p} %`;
}

/** Fase del montaje de la grúa torre para el HUD (tramos de towerGeom: levantar 0–45 %, telescopar 45–70 %, pluma). */
export function towerPhase(er: number, erT: number) {
  const p = Math.round(er * 100);
  if (er >= 1) return 'montada';
  if (er <= 0 && !erT) return 'plegada';
  return er < 0.45 ? `levantando torre ${p} %` : er < 0.7 ? `telescopando ${p} %` : `desplegando pluma ${p} %`;
}
