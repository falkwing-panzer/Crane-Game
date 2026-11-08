// Conducción del portador: controlador cinemático (bicicleta) como la parte "conducción" de step() en la
// referencia. No se usa el vehicle controller de Rapier: la grúa de pie es cinemática y su estabilidad la
// decide el modelo analítico; un chasis dinámico de decenas de toneladas sobre raycasts temblaría y volcaría
// por su cuenta. Los choques se resuelven antes de mover (callback `blocked`, consulta de Rapier).

import type { CraneSpec } from './cranes';
import type { CraneState } from './kinematics';

export interface DriveInput {
  /** +1 adelante (↑), −1 atrás (↓) */
  throttle: number;
  /** +1 izquierda (←), −1 derecha (→) */
  steer: number;
  fine: boolean;
}

export interface DriveCtx {
  /** Hay carga enganchada que no está apoyada (susp de la referencia) */
  loadHanging: boolean;
  /** LMI estático en modo "move" (orugas: "crawlMove") con gancho + carga (para el pick & carry) */
  lmiMove: number;
  /** Grúa inclinada (phi > 0,002) */
  tilted: boolean;
  /** LMI puenteado (tecla P): no se bloquea el desplazamiento por LMI */
  bypass?: boolean;
  /** ¿La pose (x, z, h) choca con algo? Devuelve el motivo o null */
  blocked?: (x: number, z: number, h: number) => string | null;
}

export interface DriveResult {
  /** Mensaje para el operador, si lo hay */
  msg: string | null;
  /** El LMI impidió desplazarse */
  lmiCut: boolean;
  /** Choque a más de 1,2 m/s (strike de la referencia) */
  hit: boolean;
}

/** Velocidad a partir de la cual la grúa está "en marcha" (mode() de la referencia). */
export const MOVING = 0.05;
/** Fracción de la velocidad máxima con carga colgando (referencia: 0,3 sobre ruedas) */
export const CARRY_SPEED = 0.3;
/** Orugas con carga colgando: velocidad al 45 % y giro al 50 % (referencia) */
export const CRAWL_CARRY_SPEED = 0.45;
export const CRAWL_CARRY_TURN = 0.5;
const FINE = 0.3;
/** Velocidad de giro del volante (rad/s) */
const STEER_RATE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Velocidad de giro del rumbo (rad/s) con la dirección actual; dirección en todos los ejes = el doble. */
export function yawRate(T: CraneSpec, v: number, steer: number) {
  return (v * Math.tan(steer)) / T.wheelbase! * (T.allSteer ? 2 : 1);
}

/** Radio de giro mínimo (m) del origen del chasis. */
export function minTurnRadius(T: CraneSpec) {
  return T.wheelbase! / (Math.tan(T.steerMax!) * (T.allSteer ? 2 : 1));
}

export function stepDrive(T: CraneSpec, S: CraneState, inp: DriveInput, dt: number, ctx: DriveCtx): DriveResult {
  if (T.crawler) return stepCrawl(T, S, inp, dt, ctx);
  const res: DriveResult = { msg: null, lmiCut: false, hit: false };
  if (!T.wheelbase || !T.steerMax) return res;
  const fk = inp.fine ? FINE : 1;
  let thr = inp.throttle, str = inp.steer;
  if (thr && S.out > 0) { thr = 0; str = 0; res.msg = 'Recoge los estabilizadores para conducir (O)'; }
  if (ctx.tilted) thr = 0;
  if (thr && ctx.loadHanging && !ctx.bypass && ctx.lmiMove >= 1) {
    thr = 0; res.lmiCut = true;
    res.msg = 'LMI: con esta carga no puedes desplazarte. Acerca la carga (más ángulo).';
  }
  const vmax = T.spd.drive * fk * (ctx.loadHanging ? CARRY_SPEED : 1);
  const acc = thr ? 1.2 : 2.4;
  S.vd += clamp(thr * vmax - S.vd, -acc * dt, acc * dt);
  S.steer += clamp(str * T.steerMax - S.steer, -STEER_RATE * dt, STEER_RATE * dt);
  const dh = yawRate(T, S.vd, S.steer);
  if (Math.abs(S.vd) > 1e-4 || Math.abs(dh) > 1e-5) {
    const nh = S.h + dh * dt;
    const nx = S.x + Math.cos(nh) * S.vd * dt, nz = S.z - Math.sin(nh) * S.vd * dt;
    const why = ctx.blocked?.(nx, nz, nh) ?? null;
    if (why) {
      if (Math.abs(S.vd) > 1.2 && why.includes('obstáculo')) { res.hit = true; res.msg = 'El chasis chocó con un obstáculo'; }
      else res.msg = why;
      S.vd = 0;
    } else { S.x = nx; S.z = nz; S.h = nh; }
  }
  S.spin += (S.vd * dt) / (T.wheelR ?? 0.7);
  return res;
}

