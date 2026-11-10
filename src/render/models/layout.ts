import { bodyHalf, type CraneSpec, type WheeledSpec } from '../../crane/cranes';

// Medidas del modelo 3D de una grúa de ruedas, sin three.js (las usan el generador y las pruebas).
// Las fórmulas son las de craneModel() de la referencia; donde la referencia hace que dos piezas se
// atraviesen (pluma con la plataforma, el contrapeso o el equipo de la cubierta), se ajusta y se indica.
// Marco del chasis: x frente, y arriba, z lateral (−z = izquierda). Marco de la superestructura: igual,
// con el origen en el centro de giro (x = piv); la cabina del operador va a la izquierda (−z).

/** Grúas de ruedas con modelo en esta fase (fase 4). */
export const WHEELED_IDS = ['small', 'medium', 'rt', 'large', 'at300', 'at450', 'xl', 'at650'] as const;
/** Grúas de ruedas con modelo, incluida la grúa torre sobre camión (fase 8) */
export const TRUCK_IDS = [...WHEELED_IDS, 'sk'] as const;
export type WheeledId = (typeof WHEELED_IDS)[number];

export interface CwDims { x: number; len: number; w: number; hgt: number }

/** cwDims() de la referencia; cwS = avance del montaje del lastre (0 sin lastre, 1 montado). */
export function cwDims(T: CraneSpec, cwS = 0): CwDims {
  if (T.cwStyle === 'stack') return { len: T.cwLen, w: T.cwLen / 2, hgt: 0.9 + 4.4 * cwS, x: T.xCw };
  if (T.ballast) return { len: T.cwLen * (0.35 + 0.65 * cwS), w: 1.45 + ((T.cwWide || 2.05) - 1.45) * cwS, hgt: 1.0 + 1.6 * cwS, x: T.xCw + T.cwLen * 0.65 * (1 - cwS) / 2 };
  return { len: T.cwLen, w: T.cwW || (T.crawler ? 2.2 : 1.45), hgt: T.crawler ? (T.id === 'lr' ? 6 : 2.4) : 1.7, x: T.xCw };
}

/** Escala del aparejo del gancho (hookScale de la referencia). */
export const hookScale = (T: CraneSpec) => 0.75 + 0.12 * Math.sqrt(T.structMax / 25);
/** Ramales del cable del gancho (dibujo de la referencia). */
export const hookFalls = (T: CraneSpec) => (T.structMax > 100 ? 4 : 2);

/** Intervalos libres en [a, b] quitando los ocupados (gaps de la referencia). */
export function gaps(a: number, b: number, occ: [number, number][]): [number, number][] {
  const s = [...occ].sort((p, q) => p[0] - q[0]), out: [number, number][] = [];
  let x = a;
  for (const [o0, o1] of s) {
    if (o1 <= x) continue;
    if (o0 > x) out.push([x, Math.min(o0, b)]);
    x = Math.max(x, o1);
    if (x >= b) break;
  }
  if (x < b) out.push([x, b]);
  return out.filter(([p, q]) => q - p > 0.05);
}

export interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface Layout {
  // --- chasis ---
  hf: number;
  /** Cabina del conductor a todo el ancho (solo la AT 60, pedido de Jesús) */
  fullCab: boolean;
  /** Sin cabina del conductor (RT): se conduce desde la cabina de la superestructura */
  noCab: boolean;
  tireHalf: number;
  /** |z| del centro de cada neumático */
  tireZ: number;
  /** Media anchura del bastidor (0,8 m en la referencia; menos si no cabe entre las llantas) */
  frameHalf: number;
  cab: Box3;
  restX: number;
  restH: number;
  /** Tramos libres entre grupos de ejes y cajones de estabilizadores */
  freeGaps: [number, number][];
  engGap: [number, number] | null;
  /** Rango x de cada cajón de estabilizadores (recortado para no tocar las llantas) */
  outBox: [number, number][];
  /** Zona de la cubierta para el equipo (fuera del radio de cola) y altura máxima (bajo la pluma tumbada) */
  deck: { x0: number; x1: number; top: number };
  /** Ojo del conductor en el marco del chasis (o de la superestructura si noCab) */
  eye: { x: number; y: number; z: number };
  // --- superestructura ---
  yd: number;
  wide: number;
  front: number;
  ringR: number;
  /** Placa base: de yd + 0,12 a plateTop, con una ranura bajo el pie de pluma (rango x) de |z| < ancho/2 + 0,08 */
  plateTop: number;
  slot: [number, number];
  /** Contrapeso base (sin lastre) */
  cw: CwDims & { y0: number; top: number; front: number };
  /**
   * Lastre (tecla B). 'slab': placas detrás del contrapeso base, hasta x1 (dejan libre el cabrestante);
   * 'stack': torre de placas (rectangulares) con el cabrestante delante. null si la grúa no monta lastre.
   */
  ballast: { kind: 'slab' | 'stack'; x1: number } | null;
  opCab: Box3;
  housing: Box3 | null;
  rearBlock: Box3 | null;
  /** Cabrestante: centro, radio, media longitud y base de sus soportes */
  drum: { x: number; y: number; r: number; hl: number; y0: number };
  luffBase: { x: number; y: number };
  /** Radio de cola: lo más lejano de la superestructura al centro de giro (en planta) */
  tailR: number;
  // --- pluma ---
  bw: number;
  /** Alto del tramo base */
  hu: number;
  /** Lo que el tramo base sobresale por detrás del pie */
  tail: number;
  /** Parte inferior de la pluma tumbada (ángulo 0) en el marco del chasis */
  boomBottom0: number;
}

/** Esquinas del tramo base (marco de la superestructura, plano x-y) con la pluma a `ang`. */
export function boomCorners(T: CraneSpec, L: Pick<Layout, 'hu' | 'tail'>, ang: number, d1 = T.boom.min): [number, number][] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [[-L.tail, -L.hu / 2], [-L.tail, L.hu / 2], [d1, L.hu / 2], [d1, -L.hu / 2]].map(([d, u]) =>
    [T.foot + d * c - u * s, T.pivH + d * s + u * c] as [number, number]);
}

