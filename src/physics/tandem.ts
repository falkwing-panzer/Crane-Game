import type { V3 } from '../crane/pose';

// Izaje en tándem (fase 10): reparto de la carga entre las eslingas.
// La API JS de Rapier no da la fuerza de las juntas, así que se resuelve la dinámica de la carga como un sólido:
//   m·(a − g) = Σ Tᵢ·uᵢ + Fc + f
//   I·α + ω × I·ω = Σ (pᵢ − c) × Tᵢ·uᵢ + Σ (p_c − c) × Fc + (p_f − c) × f
// con a, α medidas por Rapier, uᵢ la dirección de cada eslinga (de la orejeta al gancho), Fc las fuerzas normales de
// los contactos (impulsos de Rapier) y f el rozamiento, desconocido, en el centro de los contactos (horizontal).
// Las incógnitas son las tensiones Tᵢ (y f si hay contactos): mínimos cuadrados, Tᵢ ≥ 0.
// La componente vertical del momento se usa solo si la carga gira libre alrededor de la vertical (las de orejetas);
// si no (fase 9), ese bloqueo pone el momento que haga falta.

export interface SlingObs {
  /** Orejeta en el mundo */
  p: V3;
  /** Dirección de la eslinga, de la orejeta hacia el gancho (unitaria) */
  u: V3;
  /** Eslinga floja (más corta que su largo): no tira */
  slack: boolean;
}

export interface LoadDyn {
  /** Masa (t) */
  m: number;
  /** Centro de masa en el mundo */
  c: V3;
  /** Aceleración lineal medida (m/s²) */
  a: V3;
  /** Momento que hace falta para el giro medido: I·α + ω × I·ω (t·m²/s²) */
  tau: V3;
  /** Fuerzas de contacto conocidas (normales) y su punto, en el mundo (t·m/s²) */
  contacts: { p: V3; f: V3 }[];
  /** Medio largo mayor de la carga (escala las filas de momentos para que pesen como las de fuerzas) */
  size: number;
  /** Gira libre alrededor de la vertical: cuenta también el momento vertical */
  yawFree?: boolean;
}

const G = 9.81;
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * Tensiones de las eslingas (t·m/s², en el orden de `slings`; 0 las flojas). Rozamiento solo si hay contactos.
 */
export function slingTensions(d: LoadDyn, slings: SlingObs[]): number[] {
  const out = slings.map(() => 0);
  let active = slings.map((s, i) => (s.slack ? -1 : i)).filter((i) => i >= 0);
  // lado derecho: lo que deben poner las eslingas y el rozamiento
  const F = { x: d.m * d.a.x, y: d.m * (d.a.y + G), z: d.m * d.a.z };
  const M = { ...d.tau };
  let pc: V3 | null = null;
  if (d.contacts.length) {
    pc = { x: 0, y: 0, z: 0 };
    for (const k of d.contacts) {
      F.x -= k.f.x; F.y -= k.f.y; F.z -= k.f.z;
      const t = cross(sub(k.p, d.c), k.f);
      M.x -= t.x; M.y -= t.y; M.z -= t.z;
      pc.x += k.p.x / d.contacts.length; pc.y += k.p.y / d.contacts.length; pc.z += k.p.z / d.contacts.length;
    }
  }
  const s = 1 / Math.max(1, d.size);
  const row = (f: V3, t: V3) => (d.yawFree ? [f.x, f.y, f.z, t.x * s, t.y * s, t.z * s] : [f.x, f.y, f.z, t.x * s, t.z * s]);
  const rhs = row(F, M);
  // columnas: una por eslinga activa y, con contactos, rozamiento en x y en z
  for (let it = 0; it < slings.length + 1; it++) {
    const cols: number[][] = active.map((i) => {
      const u = slings[i].u;
      return row(u, cross(sub(slings[i].p, d.c), u));
    });
    if (pc) {
      const r = sub(pc, d.c);
      for (const f of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]) {
        cols.push(row(f, cross(r, f)));
      }
    }
    if (!cols.length) return out;
    const x = leastSquares(cols, rhs);
    // una tensión negativa es una eslinga que empuja: se quita y se vuelve a resolver
    const neg = active.findIndex((_, k) => x[k] < 0);
    if (neg < 0) {
      active.forEach((i, k) => { out[i] = x[k]; });
      return out;
    }
    active = active.filter((_, k) => k !== neg);
  }
  return out;
}

/** Mínimos cuadrados por ecuaciones normales con una regularización mínima (columnas casi paralelas). */
function leastSquares(cols: number[][], b: number[]): number[] {
  const n = cols.length;
  const A = cols.map((ci) => cols.map((cj) => ci.reduce((s, v, r) => s + v * cj[r], 0)));
  const y = cols.map((ci) => ci.reduce((s, v, r) => s + v * b[r], 0));
  const tr = A.reduce((s, row, i) => s + row[i], 0) / n;
  for (let i = 0; i < n; i++) A[i][i] += 1e-10 * tr + 1e-12;
  // eliminación de Gauss con pivote parcial
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [y[i], y[p]] = [y[p], y[i]];
    for (let r = i + 1; r < n; r++) {
      const k = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= k * A[i][c];
      y[r] -= k * y[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i];
    for (let c = i + 1; c < n; c++) v -= A[i][c] * x[c];
    x[i] = v / A[i][i];
  }
  return x;
}
