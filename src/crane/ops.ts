// Operación de la grúa: modo de apoyo, estabilizadores (tecla O), estabilidad dinámica con la tensión
// del cable y la inclinación incipiente al vuelco. Lógica de step(), mode() y toggleOutriggers() de la referencia.

import type { CraneSpec } from './cranes';
import type { CraneState } from './kinematics';
import { MOVING } from './drive';
import { KF, craneMasses, lmiStatic, structCap, tipEdge, type CraneConfig, type SupportMode } from './stability';

/** Inclinación (rad) a partir de la cual la grúa vuelca sin remedio (fail de la referencia, ≈ 3,4°). */
export const TIP_PHI = 0.06;
/** Por encima de esto la grúa se considera inclinada y solo se permiten movimientos que la recuperan. */
export const TILTED_PHI = 0.002;

/** mode() de la referencia (grúas de ruedas): estabilizadores solo si están apoyados del todo; en marcha "move". */
export function supportMode(S: CraneState): SupportMode {
  return S.out >= 1 ? 'out' : Math.abs(S.vd) > MOVING ? 'move' : 'tire';
}

export interface OutriggerCtx {
  /** Hay carga enganchada que no está apoyada */
  loadHanging: boolean;
  /** Motivo por el que no se pueden abrir los estabilizadores (padsBlocked de la referencia), o null */
  padsBlocked?: string | null;
}

/** Tecla O. Devuelve el mensaje para el operador. */
export function toggleOutriggers(T: CraneSpec, C: CraneConfig, S: CraneState, ctx: OutriggerCtx): string {
  if (!T.out) return 'Esta grúa no tiene estabilizadores';
  // (no está en la referencia) con la grúa levantándose no se cambia el apoyo: cambiaría la arista de vuelco
  if (S.phi > 0) return 'La grúa se está levantando: recupérala antes de mover los estabilizadores';
  if (S.outT === 0) {
    if (Math.abs(S.vd) > MOVING) return 'Detén la grúa antes de estabilizar';
    if (ctx.padsBlocked) return ctx.padsBlocked;
    S.outT = 1;
    return 'Desplegando estabilizadores';
  }
  if (ctx.loadHanging) return 'Apoya la carga antes de recoger los estabilizadores';
  if (lmiStatic(T, C, 'tire', S.Lb, S.ang, S.slew, T.hookM) >= 1) return 'LMI: sobre neumáticos la grúa no es estable así. Gira o retrae la pluma.';
  S.outT = 0;
  return 'Recogiendo estabilizadores';
}

export interface Dyn {
  /** Utilización al vuelco (momento volcador / estabilizador), sin KF */
  u: number;
  /** Arista que manda */
  edge: number;
  /** LMI dinámico: max(u / KF, tensión / capacidad estructural) */
  lmi: number;
}

/**
 * Estabilidad con la tensión real del cable (t) aplicada en el punto de suspensión `gp`
 * (marco del chasis: x hacia delante, z del mundo). Como el final de step() en la referencia.
 */
export function dynamicStability(T: CraneSpec, C: CraneConfig, S: CraneState, md: SupportMode, tension: number, gp: { x: number; z: number }): Dyn {
  const ms = craneMasses(T, C, S.Lb, S.ang, S.slew);
  ms.push([tension, gp.x, -gp.z]); // y de la referencia = −z del mundo
  const { u, edge } = tipEdge(T, md, ms);
  return { u, edge, lmi: Math.max(u / KF[md], tension / structCap(T, C, S.Lb)) };
}

/** Integra la inclinación incipiente (phi). Devuelve true cuando ya no hay vuelta atrás. */
export function stepTilt(S: CraneState, d: Dyn, dt: number): boolean {
  if (d.u > 1 || S.phi > 0) {
    if (S.phi <= 0) S.edge = d.edge; // la arista se fija cuando empieza a levantarse
    S.phiV += (d.u > 1 ? (d.u - 1) * 2.5 : -0.6) * dt;
    S.phiV *= Math.pow(0.99, dt * 120); // la referencia aplica 0,99 por paso de 1/120 s
    S.phi += S.phiV * dt;
    if (S.phi <= 0) { S.phi = 0; S.phiV = 0; S.edge = -1; }
  }
  return S.phi > TIP_PHI;
}
