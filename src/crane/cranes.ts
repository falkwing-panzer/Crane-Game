// Datos de las grúas copiados TAL CUAL del objeto CRANES de referencia/crane-v20.html.
// No editar los números: las pruebas (stability.test.ts) comparan este objeto con el de la referencia.
// Unidades: metros, toneladas, radianes, segundos. Marco del chasis: x hacia el frente.
// El estado de montaje (lastre, Y-guy, plumín, radio superlift) NO se guarda aquí: ver CraneConfig en stability.ts.

const D = Math.PI / 180;

/** Rectángulo de apoyo en el marco del chasis: aristas delantera (xf), trasera (xr) y media anchura (hw). */
export interface SupportRect { xf: number; xr: number; hw: number; /** tiempo de despliegue (s) */ t?: number }

export interface CraneSpec {
  id: string;
  name: string;
  size: string;
  color: string;
  note: string;
  /** Grúa telescópica sobre neumáticos (estilo europeo) */
  ltm?: boolean;
  /** Rough Terrain */
  rt?: boolean;
  offroad?: boolean;
  rim?: string;
  /** Extremos del chasis en x [trasero, delantero] */
  len: [number, number];
  /** Media anchura del chasis */
  half: number;
  deckLo: number;
  deckHi: number;
  /** Posición x de cada eje (solo grúas de ruedas) */
  axles?: number[];
  wheelR?: number;
  wheelbase?: number;
  steerMax?: number;
  allSteer?: boolean;
  // orugas
  crawler?: boolean;
  trackW?: number;
  trackN?: number;
  carX?: number;
  ringR?: number;
  supW?: number;
  supFront?: number;
  cwW?: number;
  /** Portador: masa y x de su centro de gravedad */
  mCar: number;
  xCar: number;
  /** x del centro de giro de la superestructura */
  piv: number;
  /** Distancia (en la dirección de la pluma) del centro de giro al pie de pluma */
  foot: number;
  /** Altura del pie de pluma */
  pivH: number;
  /** Superestructura: masa y distancia al centro de giro */
  mSup: number;
  xSup: number;
  /** Contrapeso base (sin lastre de obra): masa, distancia al centro de giro y largo */
  mCw: number;
  cwBase?: number;
  xCw: number;
  cwLen: number;
  cwWide?: number;
  cwStyle?: 'stack';
  /** Lastre que se monta en obra (tecla B) */
  ballast?: { m: number; t: number };
  /** Arriostramiento en Y (tecla Y); teleMax = largo de pluma hasta el que no hace falta */
  yguy?: { t: number; teleMax: number };
  /** Plumín abatible de celosía */
  jibDef?: JibDef;
  /** Grúa torre autodesplegable */
  tower?: { H: number; H0: number; J: number; jibM: number; t: number; col: string };
  /** Mástil derrick (LR 3000) */
  derrick?: { len: number; kg: number; foot: number; ang: number };
  /** Lastre superlift: masa, radio inicial (r, r0) y límites; w/d/h dimensiones del bloque */
  superlift?: { m: number; r: number; r0: number; rMin: number; rMax: number; w: number; d: number; h: number };
  out?: SupportRect;
  tire?: SupportRect;
  track?: SupportRect;
  /** Pluma: largo (m), masa por metro (t/m), ángulos, ancho */
  boom: { min: number; max: number; kg: number; angMin: number; angMax: number; w: number; lattice: boolean };
  /** Capacidad estructural con la pluma más corta / más larga (t) */
  structMax: number;
  structMin: number;
  /** Masa del gancho (t) */
  hookM: number;
  spd: { drive: number; turn?: number; slew: number; luff: number; tele: number; hoist: number };
}

export interface JibDef { len: number; kg: number; cap: number; relMin: number; relMax: number; spd: number; t: number }

export type CraneId = 'small' | 'medium' | 'large' | 'sk' | 'rt' | 'xl' | 'at300' | 'at450' | 'at650' | 'lr' | 'crawler';

