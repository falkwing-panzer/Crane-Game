// Fase 17: decorado de fondo de cada nivel (sin three.js). Con una semilla por nivel sale siempre igual. Todo queda
// fuera de la obra: valla a 3 m del borde, pasillo libre hasta 5,2 m y, más allá, el recinto de obra (casetas, baños,
// acopios, maquinaria parada) junto al portón y los alrededores según el tipo de nivel. Aproximación visual: la
// referencia no tiene decorado. Lo que está a menos de NEAR m de la obra va en la capa cercana (sombras y
// colisionadores para la carga y el gancho); lo demás, en la lejana.

import type { Level } from '../levels/levels';
import { levelSize } from '../levels/setup';
import {
  Kit, DC, arbol, bano, barco, bolardo, camion, carretilla, caseta, chimenea, coche, columna, cono, contenedores,
  edificio, excavadora, farola, ferralla, foco, hormigonera, mastil, nave, pales, placasLastre, porticoMuelle,
  posteMT, puente, rack, subestacion, tanque, torreAT, tubos, volquete, type P3,
} from './kit';

export type Env = 'port' | 'urban' | 'dense' | 'electric' | 'bridge' | 'forest' | 'field' | 'logistics' | 'refinery' | 'industrial' | 'yard';
export type Side = 'n' | 's' | 'w' | 'e';
export interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Entorno de cada nivel (1…14); la prueba libre es un patio de maquinaria */
export const LEVEL_ENV: Env[] = ['port', 'urban', 'electric', 'bridge', 'forest', 'dense', 'field', 'logistics', 'refinery',
  'urban', 'industrial', 'urban', 'refinery', 'refinery'];

/** Lado y posición del portón (cerca de donde empieza la grúa) */
const GATES: [Side, number][] = [['s', 12], ['w', 25], ['w', 47], ['w', 30], ['w', 44], ['w', 46], ['w', 46], ['w', 28],
  ['w', 28], ['w', 26], ['w', 26], ['s', 10], ['s', 40], ['s', 60]];

/** Distancia a la obra de la capa cercana (m) */
export const NEAR = 55;
/** Valla a 3 m del borde; pasillo libre hasta FREE m (los trabajadores caminan por él) */
export const FENCE = 3, FREE = 5.2;
/** Medio lado de la prueba libre (= SITE_HALF de physics/world; una prueba lo comprueba) */
export const SITE_HALF_DECOR = 150;

/** Suelo exterior: dos colores que se mezclan con ruido */
export interface GroundLook { a: string; b: string }
export type FlatKind = 'dirt' | 'gravel' | 'concrete' | 'road' | 'side' | 'line' | 'grass';
export interface Flat { kind: FlatKind; x0: number; x1: number; z0: number; z1: number }
export interface Route { pts: [number, number][]; loop: boolean; n: number; speed: number }
export interface Walker { a: [number, number]; b: [number, number] }

export interface Decor {
  env: Env;
  /** Obra (en la prueba libre, ±150 m) */
  rect: Rect;
  /** Centro del decorado (horizonte, nubes, suelo) */
  center: [number, number];
  kit: Kit;
  flats: Flat[];
  water: Rect[];
  wires: [P3, P3][];
  socks: P3[];
  flags: { p: P3; c: string }[];
  routes: Route[];
  walkers: Walker[];
  ground: GroundLook;
  city: boolean;
  /** Cuadrícula de 5 m en el suelo (solo la prueba libre) */
  grid: boolean;
  /** Zonas donde no puede haber nada sólido (la obra con su pasillo y, en el nivel 11, la franja del plumín) */
  keep: Rect[];
  /** Semilla usada (horizonte y nubes) */
  seed: number;
  /** (interno) colocar sin reservas */
  direct?: (x: number, z: number, r: number, fn: (kk: Kit) => void) => void;
}

/** PRNG de 32 bits (mulberry32): mismo nivel, mismo decorado */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distancia de un punto a un rectángulo (0 dentro) */
export function rectDist(r: Rect, x: number, z: number) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** Coloca piezas sin que se pisen ni entren en las zonas reservadas; la capa sale de la distancia a la obra */
class Placer {
  readonly used: Rect[] = [];
  constructor(readonly k: Kit, readonly site: Rect, readonly keep: Rect[], readonly R: () => number) {}

  free(r: Rect) {
    return !this.keep.some((q) => overlap(q, r)) && !this.used.some((q) => overlap(q, r));
  }

