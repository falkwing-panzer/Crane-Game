// Celosía de sección cuadrada (latt / lattice de craneModel() en la referencia), sin three.js.
// Marco local: x a lo largo de la celosía, y normal ("arriba" de la pluma), z lateral.
// Cuatro cordones en las esquinas y diagonales en zigzag en las cuatro caras, alternando el sentido en cada tramo.

export type P3 = [number, number, number];
export interface Seg { a: P3; b: P3; r: number }

export interface LatticeOpts {
  /** Comienzo y fin de los cordones (m) */
  d0: number;
  d1: number;
  /** Media anchura (y media altura) de la sección en d */
  hw: (d: number) => number;
  /** Largo de cada tramo de diagonales */
  bay: number;
  /** Las diagonales empiezan mientras d < stop */
  stop: number;
  /** Radios de cordones y diagonales */
  rChord: number;
  rDiag: number;
}

/** Esquinas de la sección: (normal, lateral) en unidades de media anchura (orden de la referencia) */
const CN: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

export function latticeSegs(o: LatticeOpts): { chords: Seg[]; diags: Seg[] } {
  const P = (d: number, a: number, b: number): P3 => [d, a * o.hw(d), b * o.hw(d)];
  const chords = CN.map(([a, b]): Seg => ({ a: P(o.d0, a, b), b: P(o.d1, a, b), r: o.rChord }));
  const diags: Seg[] = [];
  for (let d = o.d0, i = 0; d < o.stop; d += o.bay, i++) {
    const d2 = Math.min(o.d1, d + o.bay), z = i % 2;
    for (let f = 0; f < 4; f++) {
      const [a1, b1] = CN[f], [a2, b2] = CN[(f + 1) % 4];
      diags.push({ a: P(d, z ? a1 : a2, z ? b1 : b2), b: P(d2, z ? a2 : a1, z ? b2 : b1), r: o.rDiag });
    }
  }
  return { chords, diags };
}

/**
 * Pluma de celosía de la referencia (T.boom.lattice): pie macizo hasta 2,4 m, cordones de 2,4 m a Lb − 0,8 m con
 * la sección que se estrecha un 55 % hacia la cabeza, tramos de max(1,8; 1,1·ancho) y cabeza maciza.
 */
export function boomLattice(bw: number, Lb: number) {
  const half = (d: number) => (bw / 2) * (1 - 0.55 * (d / Lb));
  return {
    half,
    ...latticeSegs({
      d0: 2.4, d1: Lb - 0.8, hw: half, bay: Math.max(1.8, bw * 1.1), stop: Lb - 1.2,
      // grosores de la referencia (ancho de línea 0,16·max(1, bw/2) y 0,08·max(1, bw/2,5)) como diámetros
      rChord: 0.08 * Math.max(1, bw / 2), rDiag: 0.04 * Math.max(1, bw / 2.5),
    }),
  };
}
