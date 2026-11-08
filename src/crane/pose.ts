// Pose del portador en el mundo: elevación por estabilizadores y giro alrededor de la arista de vuelco.
// El marco del chasis coincide con el mundo cuando la grúa está sobre el suelo y sin inclinar
// (la grúa está en el origen mirando a +x). Sin dependencias de three.js para usarla en física y pruebas.

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

/** Pose del portador según el estado analítico (elevación y phi). */
export function carrierPose(T: CraneSpec, S: CraneState, md: SupportMode): Pose {
  const lift = carrierLift(S);
  if (S.phi <= 0 || S.edge < 0) return { t: { x: 0, y: lift, z: 0 }, q: IDENTITY };
  const { p, axis } = edgeAxis(T, md, S.edge);
  const h = S.phi / 2, s = Math.sin(h);
  const q = { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
  // mundo = e + R·(p_chasis + lift − e)
  const r = rotate(q, { x: -p.x, y: lift - p.y, z: -p.z });
  return { t: { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z }, q };
}