  /** Pieza de w × d (marco local, x a lo largo) en (x, z) girada r; pad = separación con lo demás */
  put(x: number, z: number, r: number, w: number, d: number, fn: (k: Kit) => void, pad = 0.6) {
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    const hx = (c * w + s * d) / 2, hz = (s * w + c * d) / 2;
    const box = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
    if (!this.free(grow(box, pad))) return false;
    this.used.push(box);
    const k = this.k;
    k.layer = rectDist(this.site, x, z) - Math.max(hx, hz) < NEAR ? 'near' : 'far';
    k.at(x, z, r, () => fn(k));
    k.layer = 'near';
    return true;
  }

  /** Intenta n piezas en puntos al azar a una distancia de la obra entre d0 y d1 */
  scatter(n: number, d0: number, d1: number, tries: number, fn: (x: number, z: number) => boolean) {
    const s = this.site, R = this.R;
    let ok = 0;
    for (let i = 0; i < tries && ok < n; i++) {
      const x = s.x0 - d1 + R() * (s.x1 - s.x0 + 2 * d1), z = s.z0 - d1 + R() * (s.z1 - s.z0 + 2 * d1);
      const dd = rectDist(s, x, z);
      if (dd < d0 || dd > d1) continue;
      if (fn(x, z)) ok++;
    }
    return ok;
  }
}

/** Marco de un lado de la obra: u a lo largo, v hacia fuera; r = giro con x local a lo largo y z local hacia fuera */
function sideFrame(site: Rect, side: Side, at: number) {
  const r = side === 's' ? 0 : side === 'n' ? Math.PI : side === 'w' ? -Math.PI / 2 : Math.PI / 2;
  const o: [number, number] = side === 'n' ? [at, site.z0] : side === 's' ? [at, site.z1] : side === 'w' ? [site.x0, at] : [site.x1, at];
  const c = Math.cos(r), s = Math.sin(r);
  const p = (u: number, v: number): [number, number] => [o[0] + c * u + s * v, o[1] - s * u + c * v];
  return { r, p };
}

const CARS = ['#8b2f2a', '#2f4f7a', '#c9ccc4', '#3a3d40', '#6b7d5a', '#b9a77a', '#4a6f8a'];
const BOXES = ['#3d6f8f', '#7a3b33', '#4f7a4a', '#8a6a2a', '#5d6d7a', '#a8473a', '#2f5d6b'];
const FACADE = ['#a9a296', '#8f9295', '#b7aa92', '#9c8a78', '#7d8790', '#c2bbb0', '#8a7f72'];

/**
 * Decorado de un nivel (nivel = 1…14, con L) o de la prueba libre (L = null). Sin three.js: datos para
 * `render/decorView.ts`, colisionadores para `Physics.addDecor` y pruebas.
 */
