import { bodyHalf, type CraneSpec, type WheeledSpec } from '../../crane/cranes';

// Medidas del modelo 3D de una grúa de ruedas, sin three.js (las usan el generador y las pruebas).
// Las fórmulas son las de craneModel() de la referencia; donde la referencia hace que dos piezas se
// atraviesen (pluma con la plataforma, el contrapeso o el equipo de la cubierta), se ajusta y se indica.
// Marco del chasis: x frente, y arriba, z lateral (−z = izquierda). Marco de la superestructura: igual,
// con el origen en el centro de giro (x = piv); la cabina del operador va a la izquierda (−z).

/** Grúas de ruedas con modelo en esta fase (fase 4). */
export const WHEELED_IDS = ['small', 'medium', 'rt', 'large', 'at300', 'at450', 'xl'] as const;
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
    cabTop = T.pivH - bw * 0.63 - 0.12;
  }
  const cabLow = dLo - 0.15;
  const cab: Box3 = { x0: cabX0, x1: L1, y0: cabLow, y1: cabTop, z0: -hf, z1: fullCab ? hf : 0.55 };
  const front0 = cabX0;
  const restX = front0 - 0.35, restH = T.pivH - bw * 0.63 - 0.03;
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
  const corners: [number, number][] = [
    [cwRear - (stack ? 0.2 : 0), cw.w + (stack ? 0.2 : 0)], [cwRear + 0.2, wide], [front, wide],
    [opCab.x0, -opCab.z0], [opCab.x1, -opCab.z0], [drum.x - dr, hl + 0.15],
  ];
  // radio de cola con el lastre completo
  if (T.ballast) {
    const c1 = cwDims(T, 1);
    if (!stack) corners.push([c1.x - c1.len / 2, c1.w]); // la torre tiene la planta de la placa base (ya incluida)
  }
  const tailR = Math.max(...corners.map(([x, z]) => Math.hypot(x, z)));

  // equipo de la cubierta: entre el radio de cola y el apoyo de pluma, por debajo de la pluma tumbada
  const deck = { x0: T.piv + tailR + 0.3, x1: restX - 0.35, top: restH - 0.05 };

  const eye = noCab
    ? { x: opCab.x1 - 0.45, y: opCab.y1 - 0.55, z: (opCab.z0 + opCab.z1) / 2 }
    : { x: L1 - 0.5, y: cabTop - 0.4, z: fullCab ? -hf + 0.7 : (cab.z0 + cab.z1) / 2 };

  return {
    hf, fullCab, noCab, tireHalf: tw2, tireZ: hf - 0.07 - tw2, frameHalf: Math.min(0.8, hf - 0.07 - 2 * tw2 - 0.08), cab, restX, restH, freeGaps, engGap, outBox, deck, eye,
    yd, wide, front, ringR, plateTop, slot, cw, ballast, opCab, housing, rearBlock, drum, luffBase, tailR,
    bw, hu, tail, boomBottom0: T.pivH - hu / 2,
  };
}

/** Placas de lastre con el montaje al avance cwS (cwDims de la referencia; marco de la superestructura). */
export function ballastPlates(T: CraneSpec, L: Layout, cwS: number): { boxes: Box3[]; stack: boolean } {
  const boxes: Box3[] = [];
  const b = L.ballast;
  if (!b) return { boxes, stack: false };
  const cd = cwDims(T, cwS);
  if (b.kind === 'stack') {
    // torre de placas sobre la placa base. La referencia las dibuja redondas; aquí son rectangulares (pedido de
    // Jesús), con la planta del contrapeso de la referencia: largo cwLen (recortado) × ancho 2·w = cwLen.
    const np = stackPlates(cd.hgt), c = L.cw;
    for (let i = 0; i < np; i++) {
      const y = c.y0 + 0.4 + i * 0.42;
      boxes.push({ x0: c.x - c.len / 2, x1: c.x + c.len / 2, y0: y, y1: y + 0.37, z0: -c.w, z1: c.w });
    }
    return { boxes, stack: true };
  } else {
    // la referencia dibuja 1 + round(4·cwS) placas; la primera es el contrapeso base
    const n = Math.round(4 * cwS), x0 = cd.x - cd.len / 2;
    if (n > 0 && b.x1 - x0 > 0.05) {
      const sh = cd.hgt / n;
      for (let i = 0; i < n; i++) {
        boxes.push({ x0, x1: b.x1, y0: L.cw.y0 + i * sh, y1: L.cw.y0 + (i + 1) * sh - (i < n - 1 ? 0.07 : 0), z0: -cd.w, z1: cd.w });
      }
    }
  }
  return { boxes, stack: false };
}

/** Placas de 0,42 m de la torre de lastre para una altura (como la referencia). */
export const stackPlates = (hgt: number) => Math.max(1, Math.round(hgt / 0.42));
