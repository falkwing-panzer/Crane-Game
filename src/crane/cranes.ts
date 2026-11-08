// Datos de grúas copiados de referencia/crane-v20.html (objeto CRANES).
// Unidades: metros, toneladas, radianes, segundos. Eje x del chasis hacia el frente.
// Fase 0: solo la AT 60. No inventar datos: si falta algo, está marcado como "aproximación visual".

const D = Math.PI / 180;

export interface CraneSpec {
  id: string;
  name: string;
  color: string;
  /** Extremos del chasis en x [trasero, delantero] */
  len: [number, number];
  /** Media anchura del chasis */
  half: number;
  deckLo: number;
  deckHi: number;
  /** Posición x de cada eje */
  axles: number[];
  wheelR: number;
  /** x del centro de giro de la superestructura */
  piv: number;
  /** Distancia (en la dirección de la pluma) del centro de giro al pie de pluma */
  foot: number;
  /** Altura del pie de pluma */
  pivH: number;
  /** x (marco de la superestructura) y largo del contrapeso */
  xCw: number;
  cwLen: number;
  mCw: number;
  boom: { min: number; max: number; kg: number; angMin: number; angMax: number; w: number };
  /** Masa del gancho (t) */
  hookM: number;
  spd: { slew: number; luff: number; tele: number; hoist: number };
}

export const AT60: CraneSpec = {
  id: 'medium',
  name: 'AT 60',
  color: '#f0bb27',
  len: [-6.0, 6.3],
  half: 1.38,
  deckLo: 0.7,
  deckHi: 1.95,
  axles: [-4.0, -2.45, 3.4],
  wheelR: 0.73,
  piv: -1.8,
  foot: -2.1,
  pivH: 2.75,
  xCw: -3.4,
  cwLen: 2.0,
  mCw: 11,
  boom: { min: 11, max: 42, kg: 0.17, angMin: 0, angMax: 80 * D, w: 0.85 },
  hookM: 0.4,
  spd: { slew: 4 * D, luff: 3.5 * D, tele: 1.0, hoist: 2.1 },
};

/** Distancia del centro del gancho a la parte superior de la carga cuando está enganchada (SLING en la referencia). */
export const SLING = 1.0;