export function decorFor(nivel: number, L: Level | null): Decor {
  const free = !L;
  const env: Env = free ? 'yard' : LEVEL_ENV[nivel - 1] ?? 'industrial';
  const seed = free ? 977 : nivel * 7919 + 13;
  const R = rng(seed);
  const rnd = (a: number, b: number) => a + R() * (b - a);
  const pick = <T,>(l: T[]) => l[Math.floor(R() * l.length) % l.length];
  let site: Rect;
  if (L) { const [w, d] = levelSize(L); site = { x0: 0, x1: w, z0: 0, z1: d }; }
  else site = { x0: -SITE_HALF_DECOR, x1: SITE_HALF_DECOR, z0: -SITE_HALF_DECOR, z1: SITE_HALF_DECOR };
  const center: [number, number] = [(site.x0 + site.x1) / 2, (site.z0 + site.z1) / 2];
  const [gSide, gAt] = free ? (['s', 0] as [Side, number]) : GATES[nivel - 1] ?? (['s', (site.x0 + site.x1) / 2] as [Side, number]);
  const gateW = nivel === 11 ? 16 : 9;

  const k = new Kit();
  const D: Decor = {
    env, rect: site, center, kit: k, flats: [], water: [], wires: [], socks: [], flags: [], routes: [], walkers: [],
    ground: GROUND[env], city: env === 'urban' || env === 'dense', grid: free, keep: [grow(site, FREE)], seed,
  };
  const keep = [...D.keep];
  const P = new Placer(k, site, keep, R);
  const road = (x0: number, x1: number, z0: number, z1: number, kind: FlatKind = 'road', block = true) => {
    D.flats.push({ kind, x0, x1, z0, z1 });
    if (block) keep.push({ x0, x1, z0, z1 });
  };
  const paved = env !== 'electric' && env !== 'bridge' && env !== 'forest' && env !== 'field';

  /** Coloca sin mirar las reservas (piezas que van sobre el muelle o el agua) */
  const direct = (x: number, z: number, r: number, fn: (kk: Kit) => void) => {
    k.layer = rectDist(site, x, z) < NEAR ? 'near' : 'far';
    k.at(x, z, r, () => fn(k));
    k.layer = 'near';
  };
  D.direct = direct;

  // ——— reservas propias de cada nivel ———
  if (nivel === 11) {
    // el plumín se tiende al oeste desde x ≈ 14 y sale de la parcela: franja libre
    const band = { x0: -50, x1: 0, z0: 22, z1: 30 };
    keep.push(band); D.keep.push(band);
  }
  if (env === 'bridge') {
    // el río sigue al norte y al sur (mismo cauce que en la obra)
    for (const s of L!.soft ?? []) if (s.kind === 'water') {
      const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2;
      D.water.push({ x0, x1, z0: -420, z1: site.z0 }, { x0, x1, z0: site.z1, z1: 480 });
      keep.push({ x0: x0 - 3, x1: x1 + 3, z0: -420, z1: site.z0 + 1 }, { x0: x0 - 3, x1: x1 + 3, z0: site.z1 - 1, z1: 480 });
    }
  }
  if (env === 'port') {
    // muelle al norte y agua más allá
    const qz = site.z0 - 40;
    D.water.push({ x0: center[0] - 600, x1: center[0] + 600, z0: qz - 520, z1: qz });
    keep.push({ x0: center[0] - 600, x1: center[0] + 600, z0: qz - 520, z1: qz + 1 });
    road(site.x0 - 120, site.x1 + 120, qz, site.z0 - FENCE - 1, 'concrete');
  }
  if (nivel === 2) {
    // la calle de la obra sigue al este y al oeste
    road(-420, site.x0, 21, 29); road(site.x1, 480, 21, 29);
    for (const x0 of [-420, site.x1]) { road(x0, x0 + (x0 < 0 ? 420 + site.x0 - FENCE : 420), 19, 21, 'side', false); road(x0, x0 + (x0 < 0 ? 420 + site.x0 - FENCE : 420), 29, 31, 'side', false); }
  }

  // ——— camino de acceso desde el portón ———
  const G = sideFrame(site, gSide, gAt);
  {
    const a = G.p(-4, 0), b = G.p(4, 260);
    road(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), paved ? 'road' : 'dirt');
  }

  // ——— calle perimetral (entornos urbanos e industriales) ———
  if (paved && env !== 'port') {
    const o0 = 17, o1 = 25;
    const s = site;
    road(s.x0 - o1, s.x1 + o1, s.z0 - o1, s.z0 - o0); road(s.x0 - o1, s.x1 + o1, s.z1 + o0, s.z1 + o1);
    road(s.x0 - o1, s.x0 - o0, s.z0 - o0, s.z1 + o0); road(s.x1 + o0, s.x1 + o1, s.z0 - o0, s.z1 + o0);
    if (env === 'urban' || env === 'dense' || env === 'yard') {
      // aceras
      for (const [x0, x1, z0, z1] of [[s.x0 - o1 - 2.5, s.x1 + o1 + 2.5, s.z0 - o1 - 2.5, s.z0 - o1], [s.x0 - o1 - 2.5, s.x1 + o1 + 2.5, s.z1 + o1, s.z1 + o1 + 2.5],
        [s.x0 - o1 - 2.5, s.x0 - o1, s.z0 - o1, s.z1 + o1], [s.x1 + o1, s.x1 + o1 + 2.5, s.z0 - o1, s.z1 + o1]]) road(x0, x1, z0, z1, 'side', false);
      // farolas en la acera de fuera
      const ring = perimeter(s, o1 + 1.3);
      for (const [x, z, r] of along(ring, 28)) P.put(x, z, r + Math.PI / 2, 0.6, 0.6, (kk) => farola(kk), 0);
    }
    // líneas del centro de la calle
    for (const [x, z, r] of along(perimeter(s, (o0 + o1) / 2), 9)) {
      const ax = Math.abs(Math.cos(r)) > 0.5;
      D.flats.push(ax ? { kind: 'line', x0: x - 1.5, x1: x + 1.5, z0: z - 0.08, z1: z + 0.08 } : { kind: 'line', x0: x - 0.08, x1: x + 0.08, z0: z - 1.5, z1: z + 1.5 });
    }
    D.routes.push({ pts: perimeter(site, 19).concat(), loop: true, n: env === 'refinery' ? 2 : 3, speed: 9 });
    // coches aparcados junto al bordillo de fuera
    if (env !== 'refinery') for (const [x, z, r] of along(perimeter(s, o1 - 1.2), 23)) if (R() < 0.55 && !D.keep.slice(1).some((q) => rectDist(q, x, z) < 3)) {
      D.kit.layer = 'near';
      const kk = D.kit;
      kk.solid = false;
      kk.at(x, z, r, () => coche(kk, pick(CARS)));
      kk.solid = true;
    }
  } else if (!free) {
    // carretera de paso a 60 m del lado del portón (entornos de campo)
    const a = G.p(-420, 60), b = G.p(420, 68);
    road(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), 'road');
    D.routes.push({ pts: [G.p(-400, 62), G.p(400, 62)], loop: false, n: 2, speed: 13 });
    D.routes.push({ pts: [G.p(400, 66), G.p(-400, 66)], loop: false, n: 1, speed: 12 });
  }

  // ——— líneas eléctricas que siguen fuera de la obra ———
  const lines = L?.lines ?? [];
  for (const l of lines) {
    const alongX = l.a[1] === l.b[1];
    const lo = alongX ? site.x0 : site.z0, hi = alongX ? site.x1 : site.z1, c = alongX ? l.a[1] : l.a[0];
    const tower = l.clear >= 5;
    for (const [from, to] of [[lo, lo - 380], [hi, hi + 380]]) {
      const P3a: P3 = alongX ? [from, l.y, c] : [c, l.y, from], P3b: P3 = alongX ? [to, l.y, c] : [c, l.y, to];
      for (const off of [-0.5, 0, 0.5]) {
        const o = (p: P3): P3 => (alongX ? [p[0], p[1], p[2] + off] : [p[0] + off, p[1], p[2]]);
        D.wires.push([o(P3a), o(P3b)]);
      }
      const dir = Math.sign(to - from);
      for (let t = 30; t < 380; t += tower ? 60 : 40) {
        const v = from + dir * t;
        const [x, z] = alongX ? [v, c] : [c, v];
        P.put(x, z, alongX ? 0 : Math.PI / 2, 6, 6, (kk) => (tower ? torreAT(kk, l.y) : posteMT(kk, l.y)), 0);
      }
      // pasillo bajo la línea sin nada alto
      keep.push(alongX ? { x0: Math.min(from, to), x1: Math.max(from, to), z0: c - 7, z1: c + 7 }
        : { x0: c - 7, x1: c + 7, z0: Math.min(from, to), z1: Math.max(from, to) });
    }
  }

  // ——— valla con portón ———
  fenceRing(D, site, gSide, gAt, gateW, env === 'urban' || env === 'dense');

  // ——— recinto de obra junto al portón ———
  const C = (u: number, v: number, r: number, w: number, d: number, fn: (kk: Kit) => void, pad = 0.5) => {
    const [x, z] = G.p(u, v);
    return P.put(x, z, G.r + r, w, d, fn, pad);
  };
  const s1 = gateW / 2 + 4;
  C(s1 + 4, 8.6, 0, 6.2, 2.6, (kk) => caseta(kk, DC.white, true));
  C(s1 + 11, 8.6, 0, 6.2, 2.6, (kk) => caseta(kk, DC.blue));
  C(s1 + 18, 8.6, 0, 6.2, 2.6, (kk) => caseta(kk, DC.white));
  C(s1 + 23, 7.0, 0, 1.3, 1.3, (kk) => bano(kk));
  C(s1 + 24.6, 7.0, 0, 1.3, 1.3, (kk) => bano(kk, DC.toiletGreen));
  C(s1 + 26.2, 7.0, 0, 1.3, 1.3, (kk) => bano(kk));
  C(s1 + 30, 7.2, 0, 1.3, 1.1, (kk) => pales(kk, 3));
  C(s1 + 31.6, 7.2, 0, 1.3, 1.1, (kk) => pales(kk, 2));
  C(s1 + 30.8, 9.0, 0, 1.3, 1.1, (kk) => pales(kk, 1));
  C(s1 + 9, 13.2, 0, 5.4, 2.4, (kk) => carretilla(kk));
  C(-s1 - 4, 8.2, 0, 6.6, 2.3, (kk) => tubos(kk, 6));
  C(-s1 - 4, 11.2, 0, 6.6, 2.1, (kk) => tubos(kk, 6, DC.pipeY));
  C(-s1 - 12, 8.2, 0, 7, 2.1, (kk) => ferralla(kk, 6));
  C(-s1 - 20, 10, 0.4, 7, 3.4, (kk) => excavadora(kk));
  C(-s1 - 29, 10.5, 0, 8.6, 2.9, (kk) => volquete(kk));
  C(-s1 - 39, 10.5, 0, 8.6, 2.9, (kk) => hormigonera(kk));
  // banderas y manga de viento
  for (let i = 0; i < 3; i++) {
    const [x, z] = G.p(s1 + 6 + i * 2.2, 12.4);
    if (P.put(x, z, 0, 0.4, 0.4, (kk) => mastil(kk, 7), 0)) D.flags.push({ p: [x, 7, z], c: ['#2f6db0', '#e9e6dc', '#3f8a52'][i] });
  }
  {
    const [x, z] = G.p(-s1 - 2, 6.0);
    if (P.put(x, z, 0, 0.4, 0.4, (kk) => mastil(kk, 6.5), 0)) D.socks.push([x, 6.5, z]);
  }
  // conos a los lados de la entrada
  for (let v = 4.5; v <= 13.5; v += 3) for (const u of [-gateW / 2 - 0.8, gateW / 2 + 0.8]) {
    const [x, z] = G.p(u, v);
    k.at(x, z, 0, () => cono(k));
  }
  // focos en las esquinas de la valla
  for (const [x, z] of [[site.x0 - 7, site.z0 - 7], [site.x1 + 7, site.z0 - 7], [site.x0 - 7, site.z1 + 7], [site.x1 + 7, site.z1 + 7]]) {
    P.put(x, z, Math.atan2(z - center[1], -(x - center[0])), 2.6, 1.4, (kk) => foco(kk));
  }
  // trabajadores: por el pasillo junto a la valla y en las casetas
  for (let i = 0; i < 3; i++) {
    const u0 = rnd(-30, 30), u1 = u0 + rnd(-18, 18);
    D.walkers.push({ a: G.p(u0, 4.2), b: G.p(u1, 4.2) });
  }
  for (const [u, v] of [[s1 + 6, 11], [s1 + 13, 11], [-s1 - 9, 6.5], [gateW / 2 + 1.5, 15]]) { const p = G.p(u, v); D.walkers.push({ a: p, b: p }); }

  // ——— alrededores ———
  const fill = FILL[env];
  fill({ P, D, k, R, rnd, pick, site, center, G, nivel });

  delete D.direct;
  return D;
}

