// Oclusión ambiental horneada (fase 16): oscurece los rincones de cada grupo rígido de la grúa (el chasis junto a la
// cabina, la base de la superestructura, los huecos entre cajones) en los colores por vértice, una vez al construir
// el modelo. Sin coste por cuadro. No usa three.js para poder probarla.
//
// Método (aproximación barata, no trazado de rayos): para cada vértice se toma un punto un poco por delante de su
// cara (p + n·OFF) y se mira lo cerca que quedan las otras piezas del grupo (sus cajas envolventes). Cuanto más cerca
// y más de frente, más oscuro; una pieza detrás de la cara no cuenta. Las piezas delgadas (barandillas, cristales)
// pesan poco. Para cada pieza se buscan antes las piezas que pueden oscurecerla (cajas cercanas), y los vértices
// repetidos (misma posición y normal) se calculan una vez.

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
  const reach = AO_R + OFF;
  return pieces.map((p, pi) => {
    const n = p.pos.length / 3, out = new Float32Array(n);
    // caja de la pieza: solo pueden oscurecerla las piezas a menos de AO_R + OFF de ella
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) {
      const x = p.pos[3 * v + a];
      if (x < lo[a]) lo[a] = x;
      if (x > hi[a]) hi[a] = x;
    }
    const near: number[] = [];
    occ.forEach(({ i, b }, k) => {
      if (i === pi) return;
      for (let a = 0; a < 3; a++) if (b.min[a] > hi[a] + reach || b.max[a] < lo[a] - reach) return;
      near.push(k);
    });
    if (!near.length) { out.fill(1); return out; }
    // los vértices repetidos (misma posición y normal, en triángulos vecinos) se calculan una vez
    let px0 = NaN, py0 = NaN, pz0 = NaN, nx0 = NaN, ny0 = NaN, nz0 = NaN, f0 = 1;
    const seen = new Map<number, number>();
    for (let v = 0; v < n; v++) {
      const nx = p.nor[3 * v], ny = p.nor[3 * v + 1], nz = p.nor[3 * v + 2];
      const x = p.pos[3 * v], y = p.pos[3 * v + 1], z = p.pos[3 * v + 2];
      if (x === px0 && y === py0 && z === pz0 && nx === nx0 && ny === ny0 && nz === nz0) { out[v] = f0; continue; }
      // clave aproximada (mm y normal redondeada): mismas cuentas, mismo resultado
      const h = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791 ^
        Math.round(nx * 8 + 8) * 1000003 ^ Math.round(ny * 8 + 8) * 10007 ^ Math.round(nz * 8 + 8) * 101;
      const c = seen.get(h);
      let f: number;
      if (c !== undefined) f = c;
      else {
        const px = x + nx * OFF, py = y + ny * OFF, pz = z + nz * OFF;
        let o = 0;
        for (const k of near) {
          const b = occ[k].b;
          // punto de la caja más cercano al punto de prueba
          const qx = Math.max(b.min[0], Math.min(px, b.max[0])), qy = Math.max(b.min[1], Math.min(py, b.max[1])), qz = Math.max(b.min[2], Math.min(pz, b.max[2]));
          const dx = qx - px, dy = qy - py, dz = qz - pz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= AO_R * AO_R) continue;
          const d = Math.sqrt(d2);
          // de frente cuenta entera, de costado la mitad, detrás nada (dentro de la caja: de costado)
          const facing = d < 1e-4 ? 0.5 : 0.5 + (0.5 * (dx * nx + dy * ny + dz * nz)) / d;
          if (facing <= 0) continue;
          const g = 1 - d / AO_R;
          o += 1.6 * weight[k] * g * g * facing;
        }
        f = 1 - AO_MAX * Math.min(1, o);
        seen.set(h, f);
      }
      out[v] = f;
      px0 = x; py0 = y; pz0 = z; nx0 = nx; ny0 = ny; nz0 = nz; f0 = f;
    }
    return out;
  });
}