export function layout(T: WheeledSpec): Layout {
  const [L0, L1] = T.len, hf = bodyHalf(T), wR = T.wheelR, dLo = T.deckLo, dHi = T.deckHi;
  const bw = T.boom.w, hu = bw * 1.25, yd = dHi;
  const fullCab = T.id === 'medium', noCab = !!T.rt;

  // --- chasis (como la referencia) ---
  const tw2 = wR > 0.85 ? 0.38 : wR > 0.72 ? 0.27 : 0.25;
  const axles = [...T.axles].sort((p, q) => p - q);
  const groups: number[][] = [];
  for (const a of axles) { const g = groups[groups.length - 1]; if (g && a - g[g.length - 1] < 2.0) g.push(a); else groups.push([a]); }
  const groupOcc = groups.map((g): [number, number] => [g[0] - wR - 0.2, g[g.length - 1] + wR + 0.2]);
  const outOcc = [T.out.xf, T.out.xr].map((x): [number, number] => [x - 0.6, x + 0.6]);
  const tireFront = axles[axles.length - 1] + wR + 0.12;
  let cabX0: number, cabTop: number;
  if (noCab) { cabX0 = L1 - 0.4; cabTop = dHi; }
  else {
    cabX0 = Math.max(L1 - 2.05, tireFront, T.out.xf + 0.6 > tireFront && T.out.xf < L1 ? T.out.xf + 0.6 : -99);
    // grúa torre (SK 60): la cabina queda bajo la torre plegada (referencia: dHi + 0,9; aproximación visual: la pluma
    // plegada va de dHi + 0,65 hacia arriba, ver models/tower.ts)
    cabTop = T.tower ? dHi + 0.6 : T.pivH - bw * 0.63 - 0.12;
  }
  const cabLow = dLo - 0.15;
  const cab: Box3 = { x0: cabX0, x1: L1, y0: cabLow, y1: cabTop, z0: -hf, z1: fullCab ? hf : 0.55 };
  const front0 = cabX0;
  const restX = front0 - 0.35, restH = T.tower ? dHi + 0.6 : T.pivH - bw * 0.63 - 0.03;
  const freeGaps = gaps(L0 + 0.2, front0 - 0.1, [...groupOcc, ...outOcc]);
  const big = [...freeGaps].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  const engGap = big && big[1] - big[0] > 1.2 ? big : null;
  // cajones de estabilizadores: ±0,55 m como la referencia, recortados si tocarían una llanta
  const outBox = [T.out.xf, T.out.xr].map((x): [number, number] => {
    let lo = x - 0.55, hi = x + 0.55;
    for (const a of axles) {
      // margen = guardabarros (radio wR + 0,15 a 18° de la horizontal) + 5 cm
      if (a <= x && a + wR + 0.18 > lo) lo = a + wR + 0.18;
      if (a > x && a - wR - 0.18 < hi) hi = a - wR - 0.18;
    }
    return [lo, hi];
  });

  // --- superestructura ---
  const bigSup = T.structMax >= 300 || T.id === 'xl';
  const wide = T.supW || (bigSup ? 1.5 : 1.3), front = T.supFront || (bigSup ? 3.0 : 2.4);
  const ringR = T.ringR || 1.35;
  const plateTop = yd + 0.25;
  // Tramo base: la referencia lo alarga 1 m por detrás del pie. Al girar la pluma, ese extremo baja (lo más bajo
  // es pivH − √(cola² + (alto/2)²)); la placa base lleva una ranura bajo el pie de pluma y la cola se acorta
  // para que su esquina quede 5 cm por encima de la corona.
  const aM = T.boom.angMax;
  const m = T.pivH - (yd + 0.12) - 0.05;
  const tail = Math.max(0.2, Math.min(1.0, Math.sqrt(Math.max(0, m * m - (hu / 2) ** 2))));
  const slot: [number, number] = [T.foot - tail - 0.1, T.foot + hu / 2 + 0.1];
  // lo más atrás que llega la pluma en todo su recorrido
  let boomBack = Infinity;
  for (let a = T.boom.angMin; a <= aM + 1e-9; a += (aM - T.boom.angMin) / 24 || 1) {
    for (const [x] of boomCorners(T, { hu, tail }, a)) boomBack = Math.min(boomBack, x);
  }
  // Contrapeso (cwDims sin lastre). Su frente se recorta si la pluma levantada lo tocaría (aproximación visual).
  const cd = cwDims(T, 0);
  const stack = T.cwStyle === 'stack';
  const cwFront = Math.min(cd.x + cd.len / 2, boomBack - 0.12);
  const cwRear = cd.x - cd.len / 2;
  const cw = { ...cd, len: cwFront - cwRear, x: (cwFront + cwRear) / 2, y0: plateTop, front: cwFront,
    top: stack ? plateTop + 0.4 + Math.max(1, Math.round(cd.hgt / 0.42)) * 0.42 : plateTop + cd.hgt };
  // Cabrestante sobre el frente del contrapeso (la referencia lo pone dentro del contrapeso). Con torre de lastre
  // (que crece 4,4 m) va delante de la torre, sobre el bloque trasero (aproximación visual).
  const dr = 0.42, hl = bw / 2 + 0.3;
  const rbx1 = Math.min(T.foot - 0.75, boomBack - 0.12);
  const rbTop = yd + 0.55;
  const drumFront = !!T.ballast && stack;
  const drum = drumFront
    ? { x: cwFront + 0.6, y: rbTop + dr + 0.3, r: dr, hl, y0: rbTop }
    : { x: cwFront - dr - 0.1, y: cw.top + dr + 0.08, r: dr, hl, y0: cw.top };
  // Lastre en placas: detrás del contrapeso base y del cabrestante (aproximación visual: la referencia apila
  // placas de todo el largo, que atravesarían el cabrestante)
  const ballast: Layout['ballast'] = !T.ballast ? null : stack ? { kind: 'stack', x1: cwFront }
    : { kind: 'slab', x1: Math.min(cwFront - T.cwLen * 0.35, drum.x - 0.6) };
  // Cabina del operador a la izquierda, por fuera de los soportes del pie de pluma (2,05 × 0,95 × 1,85 m de la
  // referencia; la AT 60 conserva la de 2,5 m de largo de la fase 3)
  const oz1 = -(bw / 2 + 0.42), oz0 = oz1 - 0.95;
  const opCab: Box3 = fullCab
    ? { x0: -0.6, x1: 1.9, y0: yd + 0.4, y1: yd + 2.25, z0: oz0, z1: oz1 }
    : { x0: 0.2, x1: 2.25, y0: yd + 0.4, y1: yd + 2.25, z0: oz0, z1: oz1 };
  const hz0 = bw / 2 + 0.42;
  const housing: Box3 | null = wide - hz0 > 0.25 ? { x0: cwFront, x1: front - 0.2, y0: plateTop, y1: yd + 1.45, z0: hz0, z1: wide } : null;
  const rearBlock: Box3 | null = rbx1 - cwFront > 0.15 ? { x0: cwFront, x1: rbx1, y0: plateTop, y1: rbTop, z0: -wide, z1: wide } : null;
  const luffBase = { x: front - 0.9, y: plateTop + 0.05 };
  // (con lastre, la placa base de la torre ya no sobresale 0,2 m: son las torres de towerPlan)
  // contrapeso fijo sin lastre: el contorno achaflanado de su bloque (fase 8B)
  const fb = ballast ? null : fixedBlock({ cw, ballast });
  const cwCorners: [number, number][] = fb ? towerOutline(blockPieces(fb).plan) : [[cwRear, cw.w]];
  const corners: [number, number][] = [
    ...cwCorners, [cwRear + 0.2, wide], [front, wide],
    [opCab.x0, -opCab.z0], [opCab.x1, -opCab.z0], [drum.x - dr, hl + 0.15],
  ];
  // radio de cola con el lastre completo: las dos torres con su chaflán
  const tp = ballast && towerPlan(T, cw, ballast, 1);
  if (tp) corners.push(...towerOutline(tp));
  const tailR = Math.max(...corners.map(([x, z]) => Math.hypot(x, z)));

  // equipo de la cubierta: entre el radio de cola y el apoyo de pluma, por debajo de la pluma tumbada
  // (grúa torre: la superestructura es la plataforma de 2,9 m; el contrapeso va arriba, en la contrapluma)
  const deck = { x0: T.piv + (T.tower ? 3.0 : tailR) + 0.3, x1: restX - 0.35, top: restH - 0.05 };

  const eye = noCab
    ? { x: opCab.x1 - 0.45, y: opCab.y1 - 0.55, z: (opCab.z0 + opCab.z1) / 2 }
    : { x: L1 - 0.5, y: cabTop - 0.4, z: fullCab ? -hf + 0.7 : (cab.z0 + cab.z1) / 2 };

  return {
    hf, fullCab, noCab, tireHalf: tw2, tireZ: hf - 0.07 - tw2, frameHalf: Math.min(0.8, hf - 0.07 - 2 * tw2 - 0.08), cab, restX, restH, freeGaps, engGap, outBox, deck, eye,
    yd, wide, front, ringR, plateTop, slot, cw, ballast, opCab, housing, rearBlock, drum, luffBase, tailR,
    bw, hu, tail, boomBottom0: T.pivH - hu / 2,
  };
}