/** Valla perimetral a FENCE m del borde con su portón (tramos sobre el agua, no) */
function fenceRing(D: Decor, s: Rect, gSide: Side, gAt: number, gw: number, tarp: boolean) {
  const k = D.kit, f = FENCE;
  const corners: Record<Side, [number, number, number, number]> = {
    n: [s.x0 - f, s.z0 - f, s.x1 + f, s.z0 - f], s: [s.x0 - f, s.z1 + f, s.x1 + f, s.z1 + f],
    w: [s.x0 - f, s.z0 - f, s.x0 - f, s.z1 + f], e: [s.x1 + f, s.z0 - f, s.x1 + f, s.z1 + f],
  };
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    const [x0, z0, x1, z1] = corners[side];
    const alongX = z0 === z1;
    const a = alongX ? x0 : z0, b = alongX ? x1 : z1;
    // cortes: portón y agua
    const cuts: [number, number][] = [];
    if (side === gSide) cuts.push([gAt - gw / 2, gAt + gw / 2]);
    for (const w of D.water) if (alongX && z0 >= w.z0 - 1 && z0 <= w.z1 + 1) cuts.push([w.x0 - 1, w.x1 + 1]);
    cuts.sort((p, q) => p[0] - q[0]);
    let cur = a;
    const seg = (p: number, q: number) => {
      if (q - p < 0.5) return;
      if (alongX) k.fenceRun(p, z0, q, z0, 2, tarp); else k.fenceRun(x0, p, x0, q, 2, tarp);
    };
    for (const [c0, c1] of cuts) { seg(cur, Math.max(cur, c0)); cur = Math.max(cur, c1); }
    seg(cur, b);
    if (side === gSide) {
      // hojas del portón abiertas hacia fuera
      for (const sgn of [-1, 1]) {
        const g = gAt + (sgn * gw) / 2, L = gw / 2 - 0.2, ang = 1.1;
        const out = side === 'n' || side === 'w' ? -1 : 1;
        if (alongX) k.fenceRun(g, z0, g - sgn * L * Math.cos(ang), z0 + out * L * Math.sin(ang), 2, tarp);
        else k.fenceRun(x0, g, x0 + out * L * Math.sin(ang), g - sgn * L * Math.cos(ang), 2, tarp);
      }
    }
  }
}

