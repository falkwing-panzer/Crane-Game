// Oclusión ambiental horneada (fase 16): oscurece los rincones de cada grupo rígido de la grúa (el chasis junto a la
// cabina, la base de la superestructura, los huecos entre cajones) en los colores por vértice, una vez al construir
// el modelo. Sin coste por cuadro. No usa three.js para poder probarla.
//
// Método (aproximación barata, no trazado de rayos): para cada vértice se toma un punto un poco por delante de su
// cara (p + n·OFF) y se mira lo cerca que quedan las otras piezas del grupo (sus cajas envolventes). Cuanto más cerca
// y más de frente, más oscuro; una pieza detrás de la cara no cuenta. Las piezas delgadas (barandillas, cristales)
// pesan poco. Una cuadrícula de celdas evita mirar todas las piezas para cada vértice.

/** Distancia a la que una pieza deja de oscurecer (m) */
export const AO_R = 1.8;
/** Cuánto se separa de la cara el punto de prueba (m) */
const OFF = 0.35;
/** Oscurecimiento máximo (0 = nada, 1 = negro) */
export const AO_MAX = 0.6;
/** Tamaño a partir del cual una pieza oscurece con todo su peso (m) */
const FULL = 0.6;

export interface AoPiece {
  /** posiciones (x, y, z por vértice) y normales */
  pos: ArrayLike<number>;
  nor: ArrayLike<number>;
  /** caja envolvente de la pieza; null = no oscurece a las demás (cilindros inclinados: su caja no se le parece) */
  box: { min: [number, number, number]; max: [number, number, number] } | null;
}

/** Factor (0…1, multiplica el color) de cada vértice de cada pieza */
export function bakeAO(pieces: AoPiece[]): Float32Array[] {
  const occ = pieces.map((p, i) => ({ i, b: p.box })).filter((o) => o.b) as { i: number; b: NonNullable<AoPiece['box']> }[];
  // peso de cada pieza según su tamaño (la mediana de sus tres medidas)
  const weight = occ.map(({ b }) => {
    const d = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].sort((x, y) => x - y);
    return Math.min(1, d[1] / FULL);
  });
  // cuadrícula: cada pieza en las celdas que toca su caja agrandada AO_R
  const cell = AO_R, grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  occ.forEach(({ b }, k) => {
    const lo = b.min.map((v) => Math.floor((v - cell) / cell)), hi = b.max.map((v) => Math.floor((v + cell) / cell));
    // una pieza enorme (más de 40 celdas por eje) se recorta: nunca pasa en una grúa, pero no se cuelga
    for (let x = lo[0]; x <= Math.min(hi[0], lo[0] + 400); x++)
      for (let y = lo[1]; y <= Math.min(hi[1], lo[1] + 400); y++)
        for (let z = lo[2]; z <= Math.min(hi[2], lo[2] + 400); z++) {
          const s = key(x, y, z);
          let l = grid.get(s);
          if (!l) grid.set(s, (l = []));
          l.push(k);
        }
  });
  const stamp = new Int32Array(occ.length).fill(-1);
  let tick = 0;
  return pieces.map((p, pi) => {
    const n = p.pos.length / 3, out = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const nx = p.nor[3 * v], ny = p.nor[3 * v + 1], nz = p.nor[3 * v + 2];
      const px = p.pos[3 * v] + nx * OFF, py = p.pos[3 * v + 1] + ny * OFF, pz = p.pos[3 * v + 2] + nz * OFF;
      const list = grid.get(key(Math.floor(px / cell), Math.floor(py / cell), Math.floor(pz / cell)));
      let o = 0;
      tick++;
      if (list) for (const k of list) {
        if (stamp[k] === tick) continue;
        stamp[k] = tick;
        const { i, b } = occ[k];
        if (i === pi) continue;
        // punto de la caja más cercano al punto de prueba
        const qx = Math.max(b.min[0], Math.min(px, b.max[0])), qy = Math.max(b.min[1], Math.min(py, b.max[1])), qz = Math.max(b.min[2], Math.min(pz, b.max[2]));
        const dx = qx - px, dy = qy - py, dz = qz - pz, d = Math.hypot(dx, dy, dz);
        if (d >= AO_R) continue;
        // de frente cuenta entera, de costado la mitad, detrás nada (dentro de la caja: de costado)
        const facing = d < 1e-4 ? 0.5 : 0.5 + (0.5 * (dx * nx + dy * ny + dz * nz)) / d;
        if (facing <= 0) continue;
        const f = 1 - d / AO_R;
        o += 1.6 * weight[k] * f * f * facing;
      }
      out[v] = 1 - AO_MAX * Math.min(1, o);
    }
    return out;
  });
}
