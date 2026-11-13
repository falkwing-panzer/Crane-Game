import type { CraneState } from '../crane/kinematics';
import type { Pose, Quat, V3 } from '../crane/pose';
import type { Unit } from './session';

/**
 * Interpolación del dibujo (fase 15). La física va a 60 pasos fijos por segundo; la pantalla, a lo que dé (120 o
 * 144 Hz, o cuadros irregulares). Después de cada paso se guarda lo que se dibuja (estado de la grúa, pose, gancho,
 * cabeza y cargas) y se dibuja la mezcla del paso anterior y el último según el tiempo que sobró (`alpha`): un paso
 * de retraso (16 ms), sin tirones. No toca la simulación.
 */

/** Posición y giro de un cuerpo */
export interface BodyT { t: V3; q: Quat }

/** Lo que se dibuja de una grúa */
export interface UnitFrame {
  S: CraneState;
  pose: Pose;
  hook: BodyT;
  /** Ancla del cable (cabeza o punta del plumín) en el mundo */
  head: V3;
}

/** Lo que se dibuja de la partida: cada grúa y las cargas (en el orden de `phys.loads`) */
export interface Frame { units: UnitFrame[]; loads: BodyT[] }

/** Campos del estado que son decisiones, no movimiento: no se mezclan */
const DISCRETE = new Set(['edge', 'outT', 'cwT', 'ygT', 'jgT', 'erT']);

const v3 = (v: { x: number; y: number; z: number }): V3 => ({ x: v.x, y: v.y, z: v.z });
const q4 = (q: { x: number; y: number; z: number; w: number }): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w });

/** Copia campo a campo sobre `o` (reutiliza sus objetos anidados) */
function copyInto<T extends object>(o: T, b: T): T {
  const O = o as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const key in B) {
    const y = B[key];
    if (y && typeof y === 'object') {
      if (!O[key] || typeof O[key] !== 'object') O[key] = Array.isArray(y) ? [] : {};
      copyInto(O[key] as object, y as object);
    } else O[key] = y;
  }
  return o;
}

const setV = (o: V3, v: { x: number; y: number; z: number }) => { o.x = v.x; o.y = v.y; o.z = v.z; };
const setQ = (o: Quat, q: { x: number; y: number; z: number; w: number }) => { o.x = q.x; o.y = q.y; o.z = q.z; o.w = q.w; };

/** Lee lo que se dibuja sobre un cuadro ya creado con la misma forma (sin crear objetos en cada paso) */
function readInto(f: Frame, units: Unit[]) {
  units.forEach((u, i) => {
    const fu = f.units[i];
    copyInto(fu.S, u.S);
    setV(fu.pose.t, u.pose.t); setQ(fu.pose.q, u.pose.q);
    setV(fu.hook.t, u.phys.hookBody.translation()); setQ(fu.hook.q, u.phys.hookBody.rotation());
    setV(fu.head, u.phys.headWorld());
  });
  units[0].phys.loads.forEach((l, i) => { setV(f.loads[i].t, l.body.translation()); setQ(f.loads[i].q, l.body.rotation()); });
}

/** Lo que se dibuja ahora mismo (sin mezclar) */
export function readFrame(units: Unit[]): Frame {
  const phys = units[0].phys;
  return {
    units: units.map((u) => ({
      S: structuredClone(u.S),
      pose: { t: v3(u.pose.t), q: q4(u.pose.q) },
      hook: { t: v3(u.phys.hookBody.translation()), q: q4(u.phys.hookBody.rotation()) },
      head: v3(u.phys.headWorld()),
    })),
    loads: phys.loads.map((l) => ({ t: v3(l.body.translation()), q: q4(l.body.rotation()) })),
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpV = (a: V3, b: V3, k: number, o: V3) => { o.x = lerp(a.x, b.x, k); o.y = lerp(a.y, b.y, k); o.z = lerp(a.z, b.z, k); return o; };

/** Mezcla de dos giros (nlerp por el camino corto: entre dos pasos el giro es pequeño) */
export function nlerp(a: Quat, b: Quat, k: number, o: Quat): Quat {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  o.x = lerp(a.x, s * b.x, k); o.y = lerp(a.y, s * b.y, k); o.z = lerp(a.z, s * b.z, k); o.w = lerp(a.w, s * b.w, k);
  const n = Math.hypot(o.x, o.y, o.z, o.w) || 1;
  o.x /= n; o.y /= n; o.z /= n; o.w /= n;
  return o;
}

/** Mezcla campo a campo de dos objetos con la misma forma (números; lo demás, el último) */
export function mixInto<T extends object>(o: T, a: T, b: T, k: number): T {
  const O = o as Record<string, unknown>, A = a as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const key in B) {
    const x = A[key], y = B[key];
    if (typeof y === 'number' && typeof x === 'number' && !DISCRETE.has(key)) O[key] = lerp(x, y, k);
    else if (y && typeof y === 'object' && x && typeof x === 'object') {
      if (!O[key] || typeof O[key] !== 'object') O[key] = Array.isArray(y) ? [] : {};
      mixInto(O[key] as object, x as object, y as object, k);
    } else O[key] = y;
  }
  return o;
}

function mixBody(a: BodyT, b: BodyT, k: number, o: BodyT) {
  lerpV(a.t, b.t, k, o.t);
  nlerp(a.q, b.q, k, o.q);
}

/** Pares de cuadros (anterior y último paso) y la mezcla, sin crear objetos en cada cuadro */
export class Interp {
  private prev: Frame | null = null;
  private cur: Frame | null = null;
  private out: Frame | null = null;

  /** Después de cada paso de física: el último pasa a anterior y se lee el nuevo (dos búferes que se alternan) */
  capture(units: Unit[]) {
    if (!this.cur || !this.prev || this.prev === this.cur || !this.fits(this.prev, units)) { this.reset(units); return; }
    const old = this.prev;
    this.prev = this.cur;
    readInto(old, units);
    this.cur = old;
  }

  /** Salto (reiniciar, rebobinar, continuar): sin mezclar con lo de antes */
  reset(units: Unit[]) {
    this.cur = readFrame(units);
    this.prev = readFrame(units);
  }

  private fits(f: Frame, units: Unit[]) {
    return f.units.length === units.length && f.loads.length === units[0].phys.loads.length;
  }

  /** Lo que se dibuja con `alpha` = fracción del paso que ya pasó (0…1) */
  frame(units: Unit[], alpha: number): Frame {
    if (!this.cur || !this.fits(this.cur, units)) this.reset(units);
    const a = this.prev!, b = this.cur!, k = Math.max(0, Math.min(1, alpha));
    const o = (this.out ??= structuredClone(b));
    if (o.loads.length !== b.loads.length) this.out = structuredClone(b);
    const out = this.out!;
    b.units.forEach((bu, i) => {
      const au = a.units[i], ou = out.units[i];
      mixInto(ou.S, au.S, bu.S, k);
      lerpV(au.pose.t, bu.pose.t, k, ou.pose.t);
      nlerp(au.pose.q, bu.pose.q, k, ou.pose.q);
      mixBody(au.hook, bu.hook, k, ou.hook);
      lerpV(au.head, bu.head, k, ou.head);
    });
    b.loads.forEach((bl, i) => mixBody(a.loads[i], bl, k, out.loads[i]));
    return out;
  }
}