/** Recorrido rectangular a `o` m de la obra (sentido de las agujas visto desde arriba) */
function perimeter(s: Rect, o: number): [number, number][] {
  return [[s.x0 - o, s.z0 - o], [s.x1 + o, s.z0 - o], [s.x1 + o, s.z1 + o], [s.x0 - o, s.z1 + o]];
}

/** Puntos cada `step` m a lo largo de un recorrido cerrado, con el giro del tramo (x local a lo largo) */
function along(pts: [number, number][], step: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, bz - az), r = Math.atan2(-(bz - az), bx - ax);
    for (let t = step / 2; t < len; t += step) out.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, r]);
  }
  return out;
}

const GROUND: Record<Env, GroundLook> = {
  port: { a: '#7b7a74', b: '#6c6b66' }, urban: { a: '#6d6e6e', b: '#5f6162' }, dense: { a: '#6a6b6c', b: '#5c5e60' },
  electric: { a: '#6b7a45', b: '#857457' }, bridge: { a: '#667845', b: '#7d7055' }, forest: { a: '#5f7240', b: '#6f6a4d' },
  field: { a: '#6f7a46', b: '#87745a' }, logistics: { a: '#8a857a', b: '#757968' }, refinery: { a: '#8a857a', b: '#7b7a6c' },
  industrial: { a: '#878379', b: '#6f7a4e' }, yard: { a: '#8f8a7a', b: '#7f7a6c' },
};