/**
 * Planta de las dos torres de lastre (fase 7, referencia/imagenes/contrapeso-torres.png): una a cada lado de un
 * bastidor central, con un hueco en medio y la esquina exterior trasera achaflanada. Solo es dibujo: ocupan la
 * planta de cwDims() de la referencia (la masa no cambia). Marco de la superestructura; la torre izquierda es la
 * simétrica (z → −z). null si con este avance todavía no hay placas.
 */
export interface TowerPlan {
  /** Atrás y adelante (x) */
  xr: number;
  xf: number;
  /** |z| del lado interior (hueco central) y exterior */
  zi: number;
  zo: number;
  /** Chaflán de la esquina exterior trasera: lo que recorta en x y en z (fracción fija del largo y del ancho) */
  chx: number;
  chz: number;
  /** Altura de la base de la torre (sobre la placa base de la superestructura) */
  y0: number;
  /** Pieza base de la torre (de y0 a y0 + base; 0 si no hay) y placas apiladas encima: [abajo, arriba] */
  base: number;
  plates: [number, number][];
}

/** Fracciones del chaflán (en planta) respecto del largo y del ancho de la torre */
export const CHAMFER_X = 0.3;
export const CHAMFER_Z = 0.4;
/** Medio hueco entre las torres: un 28 % de la media anchura, entre 0,35 y 0,6 m (aproximación visual) */
export const towerGap = (zo: number) => Math.max(0.35, Math.min(0.6, 0.28 * zo));