/**
 * Orugas (step() de la referencia con T.crawler): sin dirección, giran en el sitio a spd.turn con ←/→
 * (al revés en marcha atrás, como un coche). Con carga colgando: 45 % de velocidad, 50 % de giro, y el LMI
 * en "crawlMove" impide tanto avanzar como girar.
 */
function stepCrawl(T: CraneSpec, S: CraneState, inp: DriveInput, dt: number, ctx: DriveCtx): DriveResult {
  const res: DriveResult = { msg: null, lmiCut: false, hit: false };
  const fk = inp.fine ? FINE : 1;
  let thr = inp.throttle, str = inp.steer;
  S.turnKey = str !== 0;
  if (ctx.tilted) { thr = 0; str = 0; }
  if ((thr || str) && ctx.loadHanging && !ctx.bypass && ctx.lmiMove >= 1) {
    thr = 0; str = 0; res.lmiCut = true;
    res.msg = 'LMI: con esta carga no puedes desplazarte. Acerca la carga (más ángulo).';
  }
  const vmax = T.spd.drive * fk * (ctx.loadHanging ? CRAWL_CARRY_SPEED : 1);
  const acc = thr ? 1.2 : 2.4;
  S.vd += clamp(thr * vmax - S.vd, -acc * dt, acc * dt);
  const dh = str * (T.spd.turn ?? 0) * fk * (ctx.loadHanging ? CRAWL_CARRY_TURN : 1) * (S.vd < -MOVING ? -1 : 1);
  if (Math.abs(S.vd) > 1e-4 || Math.abs(dh) > 1e-5) {
    const nh = S.h + dh * dt;
    const nx = S.x + Math.cos(nh) * S.vd * dt, nz = S.z - Math.sin(nh) * S.vd * dt;
    const why = ctx.blocked?.(nx, nz, nh) ?? null;
    if (why) {
      if (Math.abs(S.vd) > 1.2 && why.includes('obstáculo')) { res.hit = true; res.msg = 'El chasis chocó con un obstáculo'; }
      else res.msg = why;
      S.vd = 0;
    } else {
      // cada oruga avanza v ∓ ω·z (la izquierda está en −z): girando en el sitio van en sentidos opuestos
      const zc = T.track!.hw - (T.trackW ?? 1) / 2;
      S.trackL += (S.vd - ((nh - S.h) / dt) * zc) * dt;
      S.trackR += (S.vd + ((nh - S.h) / dt) * zc) * dt;
      S.x = nx; S.z = nz; S.h = nh;
    }
  }
  return res;
}

/**
 * Suspensión simple: el chasis cabecea con la aceleración y se balancea hacia fuera en las curvas
 * (resorte amortiguado, tope de 1°). Valores de aproximación visual: no están en la referencia.
 * `aLong` = aceleración longitudinal (m/s²), la lateral sale de v·ω.
 */
export function stepSuspension(T: CraneSpec, S: CraneState, aLong: number, dt: number) {
  if (!T.wheelbase) return; // orugas: sin suspensión (la referencia no tiene)
  const MAX = Math.PI / 180;
  const aLat = S.vd * yawRate(T, S.vd, S.steer); // + hacia la izquierda
  const tp = clamp(0.006 * aLong, -MAX, MAX); // acelerar levanta el morro
  const tb = clamp(0.009 * aLat, -MAX, MAX); // curva a la izquierda: se inclina a la derecha (+z)
  const w = 5, z = 0.6, s = S.sus;
  s.vp += (w * w * (tp - s.pitch) - 2 * z * w * s.vp) * dt;
  s.vb += (w * w * (tb - s.bank) - 2 * z * w * s.vb) * dt;
  s.pitch += s.vp * dt;
  s.bank += s.vb * dt;
  if (Math.abs(s.pitch) < 1e-6 && Math.abs(s.vp) < 1e-6) s.pitch = s.vp = 0;
  if (Math.abs(s.bank) < 1e-6 && Math.abs(s.vb) < 1e-6) s.bank = s.vb = 0;
}

/**
 * Ángulo de cada eje (rad, + izquierda) como el dibujo de la referencia: los ejes delanteros según su
 * posición; con dirección en todos los ejes, los traseros (a < −2 m) en contrafase al 80 %.
 */
export function axleSteer(T: CraneSpec, a: number, steer: number) {
  const ax = T.axles!;
  if (a > 0) return steer * (a / ax[ax.length - 1]);
  if (T.allSteer && a < -2) return -steer * (Math.abs(a) / Math.abs(ax[0])) * 0.8;
  return 0;
}