interface Ctx {
  P: Placer; D: Decor; k: Kit; R: () => number; rnd: (a: number, b: number) => number; pick: <T>(l: T[]) => T;
  site: Rect; center: [number, number]; G: ReturnType<typeof sideFrame>; nivel: number;
}

function trees(c: Ctx, n: number, d0: number, d1: number, pine: number, hMin = 6, hMax = 13) {
  c.P.scatter(n, d0, d1, n * 6, (x, z) => {
    const p = c.R() < pine, h = c.rnd(hMin, hMax);
    return c.P.put(x, z, 0, h * 0.5, h * 0.5, (kk) => arbol(kk, h, p, p ? DC.pine : c.R() < 0.5 ? DC.leaf : DC.leafDark), 0.3);
  });
}

function buildings(c: Ctx, n: number, d0: number, d1: number, hMin: number, hMax: number, pad = 7) {
  c.P.scatter(n, d0, d1, n * 10, (x, z) => {
    const w = c.rnd(14, 34), d = c.rnd(14, 30);
    const near = rectDist(c.site, x, z);
    const h = c.rnd(hMin, hMax) * (near < 60 ? 0.7 : 1);
    const ok = c.P.put(x, z, 0, w, d, (kk) => edificio(kk, w, d, h, c.pick(FACADE)), pad);
    if (ok) c.D.flats.push({ kind: 'side', x0: x - w / 2 - 2.5, x1: x + w / 2 + 2.5, z0: z - d / 2 - 2.5, z1: z + d / 2 + 2.5 });
    return ok;
  });
}

function tankFarm(c: Ctx, n: number, d0: number, d1: number) {
  c.P.scatter(n, d0, d1, n * 10, (x, z) => {
    const r = c.rnd(6, 13), h = c.rnd(9, 17);
    const ok = c.P.put(x, z, 0, 2 * r, 2 * r, (kk) => tanque(kk, r, h), 4);
    if (ok) c.D.flats.push({ kind: 'concrete', x0: x - r - 3, x1: x + r + 3, z0: z - r - 3, z1: z + r + 3 });
    return ok;
  });
}

