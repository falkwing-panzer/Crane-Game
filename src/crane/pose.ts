// Pose del portador en el mundo: posición y rumbo de la conducción, elevación por estabilizadores,
// giro alrededor de la arista de vuelco y suspensión. Marco del chasis: x hacia delante, y arriba,
// −z a la izquierda, origen sobre el suelo. Sin dependencias de three.js para usarla en física y pruebas.

import type { CraneSpec } from './cranes';
import { supportRect, type SupportMode } from './stability';
import { carrierLift, type CraneState } from './kinematics';

export interface V3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export interface Pose { t: V3; q: Quat }

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function rotate(q: Quat, p: V3): V3 {
  const ix = q.w * p.x + q.y * p.z - q.z * p.y;
  const iy = q.w * p.y + q.z * p.x - q.x * p.z;
  const iz = q.w * p.z + q.x * p.y - q.y * p.x;
  const iw = -q.x * p.x - q.y * p.y - q.z * p.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export function mul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Cuaternión de un giro de `a` rad alrededor del eje unitario (x, y, z). */
export function axisAngle(x: number, y: number, z: number, a: number): Quat {
  const s = Math.sin(a / 2);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(a / 2) };
}

/** Punto del marco del chasis → mundo */
export function apply(P: Pose, p: V3): V3 {
  const r = rotate(P.q, p);
  return { x: r.x + P.t.x, y: r.y + P.t.y, z: r.z + P.t.z };
}

/**
 * Arista de vuelco en el marco del chasis (sobre el suelo): un punto y el eje de giro (unitario) tal que
 * un ángulo positivo inclina la grúa hacia fuera del apoyo. Índices como tipEdge().
 */
export function edgeAxis(T: CraneSpec, md: SupportMode, edge: number): { p: V3; axis: V3 } {
  const r = supportRect(T, md);
  switch (edge) {
    case 0: return { p: { x: r.xf, y: 0, z: 0 }, axis: { x: 0, y: 0, z: -1 } }; // vuelca hacia +x
    case 1: return { p: { x: r.xr, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 } }; // hacia −x
    case 2: return { p: { x: 0, y: 0, z: -r.hw }, axis: { x: -1, y: 0, z: 0 } }; // hacia −z (izquierda)
    default: return { p: { x: 0, y: 0, z: r.hw }, axis: { x: 1, y: 0, z: 0 } }; // hacia +z
  }
}

/** A∘B: primero B, luego A. */
export function compose(A: Pose, B: Pose): Pose {
  return { t: apply(A, B.t), q: mul(A.q, B.q) };
}

/** Inclinación de un plano de pendientes (b = dy/dx, c = dy/dz): giro que lleva la vertical a su normal */
export function slopeQuat(b: number, c: number): Quat {
  const n = Math.hypot(b, 1, c), nx = -b / n, ny = 1 / n, nz = -c / n;
  // de (0, 1, 0) a n: eje (0,1,0) × n = (nz, 0, −nx), w = 1 + ny (normalizado)
  const k = Math.hypot(nz, nx, 1 + ny);
  return { x: nz / k, y: 0, z: -nx / k, w: (1 + ny) / k };
}

/**
 * Marco del portador en el suelo: posición y rumbo de la conducción y, desde la fase 18, la altura y la inclinación
 * del terreno bajo el chasis (gy, gb, gc; sin ellos o en 0, el suelo plano de siempre, con los mismos números).
 */
export function carrierFrame(S: Pick<CraneState, 'x' | 'z' | 'h'> & Partial<Pick<CraneState, 'gy' | 'gb' | 'gc'>>): Pose {
  const yaw = axisAngle(0, 1, 0, S.h);
  const gb = S.gb ?? 0, gc = S.gc ?? 0;
  return { t: { x: S.x, y: S.gy ?? 0, z: S.z }, q: gb || gc ? mul(yaw, slopeQuat(gb, gc)) : yaw };
}

/** Punto del mundo → marco del portador en el suelo (inverso de carrierFrame; y no cambia). */
export function worldToCarrier(S: Pick<CraneState, 'x' | 'z' | 'h'>, p: { x: number; z: number }) {
  const dx = p.x - S.x, dz = p.z - S.z, c = Math.cos(S.h), s = Math.sin(S.h);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Altura del centro de giro de la suspensión (aproximación: altura de los ejes). */
const SUS_Y = 0.75;

/** Pose del portador en el marco del chasis: elevación y phi (modelo analítico). */
function standPose(T: CraneSpec, S: CraneState, md: SupportMode): Pose {
  const lift = carrierLift(S);
  if (S.phi <= 0 || S.edge < 0) return { t: { x: 0, y: lift, z: 0 }, q: IDENTITY };
  const { p, axis } = edgeAxis(T, md, S.edge);
  const h = S.phi / 2, s = Math.sin(h);
  const q = { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
  // mundo = e + R·(p_chasis + lift − e)
  const r = rotate(q, { x: -p.x, y: lift - p.y, z: -p.z });
  return { t: { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z }, q };
}

/** Suspensión: cabeceo (eje z) y balanceo (eje x) alrededor de un punto a la altura de los ejes. */
export function suspensionPose(S: Pick<CraneState, 'sus'>): Pose {
  const { pitch, bank } = S.sus;
  if (!pitch && !bank) return { t: { x: 0, y: 0, z: 0 }, q: IDENTITY };
  const q = mul(axisAngle(0, 0, 1, pitch), axisAngle(1, 0, 0, bank));
  const c = rotate(q, { x: 0, y: SUS_Y, z: 0 });
  return { t: { x: -c.x, y: SUS_Y - c.y, z: -c.z }, q };
}

/**
 * Pose del portador en el mundo = conducción ∘ (elevación y phi) ∘ suspensión.
 * La suspensión va también en la física para que el cable siga saliendo de la cabeza de la pluma.
 */
export function carrierPose(T: CraneSpec, S: CraneState, md: SupportMode): Pose {
  return compose(carrierFrame(S), compose(standPose(T, S, md), suspensionPose(S)));
}
