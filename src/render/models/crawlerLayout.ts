import type { CrawlerSpec } from '../../crane/cranes';
import { cwDims, type Box3, type CwDims } from './layout';

// Medidas del modelo 3D de una grúa sobre orugas, sin three.js (las usan el generador y las pruebas).
// Fórmulas de la rama T.crawler de craneModel() en la referencia. Donde la referencia hace que dos piezas se
// atraviesen, se ajusta y se indica ("aproximación visual"). Marco del chasis: x frente, y arriba, −z izquierda;
// la superestructura tiene el origen en el centro de giro (x = piv) y la cabina del operador a la izquierda.

export interface TrackLayout {
  /** Rango lateral de la oruga */
  z0: number;
  z1: number;
  /** Lado: −1 izquierda (−z), +1 derecha */
  side: -1 | 1;
}

export interface CrawlerLayout {
  /** Escala de las piezas del tren de rodaje (kk de la referencia: 1,55 en la LR 3000) */
  kk: number;
  tracks: TrackLayout[];
  /** Contorno por el que corren las tejas: rectas entre xa y xb, semicírculos de radio R centrados a la altura yc */
  loop: { xa: number; xb: number; yc: number; R: number; pitch: number; shoe: [number, number] };
  /** Rodillos de apoyo (x) */
  rollers: number[];
  carbody: Box3;
  /** Travesaños de la LR 3000 entre las orugas (x) */
  crossbeams: number[];
  // --- superestructura ---
  yd: number;
  wide: number;
  front: number;
  ringR: number;
  carRingR: number;
  plateTop: number;
  /** Ranura en la plataforma bajo el pie de pluma (rango x, |z| < ancho/2 + 0,08) */
  slot: [number, number];
  cw: CwDims & { y0: number; top: number; n: number };
  rearBody: Box3;
  housing: Box3 | null;
  drum: { x: number; y: number; r: number; hl: number };
  opCab: Box3;
  /** Caballete (LR 300; la LR 3000 lleva derrick): punta y pies, en el marco de la superestructura */
  mast: { top: [number, number]; feet: [number, number, number][] } | null;
  tailR: number;
  eye: { x: number; y: number; z: number };
  // --- pluma ---
  bw: number;
  /** Pie macizo de la pluma (perfil x-y en el marco de la pluma, extruido en |z| < footHalf) */
  foot: [number, number][];
  footHalf: number;
}

