// Grúa torre autodesplegable (SK 60, fase 8): geometría del montaje según towerGeom() de la referencia.
// Marco del chasis apoyado en el suelo (x frente, y arriba, −z izquierda); la elevación por estabilizadores y la
// inclinación se aplican después con carrierPose(), como headPos().
// El avance del montaje S.er (0 plegada … 1 montada) tiene tres tramos suavizados:
//   0–45 %   la torre se levanta de tumbada (hacia delante, en la dirección del giro) a vertical;
//   45–70 %  la torre se telescopa de H0 a H;
//   70–100 % la pluma se despliega: gira de colgar a lo largo de la torre a su ángulo S.ang y se alarga a J.

import type { CraneSpec } from './cranes';

type V = [number, number, number];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sm = (t: number) => t * t * (3 - 2 * t);

/** Altura de la bisagra de la torre sobre la cubierta (base de towerGeom: deckHi + 0,6) */
export const TOWER_BASE_DY = 0.6;

export interface TowerGeom {
  /** Bisagra de la torre (sobre el centro de giro) */
  base: V;
  /** Dirección de la torre (de la base a la punta) */
  dir: V;
  /** Largo actual de la torre */
  hgt: number;
  /** Punta de la torre (pivote de la pluma) */
  top: V;
  /** Dirección de la pluma desde la punta de la torre y su ángulo en el plano vertical del giro */
  jd: V;
  phi: number;
  /** Dirección horizontal del giro */
  f: V;
  /** Largo actual de la pluma (referencia) */
  jl: number;
  /**
   * Largo de la pluma dibujada y de sus choques (aproximación visual): se alarga más tarde que en la referencia
   * (cuadrático desde el 25 % del despliegue). Con el de la referencia, al empezar a desplegarse su punta bajaba hasta
   * 1 m del suelo y atravesaba la cubierta del camión.
   */
  jlVis: number;
  /** Avance de cada tramo: levantar, telescopar, desplegar */
  p1: number;
  p2: number;
  p3: number;
  ready: boolean;
}

/** towerGeom() de la referencia, con el avance `er`, el ángulo de la pluma `ang` y el giro `slew`. */
export function towerGeom(T: CraneSpec, S: { er: number; ang: number; slew: number }): TowerGeom {
  const tw = T.tower!, e = S.er;
  const p1 = sm(clamp(e / 0.45, 0, 1)), p2 = sm(clamp((e - 0.45) / 0.25, 0, 1)), p3 = sm(clamp((e - 0.7) / 0.3, 0, 1));
  // el giro positivo es antihorario visto desde arriba: hacia −z (izquierda)
  const f: V = [Math.cos(S.slew), 0, -Math.sin(S.slew)];
  const base: V = [T.piv, T.deckHi + TOWER_BASE_DY, 0];
  const tA = (p1 * Math.PI) / 2, hgt = tw.H0 + (tw.H - tw.H0) * p2;
  const dir: V = [Math.cos(tA) * f[0], Math.sin(tA), Math.cos(tA) * f[2]];
  const top: V = [base[0] + dir[0] * hgt, base[1] + dir[1] * hgt, base[2] + dir[2] * hgt];
  const phi = tA + Math.PI + (2 * Math.PI + S.ang - (tA + Math.PI)) * p3;
  const jd: V = [Math.cos(phi) * f[0], Math.sin(phi), Math.cos(phi) * f[2]];
  const jf = Math.min(tw.J, hgt - 1.5), jl = jf + (tw.J - jf) * p3;
  const k = Math.max(0, (p3 - 0.25) / 0.75), jlVis = jf + (tw.J - jf) * k * k;
  return { base, dir, hgt, top, jd, phi, f, jl, jlVis, p1, p2, p3, ready: e >= 1 };
}

/** Punta de la torre (pivotPos de la referencia): 1 m más arriba mientras no está montada (el cable cuelga de ahí). */
export function towerPivot(T: CraneSpec, S: { er: number; ang: number; slew: number }) {
  const g = towerGeom(T, S);
  return { x: g.top[0], y: g.top[1] + (g.ready ? 0 : 1.0), z: g.top[2] };
}

/** Extremo de la pluma (headPos de la referencia para la torre). */
export function towerHead(T: CraneSpec, S: { er: number; ang: number; slew: number }) {
  const g = towerGeom(T, S);
  return { x: g.top[0] + g.jd[0] * g.jl, y: g.top[1] + g.jd[1] * g.jl, z: g.top[2] + g.jd[2] * g.jl };
}

/** Punta del cable (tipPos de la referencia): el carro a Lb de la punta de la torre, o la punta si no está montada. */
export function towerTip(T: CraneSpec, S: { er: number; ang: number; slew: number; Lb: number }) {
  const p = towerPivot(T, S);
  if (S.er < 1) return p;
  const r = S.Lb * Math.cos(S.ang);
  return { x: p.x + r * Math.cos(S.slew), y: p.y + S.Lb * Math.sin(S.ang), z: p.z - r * Math.sin(S.slew) };
}

/** Largo de la contrapluma (dibujo de la referencia) y bloques de lastre en ella (de 7,2 m, cada 0,6 m). */
export const COUNTER_JIB = 9;
/** Altura de la cúspide sobre la punta de la torre (dibujo de la referencia) */
export const PEAK_H = 6;
