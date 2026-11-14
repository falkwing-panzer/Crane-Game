// Fase 18: terreno con relieve, sin three.js ni Rapier (lo usan la física, el dibujo, la conducción y las pruebas).
//
// Dos partes con el mismo dato para todos:
// - Parches (`Patch`): cuadrículas de alturas que son a la vez el heightfield de Rapier y la malla del dibujo. La
//   altura dentro de una celda se interpola en los mismos dos triángulos que usa Rapier (medido: la diagonal une la
//   esquina (x0, z1) con la (x1, z0)), así que `height()` da exactamente el suelo de la física.
// - Colinas (`Hills`): el anillo de colinas del horizonte (antes una malla de adorno, fase 17) como alturas reales,
//   solo más allá de todo el decorado. Nada de la partida llega ahí, así que no tienen colisionador.
// Fuera de los parches y de las colinas el suelo es el plano y = 0 de siempre (los 14 niveles son planos).

export interface Rect { x0: number; x1: number; z0: number; z1: number }

/**
 * Cuadrícula de alturas: `nx` × `nz` celdas de `cell` m desde (x0, z0). Vértice (i a lo largo de x, j a lo largo
 * de z) en h[j + i·(nz + 1)]: el orden de Rapier (columnas = x, filas = z, por columnas).
 */
export interface Patch { x0: number; z0: number; cell: number; nx: number; nz: number; h: Float32Array }

/** Parche con las alturas de `fn` en los vértices de una cuadrícula de `cell` m que cubre `r` */
export function makePatch(r: Rect, cell: number, fn: (x: number, z: number) => number): Patch {
  const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / cell)), nz = Math.max(1, Math.ceil((r.z1 - r.z0) / cell));
  const h = new Float32Array((nx + 1) * (nz + 1));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) h[j + i * (nz + 1)] = fn(r.x0 + i * cell, r.z0 + j * cell);
  return { x0: r.x0, z0: r.z0, cell, nx, nz, h };
}

export const patchRect = (p: Patch): Rect => ({ x0: p.x0, x1: p.x0 + p.nx * p.cell, z0: p.z0, z1: p.z0 + p.nz * p.cell });

/** Altura del parche en (x, z) (los triángulos de Rapier), o null fuera */
export function patchHeight(p: Patch, x: number, z: number): number | null {
  const u = (x - p.x0) / p.cell, v = (z - p.z0) / p.cell;
  if (u < 0 || v < 0 || u > p.nx || v > p.nz) return null;
  const i = Math.min(p.nx - 1, Math.floor(u)), j = Math.min(p.nz - 1, Math.floor(v));
  const fu = u - i, fv = v - j, n = p.nz + 1;
  const h00 = p.h[j + i * n], h10 = p.h[j + (i + 1) * n], h01 = p.h[j + 1 + i * n], h11 = p.h[j + 1 + (i + 1) * n];
  return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
}

/**
 * Meseta de prueba: arriba plana en `top` a `h` m, con un talud a cada lado de `run` m en planta
 * ([−x, +x, −z, +z]). La altura es el mínimo de los cuatro taludes (tronco de pirámide).
 */
export interface Mesa { top: Rect; h: number; run: [number, number, number, number] }

export function mesaHeight(m: Mesa, x: number, z: number) {
  const { top: t, run: [xm, xp, zm, zp] } = m;
  const f = Math.min(
    (x - (t.x0 - xm)) / xm, ((t.x1 + xp) - x) / xp,
    (z - (t.z0 - zm)) / zm, ((t.z1 + zp) - z) / zp, 1,
  );
  return f > 0 ? m.h * f : 0;
}

export const mesaRect = (m: Mesa): Rect =>
  ({ x0: m.top.x0 - m.run[0], x1: m.top.x1 + m.run[1], z0: m.top.z0 - m.run[2], z1: m.top.z1 + m.run[3] });

/** Talud de cada lado de la meseta (grados) */
export const mesaSlopes = (m: Mesa) => m.run.map((r) => (Math.atan(m.h / r) * 180) / Math.PI);

/**
 * Colinas: empiezan a `r0` m del centro, suben hasta `r1` y siguen con altura entre hMin y hMax según el ángulo
 * (como el anillo de la fase 17) más un ruido suave. `cut`: zonas (agua del puerto y del río) donde se hunden a 0
 * en `cutFade` m, para que el agua siga hasta el horizonte.
 */
export interface Hills {
  center: [number, number]; r0: number; r1: number; hMin: number; hMax: number;
  phase: [number, number, number]; cut: Rect[]; cutFade: number;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function rectDist(r: Rect, x: number, z: number) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

export function hillHeight(H: Hills, x: number, z: number) {
  const dx = x - H.center[0], dz = z - H.center[1], r = Math.hypot(dx, dz);
  if (r <= H.r0) return 0;
  const a = Math.atan2(dz, dx), [p0, p1, p2] = H.phase;
  const v = 0.5 + 0.25 * Math.sin(a * 3 + p0) + 0.17 * Math.sin(a * 7 + p1) + 0.08 * Math.sin(a * 17 + p2);
  // ondulación radial: lomas sucesivas en vez de un muro
  const w = 0.75 + 0.25 * Math.sin(r / 37 + p1 + a * 2) * Math.cos(r / 23 + p2);
  let k = smooth(H.r0, H.r1, r);
  for (const c of H.cut) k *= smooth(0, H.cutFade, rectDist(c, x, z));
  return k * (H.hMin + (H.hMax - H.hMin) * v) * w;
}

export class Terrain {
  constructor(readonly patches: Patch[] = [], readonly hills: Hills | null = null) {}

  /** Altura del suelo en (x, z) */
  height(x: number, z: number) {
    for (const p of this.patches) {
      const h = patchHeight(p, x, z);
      if (h !== null) return h;
    }
    return this.hills ? hillHeight(this.hills, x, z) : 0;
  }

  /** Todo plano en y = 0 dentro de `r`? (sin parches que lo toquen; las colinas empiezan más lejos) */
  flatIn(r: Rect) {
    return !this.patches.some((p) => { const q = patchRect(p); return q.x0 < r.x1 && r.x0 < q.x1 && q.z0 < r.z1 && r.z0 < q.z1; });
  }
}