export function crawlerLayout(T: CrawlerSpec): CrawlerLayout {
  const r = T.track, tw = T.trackW, nT = T.trackN || 1, kk = T.id === 'lr' ? 1.55 : 1;
  const tracks: TrackLayout[] = [];
  for (const s of [-1, 1] as const) for (let ti = 0; ti < nT; ti++) {
    const wT = (tw - 0.3 * (nT - 1)) / nT, base = s * (r.hw - tw);
    const l0 = base + s * ti * (wT + 0.3), l1 = l0 + s * wT;
    tracks.push({ z0: Math.min(l0, l1), z1: Math.max(l0, l1), side: s });
  }
  // Tejas de la referencia: arriba de 1,28 a 1,42, abajo de 0 a 0,12 y en semicírculos de radio 0,71 en los extremos
  const loop = { xa: r.xr + 0.65 * kk, xb: r.xf - 0.65 * kk, yc: 0.715 * kk, R: 0.645 * kk, pitch: 0.5 * kk, shoe: [0.4 * kk, 0.14 * kk] as [number, number] };
  const rollers: number[] = [];
  for (let x = r.xr + 1.6 * kk; x < r.xf - 1.4 * kk; x += 1.25 * kk) rollers.push(x);
  const cxb = T.carX || 2.6, inner = r.hw - tw;
  const carbody: Box3 = { x0: -cxb, x1: cxb, y0: 0.75 * kk, y1: T.deckHi, z0: -inner, z1: inner };
  const crossbeams = T.id === 'lr' ? [-cxb, cxb] : [];

  // --- superestructura ---
  const yd = T.deckHi, ft = T.foot, bw = T.boom.w;
  const wide = T.supW || 1.7, front = T.supFront || 3.2;
  const plateTop = yd + 0.75;
  const cd = cwDims(T, 0), n = T.id === 'lr' ? 8 : 4;
  const cw = { ...cd, y0: plateTop, top: plateTop + cd.hgt, n };
  // Cabrestante: la referencia lo centra en min(pivH − 0,35; yd + 1,45), medio hundido en la plataforma;
  // aquí va apoyado encima (aproximación visual)
  const dr = 0.42;
  const drum = { x: ft - 0.95, y: plateTop + dr + 0.05, r: dr, hl: 0.85 };
  // Cuerpo trasero: la referencia lo alarga hasta delante del pie (front − 0,2) y lo atravesaría la pluma;
  // aquí acaba detrás del cabrestante y delante solo queda el capó de la derecha (aproximación visual)
  const rearBody: Box3 = { x0: cd.x + cd.len / 2, x1: drum.x - dr - 0.1, y0: plateTop, y1: yd + 1.45, z0: -wide, z1: wide };
  const hz0 = bw / 2 + 0.42;
  const housing: Box3 | null = wide - hz0 > 0.25 ? { x0: drum.x + dr + 0.1, x1: front - 0.2, y0: plateTop, y1: yd + 1.45, z0: hz0, z1: wide } : null;
  // cabina del operador a la izquierda (la referencia la pone a la derecha), como en las grúas de ruedas
  const opCab: Box3 = { x0: 0.2, x1: 2.25, y0: yd + 0.4, y1: yd + 2.25, z0: -(wide + 1.0), z1: -(wide + 0.05) };
  const mast = T.derrick ? null : {
    top: [-2.4, yd + 7.5] as [number, number],
    feet: [[-2.2, plateTop, -0.9], [-2.2, plateTop, 0.9]] as [number, number, number][],
  };
  const corners: [number, number][] = [[cd.x - cd.len / 2, cd.w], [front, wide], [opCab.x0, -opCab.z0], [opCab.x1, -opCab.z0]];
  const tailR = Math.max(...corners.map(([x, z]) => Math.hypot(x, z)));
  const eye = { x: opCab.x1 - 0.45, y: opCab.y1 - 0.55, z: (opCab.z0 + opCab.z1) / 2 };

  // Pie de la pluma: la referencia dibuja una caja de −0,6 a 2,4 m del ancho de la pluma, que con el pie de pluma
  // 1,1 m por encima de la plataforma se hunde en ella. Aquí es una pieza que se estrecha hacia el bulón
  // (aproximación visual) y la plataforma lleva una ranura debajo.
  const fh = bw * 0.51;
  const foot: [number, number][] = [[-0.3, -0.35], [2.4, -fh], [2.4, fh], [-0.3, 0.35]];
  const slot: [number, number] = [ft - 0.6, front];

  return {
    kk, tracks, loop, rollers, carbody, crossbeams,
    yd, wide, front, ringR: T.ringR || 2.3, carRingR: T.ringR || 2.2, plateTop, slot, cw, rearBody, housing, drum, opCab, mast, tailR, eye,
    bw, foot, footHalf: fh,
  };
}

/** Largo del contorno de las tejas */
export const loopLength = (l: CrawlerLayout['loop']) => 2 * (l.xb - l.xa) + 2 * Math.PI * l.R;

/**
 * Punto del contorno de las tejas a la distancia s (m) y ángulo de la tangente (rad, en el plano x-y).
 * Empieza en la recta de arriba, en xa, y avanza hacia delante (+x): una oruga que empuja hacia delante mueve
 * las tejas de arriba hacia delante.
 */
export function loopPoint(l: CrawlerLayout['loop'], s: number): { x: number; y: number; a: number } {
  const S = loopLength(l), L = l.xb - l.xa, half = Math.PI * l.R;
  let u = ((s % S) + S) % S;
  if (u < L) return { x: l.xa + u, y: l.yc + l.R, a: 0 };
  u -= L;
  if (u < half) { const t = u / l.R; return { x: l.xb + l.R * Math.sin(t), y: l.yc + l.R * Math.cos(t), a: -t }; }
  u -= half;
  if (u < L) return { x: l.xb - u, y: l.yc - l.R, a: Math.PI };
  u -= L;
  const t = u / l.R;
  return { x: l.xa - l.R * Math.sin(t), y: l.yc - l.R * Math.cos(t), a: Math.PI - t };
}