const FILL: Record<Env, (c: Ctx) => void> = {
  port(c) {
    const { P, D, site } = c, qz = site.z0 - 40;
    const put = D.direct!;
    for (const x of [site.x0 + 10, site.x0 + 55, site.x1 + 30]) put(x, qz + 12, 0, (kk) => porticoMuelle(kk));
    for (let x = site.x0 - 110; x < site.x1 + 110; x += 15) put(x, qz + 0.6, 0, (kk) => bolardo(kk));
    put((site.x0 + site.x1) / 2, qz - 70, 0, (kk) => barco(kk, BOXES));
    // bloques de contenedores
    P.scatter(40, 28, 190, 600, (x, z) => {
      const rows = 2 + Math.floor(c.R() * 3), h = 1 + Math.floor(c.R() * 3);
      return P.put(x, z, 0, 12.4, rows * 2.6, (kk) => {
        for (let i = 0; i < rows; i++) kk.at(0, -((rows - 1) * 2.6) / 2 + i * 2.6, 0, () => contenedores(kk, Math.max(1, h - (i % 2)), true, [c.pick(BOXES), c.pick(BOXES), c.pick(BOXES)]));
      }, 2.5);
    });
    P.scatter(6, 30, 120, 200, (x, z) => P.put(x, z, 0, 2.6, 1.4, (kk) => foco(kk, 18), 2));
  },
  urban(c) {
    buildings(c, 60, 29, 300, 10, 32);
    trees(c, 25, 29, 120, 0, 6, 9);
  },
  dense(c) {
    buildings(c, 70, 29, 320, 22, 75);
    trees(c, 15, 29, 100, 0, 6, 8);
  },
  electric(c) {
    const { P, site } = c;
    P.put(site.x0 + 20, site.z0 - 60, 0, 22, 14, (kk) => subestacion(kk), 2);
    P.put(site.x0 + 44, site.z0 - 60, 0, 22, 14, (kk) => subestacion(kk), 2);
    trees(c, 120, 18, 260, 0.3);
    c.D.flats.push({ kind: 'gravel', x0: site.x0 + 6, x1: site.x0 + 58, z0: site.z0 - 70, z1: site.z0 - 50 });
  },
  bridge(c) {
    const { P, site } = c;
    // árboles en las orillas y en el campo
    for (const w of c.D.water) for (let i = 0; i < 70; i++) {
      const side = c.R() < 0.5 ? -1 : 1, x = (side < 0 ? w.x0 : w.x1) + side * c.rnd(4, 26), z = c.rnd(w.z0, w.z1);
      const h = c.rnd(7, 13);
      P.put(x, z, 0, h * 0.5, h * 0.5, (kk) => arbol(kk, h, false, c.R() < 0.5 ? DC.leaf : DC.leafDark), 0.3);
    }
    trees(c, 120, 18, 260, 0.25);
    const rx = c.D.water[0] ? (c.D.water[0].x0 + c.D.water[0].x1) / 2 : 44;
    c.D.direct!(rx, site.z0 - 170, Math.PI / 2, (kk) => puente(kk, 90));
  },
  forest(c) {
    trees(c, 420, 14, 300, 0.75, 8, 18);
  },
  field(c) {
    const { P } = c;
    // grupos de árboles, charcos y caminos de tierra
    for (let g = 0; g < 14; g++) {
      P.scatter(1, 30, 260, 40, (cx, cz) => {
        for (let i = 0; i < 12; i++) { const h = c.rnd(7, 14); P.put(cx + c.rnd(-14, 14), cz + c.rnd(-14, 14), 0, h * 0.5, h * 0.5, (kk) => arbol(kk, h, c.R() < 0.2, c.R() < 0.5 ? DC.leaf : DC.leafDark), 0.3); }
        return true;
      });
    }
    P.scatter(8, 12, 60, 120, (x, z) => {
      const w = c.rnd(3, 8), d = c.rnd(2, 6);
      if (!P.free({ x0: x - w, x1: x + w, z0: z - d, z1: z + d })) return false;
      c.D.water.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      c.D.flats.push({ kind: 'dirt', x0: x - w / 2 - 2, x1: x + w / 2 + 2, z0: z - d / 2 - 2, z1: z + d / 2 + 2 });
      return true;
    });
    // la planta a lo lejos
    for (let i = 0; i < 6; i++) { const x = c.site.x1 + c.rnd(120, 220), z = c.rnd(-120, 160), r = c.rnd(7, 12); P.put(x, z, 0, 2 * r, 2 * r, (kk) => tanque(kk, r, c.rnd(10, 16)), 3); }
    P.put(c.site.x1 + 150, c.site.z0 - 60, 0, 4, 4, (kk) => chimenea(kk, 50), 1);
  },
  logistics(c) {
    const { P, D } = c;
    P.scatter(10, 30, 240, 300, (x, z) => {
      const w = c.rnd(40, 70), d = c.rnd(24, 34), h = c.rnd(9, 12);
      const ok = P.put(x, z, 0, w, d + 22, (kk) => {
        kk.at(0, -11, -Math.PI / 2, () => nave(kk, d, w, h, c.pick([DC.greyLight, '#b9b2a2', '#9fa8ae']), DC.roof));
        // muelles con remolques aparcados en la fachada de +z
        for (let i = 0; i < Math.floor(w / 9); i++) {
          if (c.R() < 0.55) kk.at(-w / 2 + 4.5 + i * 9, d / 2 - 11 + 8, Math.PI / 2, () => camion(kk, c.pick(CARS), DC.offWhite));
        }
      }, 6);
      if (ok) D.flats.push({ kind: 'concrete', x0: x - w / 2 - 4, x1: x + w / 2 + 4, z0: z - d / 2 - 14, z1: z + d / 2 + 14 });
      return ok;
    });
    P.scatter(12, 28, 80, 200, (x, z) => P.put(x, z, c.rnd(0, 3), 2.6, 1.2, (kk) => pales(kk, 2), 1));
    P.scatter(4, 28, 80, 100, (x, z) => P.put(x, z, c.rnd(0, 6), 2.6, 1.3, (kk) => carretilla(kk), 1));
    trees(c, 30, 30, 260, 0.2);
  },
  refinery(c) {
    const { P, site } = c;
    // racks de tuberías a lo largo de la calle perimetral (por fuera)
    for (const [x, z, r] of along(perimeter(site, 30), 70)) P.put(x, z, r, 60, 5, (kk) => rack(kk, 60, 6), 1);
    tankFarm(c, 26, 36, 240);
    P.scatter(8, 40, 160, 200, (x, z) => { const r = c.rnd(1.4, 2.6); return P.put(x, z, 0, 6, 6, (kk) => columna(kk, r, c.rnd(24, 44)), 2); });
    P.scatter(3, 50, 200, 200, (x, z) => P.put(x, z, 0, 4, 4, (kk) => chimenea(kk, c.rnd(45, 65)), 3));
    trees(c, 25, 60, 280, 0.3);
  },
  industrial(c) {
    const { P, D } = c;
    P.scatter(14, 30, 260, 400, (x, z) => {
      const w = c.rnd(26, 60), d = c.rnd(20, 36), h = c.rnd(8, 16);
      const ok = P.put(x, z, c.R() < 0.5 ? 0 : Math.PI / 2, w, d, (kk) => nave(kk, w, d, h, c.pick([DC.greyLight, '#b9b2a2', '#8fa3ad', '#b07b55']), DC.roof), 7);
      if (ok) D.flats.push({ kind: 'concrete', x0: x - Math.max(w, d) / 2 - 4, x1: x + Math.max(w, d) / 2 + 4, z0: z - Math.max(w, d) / 2 - 4, z1: z + Math.max(w, d) / 2 + 4 });
      return ok;
    });
    // aparcamiento de camiones
    P.scatter(2, 30, 80, 100, (x, z) => P.put(x, z, 0, 30, 18, (kk) => {
      for (let i = 0; i < 6; i++) if (c.R() < 0.75) kk.at(-12.5 + i * 5, 0, Math.PI / 2, () => camion(kk, c.pick(CARS), c.pick([DC.offWhite, DC.greyLight])));
    }, 2));
    trees(c, 40, 30, 260, 0.2);
  },
  yard(c) {
    const { P, D } = c;
    P.scatter(8, 8, 90, 200, (x, z) => {
      const w = c.rnd(30, 50), d = c.rnd(18, 26), h = c.rnd(9, 13);
      const ok = P.put(x, z, c.R() < 0.5 ? 0 : Math.PI / 2, w, d, (kk) => nave(kk, w, d, h, c.pick([DC.greyLight, '#b9b2a2']), DC.roof), 6);
      if (ok) D.flats.push({ kind: 'concrete', x0: x - 32, x1: x + 32, z0: z - 32, z1: z + 32 });
      return ok;
    });
    P.scatter(10, 8, 60, 200, (x, z) => P.put(x, z, 0, 3.8, 2.8, (kk) => placasLastre(kk, 3 + Math.floor(c.R() * 5)), 1.5));
    P.scatter(10, 8, 80, 200, (x, z) => P.put(x, z, c.R() < 0.5 ? 0 : Math.PI / 2, 12.4, 2.6, (kk) => contenedores(kk, 1 + Math.floor(c.R() * 3), true, [c.pick(BOXES), c.pick(BOXES), c.pick(BOXES)]), 1.5));
    P.scatter(6, 8, 60, 100, (x, z) => P.put(x, z, c.R() < 0.5 ? 0 : Math.PI / 2, 13.2, 2.6, (kk) => camion(kk, c.pick(CARS)), 1.5));
    trees(c, 60, 60, 260, 0.4);
  },
};