export function towerPlan(T: CraneSpec, cw: Layout['cw'], ballast: NonNullable<Layout['ballast']>, cwS: number): TowerPlan | null {
  const cd = cwDims(T, cwS);
  let xr: number, xf: number, base: number;
  const plates: [number, number][] = [];
  const y0 = cw.y0;
  if (ballast.kind === 'stack') {
    // torre que crece 4,4 m (cwDims) en placas de 0,42 m sobre una pieza base de 0,4 m
    xr = cw.x - cw.len / 2;
    xf = cw.front;
    base = 0.4;
    const np = stackPlates(cd.hgt);
    for (let i = 0; i < np; i++) { const y = y0 + base + i * 0.42; plates.push([y, y + 0.37]); }
  } else {
    // placas detrás del contrapeso base (que lleva el cabrestante): crecen en largo, ancho y alto con cwDims
    xr = cd.x - cd.len / 2;
    xf = ballast.x1;
    base = 0;
    if (xf - xr <= 0.05) return null;
    const np = Math.max(1, Math.round(cd.hgt / 0.42)), sh = cd.hgt / np;
    for (let i = 0; i < np; i++) plates.push([y0 + i * sh, y0 + (i + 1) * sh - (i < np - 1 ? 0.05 : 0)]);
  }
  const zo = cd.w, zi = towerGap(zo);
  return { xr, xf, zi, zo, chx: CHAMFER_X * (xf - xr), chz: CHAMFER_Z * (zo - zi), y0, base, plates };
}

/**
 * Bloque de contrapeso en el estilo de contrapeso-torres.png (fase 8B), sin three.js: dos mitades (+z y −z) de placas
 * apiladas con la esquina exterior trasera (−x) achaflanada. Con `zi` = 0 las mitades se tocan (un solo bloque, para
 * los contrapesos cortos donde no caben dos torres); con `zi` > 0 queda un hueco central, opcionalmente con bastidor
 * ('low': medio alto, 'full': todo el alto, como en las orugas, donde se atan los tirantes), barandilla y argollas.
 * `chamfer` = false: placas rectas (van en `frame`, como cajas). Las `top` placas de arriba van en el color de la grúa.
 */
export interface BlockSpec {
  xr: number; xf: number; zi: number; zo: number; y0: number; hgt: number;
  /** número de placas (por defecto, una cada ~0,42 m) */
  n?: number;
  top?: number;
  frame?: 'none' | 'low' | 'full';
  rail?: boolean;
  lugs?: boolean;
  chamfer?: boolean;
}