export const CRANES: Record<CraneId, CraneSpec> = {
  small: { id: 'small', ltm: true, name: 'City 25', size: 'Pequeña', color: '#f2c12e',
    note: 'Compacta y ágil: dirección en las 4 ruedas, cabe en calles estrechas. Poca capacidad.',
    len: [-4.4, 6.2], half: 1.25, deckLo: 0.65, deckHi: 1.8, axles: [-2.6, 2.6], wheelR: 0.67, wheelbase: 5.2, steerMax: 32 * D, allSteer: true,
    mCar: 14, xCar: 0.6, piv: -0.9, foot: -1.5, pivH: 2.45, mSup: 3, xSup: -0.5, mCw: 4, xCw: -2.4, cwLen: 1.4,
    out: { xf: 3.9, xr: -3.9, hw: 2.7, t: 2.5 }, tire: { xf: 2.6, xr: -2.6, hw: 1.15 },
    boom: { min: 8, max: 26, kg: 0.09, angMin: 0, angMax: 80 * D, w: 0.6, lattice: false },
    structMax: 25, structMin: 7, hookM: 0.25,
    spd: { drive: 4.5, slew: 6 * D, luff: 5 * D, tele: 1.4, hoist: 2.6 } },
  medium: { id: 'medium', ltm: true, name: 'AT 60', size: 'Mediana', color: '#f0bb27',
    note: 'Todo terreno de 3 ejes. Buen equilibrio entre alcance, capacidad y tamaño.',
    len: [-6.0, 6.3], half: 1.38, deckLo: 0.7, deckHi: 1.95, axles: [-4.0, -2.45, 3.4], wheelR: 0.73, wheelbase: 7.0, steerMax: 30 * D, allSteer: true,
    mCar: 26, xCar: 0.8, piv: -1.8, foot: -2.1, pivH: 2.75, mSup: 6, xSup: -0.4, mCw: 11, xCw: -3.4, cwLen: 2.0,
    out: { xf: 1.6, xr: -5.2, hw: 3.6, t: 3.5 }, tire: { xf: 3.4, xr: -4.0, hw: 1.25 },
    boom: { min: 11, max: 42, kg: 0.17, angMin: 0, angMax: 80 * D, w: 0.85, lattice: false },
    structMax: 60, structMin: 13, hookM: 0.4,
    spd: { drive: 3.2, slew: 4 * D, luff: 3.5 * D, tele: 1.0, hoist: 2.1 } },
  large: { id: 'large', ltm: true, name: 'AT 220', size: 'Grande', color: '#efb722',
    note: 'Gran capacidad y pluma de 64 m. Pesada, lenta y necesita mucho espacio para los estabilizadores.',
    len: [-8.6, 8.8], half: 1.5, deckLo: 0.75, deckHi: 2.0, axles: [-5.9, -4.3, -2.7, 4.3, 5.9], wheelR: 0.77, wheelbase: 10, steerMax: 26 * D, allSteer: true,
    mCar: 48, xCar: 0.8, piv: -2.4, foot: -2.7, pivH: 2.98, mSup: 12, xSup: -0.6, mCw: 42, xCw: -5.2, cwLen: 3.0,
    out: { xf: 2.4, xr: -7.2, hw: 4.8, t: 6 }, tire: { xf: 5.9, xr: -5.9, hw: 1.35 },
    boom: { min: 14, max: 64, kg: 0.32, angMin: 0, angMax: 82 * D, w: 1.15, lattice: false },
    structMax: 220, structMin: 32, hookM: 1.2,
    spd: { drive: 2.2, slew: 2.2 * D, luff: 2.2 * D, tele: 0.6, hoist: 1.7 } },
  sk: { id: 'sk', ltm: true, rim: '#d9dde1', name: 'SK 60', size: 'Grúa torre móvil', color: '#d8402f',
    note: 'Grúa torre sobre camión de 6 ejes que se monta sola (M): torre de 37,2 m y pluma de 60 m con carro (Q/E). 10 t hasta 13,2 m y 1,7 t en la punta. La pluma se inclina hasta 30° (W/S).',
    tower: { H: 37.2, H0: 18.6, J: 60, jibM: 7, t: 45, col: '#d8402f' },
    len: [-8.0, 8.9], half: 1.375, deckLo: 0.75, deckHi: 1.95, axles: [-6.2, -4.6, -3.0, 3.4, 5.0, 6.6], wheelR: 0.7, wheelbase: 10, steerMax: 26 * D, allSteer: true,
    mCar: 40, xCar: 1.0, piv: -3.6, foot: 0, pivH: 39.7, mSup: 26, xSup: 0, mCw: 26, xCw: -9, cwLen: 3,
    out: { xf: 1.7, xr: -7.4, hw: 4.6, t: 4 }, tire: { xf: 6.6, xr: -6.2, hw: 1.2 },
    boom: { min: 3, max: 60, kg: 0, angMin: 0, angMax: 30 * D, w: 1.2, lattice: true },
    structMax: 10, structMin: 1.7, hookM: 0.3,
    spd: { drive: 2.6, slew: 8 * D, luff: 2 * D, tele: 1.3, hoist: 1.7 } },
  rt: { id: 'rt', ltm: true, rt: true, offroad: true, rim: '#2f3438', name: 'RT 90', size: 'Todo terreno RT', color: '#f0b51e',
    note: 'Rough Terrain de 81,6 t: 2 ejes con neumáticos 29.5×25 de 1,8 m, dirección en las 4 ruedas y una sola cabina en la superestructura. Pluma de 11,3 a 43,9 m. Entra en el barro.',
    len: [-5.3, 5.3], half: 1.67, deckLo: 0.95, deckHi: 2.15, axles: [-2.108, 2.108], wheelR: 0.9, wheelbase: 4.216, steerMax: 30 * D, allSteer: true,
    mCar: 34, xCar: 0.3, piv: -0.4, foot: -1.8, pivH: 3.03, mSup: 7, xSup: -0.5, mCw: 16, xCw: -3.3, cwLen: 1.6,
    out: { xf: 3.55, xr: -3.55, hw: 3.66, t: 3 }, tire: { xf: 2.108, xr: -2.108, hw: 1.4 },
    boom: { min: 11.3, max: 43.9, kg: 0.3, angMin: 0, angMax: 76 * D, w: 1.0, lattice: false },
    structMax: 81.6, structMin: 9, hookM: 0.9,
    spd: { drive: 3.6, slew: 3.5 * D, luff: 3.5 * D, tele: 0.9, hoist: 2.1 } },
  xl: { id: 'xl', rim: '#f0be22', name: 'AT 500-8', size: 'Gigante', color: '#f3c01d',
    note: 'Todo terreno de 8 ejes y 500 t. Pluma de 50 m. En obra se monta el lastre de 165 t (B) y el arriostramiento en Y (Y), necesario para pluma larga.',
    ltm: true, len: [-9.07, 9.07], half: 1.5, deckLo: 0.75, deckHi: 1.975, axles: [-6.81, -5.17, -2.88, -1.24, 0.40, 3.22, 4.89, 6.53], wheelR: 0.74, wheelbase: 13.3, steerMax: 24 * D, allSteer: true,
    mCar: 96, xCar: 0.8, piv: -4.1, foot: -1.6, pivH: 3.15, mSup: 40, xSup: -0.8, mCw: 10, cwBase: 10, xCw: -5.4, cwLen: 2.4, cwWide: 4.12, ballast: { m: 165, t: 14 }, yguy: { t: 24, teleMax: 35 },
    out: { xf: 1.82, xr: -8.23, hw: 4.8, t: 8 }, tire: { xf: 6.53, xr: -6.81, hw: 1.4 },
    boom: { min: 16.1, max: 50, kg: 0.95, angMin: 0, angMax: 83 * D, w: 1.45, lattice: false },
    structMax: 500, structMin: 95, hookM: 4,
    spd: { drive: 1.8, slew: 1.5 * D, luff: 1.6 * D, tele: 0.45, hoist: 1.4 } },
  at300: { id: 'at300', ltm: true, rim: '#f0be22', name: 'AT 300-6', size: 'Muy grande', color: '#f4c51f',
    note: '6 ejes y 300 t. Pluma telescópica de 14,7 a 78 m, base de apoyo 8,9 × 8,5 m. Monta 86 t de lastre en obra (B).',
    len: [-7.8, 7.8], half: 1.5, deckLo: 0.75, deckHi: 2.0, axles: [-5.4, -3.75, -1.2, 0.45, 3.6, 5.25], wheelR: 0.74, wheelbase: 9, steerMax: 26 * D, allSteer: true,
    mCar: 40, xCar: 1.0, piv: -2.0, foot: -1.6, pivH: 3.05, mSup: 14, xSup: -0.8, mCw: 10, cwBase: 10, xCw: -4.3, cwLen: 2.6, ballast: { m: 86, t: 12 },
    out: { xf: 1.9, xr: -7.0, hw: 4.27, t: 7 }, tire: { xf: 5.25, xr: -5.4, hw: 1.3 },
    boom: { min: 14.7, max: 78, kg: 0.32, angMin: 0, angMax: 83 * D, w: 1.25, lattice: false },
    structMax: 300, structMin: 22, hookM: 2.5,
    spd: { drive: 2.4, slew: 2 * D, luff: 2.2 * D, tele: 0.55, hoist: 1.6 } },
  at450: { id: 'at450', ltm: true, rim: '#f0be22', name: 'AT 450-8', size: 'Muy grande', color: '#f3c21e',
    note: '8 ejes y 450 t. Pluma de 16,1 a 85 m, base 11 × 9,6 m. Lastre de 124 t en torre de placas redondas (B).',
    len: [-9.95, 10.4], half: 1.5, deckLo: 0.75, deckHi: 2.0, axles: [-7.6, -6.0, -3.4, -1.8, -0.2, 4.6, 6.2, 7.8], wheelR: 0.78, wheelbase: 14, steerMax: 24 * D, allSteer: true,
    mCar: 64, xCar: 1.5, piv: -3.6, foot: -1.8, pivH: 3.15, mSup: 22, xSup: -0.8, mCw: 10, cwBase: 10, xCw: -5.6, cwLen: 2.7, cwStyle: 'stack', ballast: { m: 124, t: 14 },
    out: { xf: 2.1, xr: -8.9, hw: 4.8, t: 8 }, tire: { xf: 7.8, xr: -7.6, hw: 1.3 },
    boom: { min: 16.1, max: 85, kg: 0.42, angMin: 0, angMax: 83 * D, w: 1.35, lattice: false },
    structMax: 450, structMin: 24, hookM: 3.5,
    spd: { drive: 1.9, slew: 1.6 * D, luff: 1.8 * D, tele: 0.5, hoist: 1.5 } },
  at650: { id: 'at650', ltm: true, rim: '#f0be22', name: 'AT 650-8', size: 'Gigante', color: '#f3c21e',
    note: '8 ejes y 700 t. Pluma de 54 m con arriostramiento en Y (Y), 155 t de lastre (B) y, en algunos trabajos, plumín abatible de celosía de 42 m (T/G).',
    len: [-10.3, 8.9], half: 1.5, deckLo: 0.75, deckHi: 2.0, axles: [-8.2, -6.55, -4.9, -3.25, 0.55, 2.2, 4.65, 6.3], wheelR: 0.78, wheelbase: 13, steerMax: 24 * D, allSteer: true,
    mCar: 70, xCar: 1.0, piv: -4.4, foot: -2.2, pivH: 3.25, mSup: 30, xSup: -0.8, mCw: 20, cwBase: 20, xCw: -6.4, cwLen: 3.0, cwStyle: 'stack', ballast: { m: 155, t: 16 }, yguy: { t: 26, teleMax: 35 },
    jibDef: { len: 42, kg: 0.45, cap: 150, relMin: 0, relMax: 75 * D, spd: 1.5 * D, t: 32 },
    out: { xf: 3.42, xr: -9.4, hw: 5.9, t: 9 }, tire: { xf: 6.3, xr: -8.2, hw: 1.3 },
    boom: { min: 16, max: 54, kg: 0.9, angMin: 0, angMax: 84 * D, w: 1.55, lattice: false },
    structMax: 700, structMin: 160, hookM: 5,
    spd: { drive: 1.6, slew: 1.3 * D, luff: 1.4 * D, tele: 0.4, hoist: 1.3 } },
  lr: { id: 'lr', name: 'LR 3000', size: 'Colosal', color: '#f2b632',
    note: 'Grúa sobre orugas de 3.000 t: pluma de celosía de 108 m, mástil derrick de 60 m y 1.500 t de lastre superlift. Se monta en obra y apenas se mueve.',
    len: [-9.9, 9.9], half: 7.0, deckLo: 1.6, deckHi: 3.2, crawler: true, trackW: 3.0, trackN: 2, carX: 5.0, ringR: 5.2, supW: 4.6, supFront: 7.5, cwW: 5.5,
    mCar: 600, xCar: 0, piv: 0, foot: 2.5, pivH: 6.0, mSup: 400, xSup: -3, mCw: 750, xCw: -14, cwLen: 5.0,
    derrick: { len: 60, kg: 2.0, foot: -2.0, ang: 75 * D }, superlift: { m: 1500, r: 22, r0: 22, rMin: 15, rMax: 30, w: 10, d: 7, h: 3.0 },
    track: { xf: 9.9, xr: -9.9, hw: 7.0 },
    boom: { min: 108, max: 108, kg: 3.2, angMin: 45 * D, angMax: 85 * D, w: 5.0, lattice: true },
    structMax: 3000, structMin: 3000, hookM: 40,
    spd: { drive: 0.45, turn: 1.2 * D, slew: 0.5 * D, luff: 0.5 * D, tele: 0, hoist: 0.7 } },
  crawler: { id: 'crawler', name: 'LR 300', size: 'Sobre orugas', color: '#cf7f2a',
    note: 'Pluma de celosía de 48 m fija. No usa estabilizadores: puede desplazarse con la carga colgada y cruzar terreno blando.',
    len: [-4.8, 4.8], half: 3.7, deckLo: 1.3, deckHi: 2.3, crawler: true, trackW: 1.1,
    mCar: 75, xCar: 0, piv: 0, foot: 1.3, pivH: 3.4, mSup: 25, xSup: -1.0, mCw: 70, xCw: -5.8, cwLen: 2.6,
    track: { xf: 4.6, xr: -4.6, hw: 3.6 },
    boom: { min: 48, max: 48, kg: 0.36, angMin: 25 * D, angMax: 84 * D, w: 1.6, lattice: true },
    structMax: 120, structMin: 120, hookM: 1.5,
    spd: { drive: 1.3, turn: 7 * D, slew: 1.8 * D, luff: 1.8 * D, tele: 0, hoist: 1.8 } },
};

/** Grúa de ruedas usada por el modelo 3D de la fase 0. */
export type WheeledSpec = CraneSpec & { axles: number[]; wheelR: number; tire: SupportRect; out: SupportRect };
export const AT60 = CRANES.medium as WheeledSpec;

/** Distancia del centro del gancho a la parte superior de la carga cuando está enganchada (SLING en la referencia). */
export const SLING = 1.0;

/**
 * Media anchura del chasis para el dibujo y los choques (m). La referencia da `half` = 1,38 m (2,76 m de ancho) para la
 * AT 60; Jesús pidió un chasis más ancho para que quepan una cabina de conductor a todo el ancho y una cabina de operador
 * más grande: 3,4 m (aproximación visual). La estabilidad no cambia: usa los rectángulos `tire` y `out`.
 */
export function bodyHalf(T: CraneSpec): number {
  return T.id === 'medium' ? 1.7 : T.half;
}