export function blockPieces(b: BlockSpec): { plates: Plate[]; frame: FramePart[]; plan: TowerPlan } {
  const n = b.n ?? Math.max(1, Math.round(b.hgt / 0.42)), sh = b.hgt / n, top = b.top ?? 2;
  const ys: [number, number][] = [];
  for (let i = 0; i < n; i++) ys.push([b.y0 + i * sh, b.y0 + (i + 1) * sh - (i < n - 1 ? 0.05 : 0)]);
  const chamfer = b.chamfer ?? true;
  const plan: TowerPlan = { xr: b.xr, xf: b.xf, zi: b.zi, zo: b.zo, chx: chamfer ? CHAMFER_X * (b.xf - b.xr) : 0,
    chz: chamfer ? CHAMFER_Z * (b.zo - b.zi) : 0, y0: b.y0, base: 0, plates: ys };
  const plates: Plate[] = [], frame: FramePart[] = [];
  for (const side of [1, -1] as const) {
    const zz = side > 0 ? { z0: b.zi, z1: b.zo } : { z0: -b.zo, z1: -b.zi };
    ys.forEach(([y0, y1], i) => {
      const color = i >= n - top ? 'top' : 'grey';
      const box = { x0: b.xr, x1: b.xf, y0, y1, ...zz };
      if (chamfer) plates.push({ box, side, color }); else frame.push({ box, color });
    });
    if (b.lugs) {
      const xm = (b.xr + plan.chx + b.xf) / 2, zm = (side * (b.zi + b.zo)) / 2, yt = b.y0 + b.hgt;
      frame.push({ box: { x0: xm - 0.15, x1: xm + 0.15, y0: yt, y1: yt + 0.22, z0: zm - 0.06, z1: zm + 0.06 }, color: 'lug' });
    }
  }
  if (b.zi > 0.1 && b.frame && b.frame !== 'none') {
    const fz = b.zi - 0.05, fx0 = b.xr + 0.15, ft = b.y0 + (b.frame === 'full' ? b.hgt : 0.5 * b.hgt);
    frame.push({ box: { x0: fx0, x1: b.xf, y0: b.y0, y1: ft, z0: -fz, z1: fz }, color: 'frame' });
    if (b.rail) {
      const rz = fz - 0.08, rh = 1.0, t = 0.05;
      for (const s2 of [-1, 1]) {
        const z0 = s2 * rz - t / 2, z1 = s2 * rz + t / 2;
        for (const x of [fx0 + 0.1, b.xf - 0.1]) frame.push({ box: { x0: x - t / 2, x1: x + t / 2, y0: ft, y1: ft + rh, z0, z1 }, color: 'rail' });
        for (const y of [ft + rh - t, ft + rh / 2]) frame.push({ box: { x0: fx0 + 0.1, x1: b.xf - 0.1, y0: y, y1: y + t, z0, z1 }, color: 'rail' });
      }
    }
  }
  return { plates, frame, plan };
}

/**
 * Contrapeso fijo de una grúa de ruedas (fase 8B), dentro de la planta de `L.cw` (cwDims de la referencia, con el frente
 * recortado si la pluma lo tocaría). Sin lastre: un bloque de placas achaflanadas; dos torres con hueco y bastidor si
 * mide 2,5 m de largo o más (AT 220). Con lastre de placas ('slab'): el contrapeso base (lleva el cabrestante) en placas
 * rectas, porque las torres de lastre van detrás. Torre de lastre ('stack'): la pieza base ya es parte de la torre.
 */
export function fixedBlock(L: Pick<Layout, 'cw' | 'ballast'>): BlockSpec | null {
  const cw = L.cw, xr = cw.x - cw.len / 2;
  if (L.ballast?.kind === 'stack') return null;
  if (L.ballast) return { xr, xf: cw.front, zi: 0, zo: cw.w, y0: cw.y0, hgt: cw.hgt, chamfer: false, top: 0 };
  const towers = cw.len >= 2.5;
  return { xr, xf: cw.front, zi: towers ? towerGap(cw.w) : 0, zo: cw.w, y0: cw.y0, hgt: cw.hgt, frame: towers ? 'low' : 'none', lugs: towers };
}

/** Contorno en planta (x, z) de la torre derecha (+z), con el chaflán. */
export function towerOutline(p: TowerPlan): [number, number][] {
  return [[p.xr + p.chx, p.zo], [p.xf, p.zo], [p.xf, p.zi], [p.xr, p.zi], [p.xr, p.zo - p.chz]];
}

/** Placa de una torre (caja envolvente; el dibujo recorta el chaflán). side: +1 derecha, −1 izquierda. */
export interface Plate { box: Box3; side: 1 | -1; color: 'base' | 'grey' | 'top' }

/** Bastidor central, barandillas y argollas (cajas) */
export interface FramePart { box: Box3; color: 'frame' | 'rail' | 'lug' | 'grey' | 'top' }

/**
 * Lastre con el montaje al avance cwS: placas de las dos torres, bastidor central con barandilla y argollas.
 * `boxes` = todo junto (para las pruebas de choques). Las dos placas de arriba del lastre completo van en el color
 * de la grúa (lastre básico arriba, como la imagen); las demás, grises.
 */
export function ballastPlates(T: CraneSpec, L: Layout, cwS: number): { plates: Plate[]; frame: FramePart[]; boxes: Box3[]; stack: boolean } {
  const plates: Plate[] = [], frame: FramePart[] = [];
  const b = L.ballast, stack = b?.kind === 'stack';
  const all = () => [...plates.map((q) => q.box), ...frame.map((f) => f.box)];
  const p = b && towerPlan(T, L.cw, b, cwS);
  if (!b || !p) return { plates, frame, boxes: all(), stack };
  const nFull = towerPlan(T, L.cw, b, 1)!.plates.length;
  for (const side of [1, -1] as const) {
    const z = (a: number, c: number) => (side > 0 ? { z0: a, z1: c } : { z0: -c, z1: -a });
    const zz = z(p.zi, p.zo);
    if (p.base > 0) plates.push({ box: { x0: p.xr, x1: p.xf, y0: p.y0, y1: p.y0 + p.base - 0.04, ...zz }, side, color: 'base' });
    p.plates.forEach(([y0, y1], i) => {
      plates.push({ box: { x0: p.xr, x1: p.xf, y0, y1, ...zz }, side, color: i >= nFull - 2 ? 'top' : 'grey' });
    });
    // argolla para izar la torre, arriba en el centro
    const top = p.plates[p.plates.length - 1][1], xm = (p.xr + p.chx + p.xf) / 2, zm = (p.zi + p.zo) / 2;
    const lh = Math.min(0.15, (p.xf - p.xr - p.chx) / 2);
    frame.push({ box: { x0: xm - lh, x1: xm + lh, y0: top, y1: top + 0.22, ...z(zm - 0.06, zm + 0.06) }, color: 'lug' });
  }
  // bastidor central entre las torres y barandilla encima
  const fh = stack ? 1.0 : Math.min(1.0, 0.5 * (p.plates[p.plates.length - 1][1] - p.y0));
  const fz = p.zi - 0.05, fx0 = p.xr + 0.15, ft = p.y0 + fh;
  // (al empezar a montar el lastre de placas las torres son todavía muy cortas: sin bastidor)
  if (p.xf - fx0 < 0.5) return { plates, frame, boxes: all(), stack };
  frame.push({ box: { x0: fx0, x1: p.xf, y0: p.y0, y1: ft, z0: -fz, z1: fz }, color: 'frame' });
  const rz = fz - 0.08, rh = 1.0, t = 0.05;
  for (const s of [-1, 1]) {
    const z0 = s * rz - t / 2, z1 = s * rz + t / 2;
    for (const x of [fx0 + 0.1, p.xf - 0.1]) frame.push({ box: { x0: x - t / 2, x1: x + t / 2, y0: ft, y1: ft + rh, z0, z1 }, color: 'rail' });
    for (const y of [ft + rh - t, ft + rh / 2]) frame.push({ box: { x0: fx0 + 0.1, x1: p.xf - 0.1, y0: y, y1: y + t, z0, z1 }, color: 'rail' });
  }
  return { plates, frame, boxes: all(), stack };
}

/**
 * Todo el contrapeso dibujado de una grúa de ruedas (fase 8B): el fijo (fixedBlock) más el lastre al avance cwS.
 * Es lo que dibuja CraneModel y lo que usan los choques del contrapeso.
 */
export function cwPieces(T: CraneSpec, L: Layout, cwS: number): { plates: Plate[]; frame: FramePart[]; boxes: Box3[] } {
  const b = ballastPlates(T, L, cwS), fb = fixedBlock(L);
  if (!fb) return b;
  const f = blockPieces(fb);
  return { plates: [...f.plates, ...b.plates], frame: [...f.frame, ...b.frame],
    boxes: [...f.plates.map((q) => q.box), ...f.frame.map((q) => q.box), ...b.boxes] };
}

/** Placas de 0,42 m de la torre de lastre para una altura (como la referencia). */
export const stackPlates = (hgt: number) => Math.max(1, Math.round(hgt / 0.42));
