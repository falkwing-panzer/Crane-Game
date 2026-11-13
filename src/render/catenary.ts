import type { V3 } from '../crane/pose';

/**
 * Catenaria (fase 15, parte C): forma de un cable flojo colgado entre dos puntos. Solo dibujo: en la física el cable
 * es una distancia máxima (rope de Rapier) y no tiene forma.
 *
 * En el plano vertical que pasa por los dos extremos, con t la distancia horizontal desde `a` (0…H) y V = alto de `b`
 * sobre `a`: y(t) = k·cosh((t − t0)/k) + c, con largo L. De las identidades del seno y el coseno hiperbólicos:
 * √(L² − V²) = 2k·sinh(H / 2k) (se resuelve x = H / 2k con sinh(x)/x = √(L² − V²)/H) y tanh(m) = V/L con
 * m = (p + q)/2, p = (H − t0)/k, q = −t0/k.
 */

/** Holgura por debajo de la cual el cable se dibuja recto (m) */
export const SLACK_MIN = 0.03;
/** Distancia horizontal mínima (un cable casi vertical y flojo cuelga en U debajo del extremo bajo) */
const H_MIN = 0.02;

/** sinh(x)/x = r (r ≥ 1) por bisección */
function solveX(r: number) {
  if (r <= 1 + 1e-12) return 1e-6;
  let lo = 1e-6, hi = 1;
  while (Math.sinh(hi) / hi < r && hi < 700) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sinh(mid) / mid < r) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * `n + 1` puntos del cable de largo `len` entre `a` y `b` (en `out`, que se reutiliza). Si el cable no llega a estar
 * flojo (len ≤ distancia + SLACK_MIN), la recta. `floor`: ningún punto baja de esa altura (el cable sobrante se queda
 * apoyado en el suelo o encima de la carga).
 */
export function catenary(a: V3, b: V3, len: number, n: number, floor = -Infinity, out: V3[] = []): V3[] {
  while (out.length < n + 1) out.push({ x: 0, y: 0, z: 0 });
  out.length = n + 1;
  const dx = b.x - a.x, dz = b.z - a.z, V = b.y - a.y;
  const H0 = Math.hypot(dx, dz), d = Math.hypot(H0, V);
  const set = (o: V3, x: number, y: number, z: number) => { o.x = x; o.y = Math.max(floor, y); o.z = z; };
  if (len <= d + SLACK_MIN) {
    for (let i = 0; i <= n; i++) { const k = i / n; set(out[i], a.x + dx * k, a.y + V * k, a.z + dz * k); }
    return out;
  }
  // dirección horizontal (si los extremos están uno encima del otro, cualquiera)
  const ux = H0 > 1e-9 ? dx / H0 : 1, uz = H0 > 1e-9 ? dz / H0 : 0;
  const H = Math.max(H0, H_MIN);
  const L = Math.max(len, Math.hypot(H, V) + 1e-9);
  const x = solveX(Math.sqrt(L * L - V * V) / H);
  const k = H / (2 * x);
  const m = Math.atanh(Math.max(-1 + 1e-12, Math.min(1 - 1e-12, V / L)));
  const q = m - x, t0 = -k * q, c = -k * Math.cosh(q);
  for (let i = 0; i <= n; i++) {
    const t = (H * i) / n;
    // en los extremos, exactos (con H_MIN el horizontal es un poco más largo que el real)
    const y = i === 0 ? 0 : i === n ? V : k * Math.cosh((t - t0) / k) + c;
    const th = (H0 * i) / n;
    set(out[i], a.x + ux * th, a.y + y, a.z + uz * th);
  }
  return out;
}

/**
 * Cable flojo con los extremos casi uno encima del otro (gancho apoyado debajo de la cabeza): la catenaria colgaría
 * por debajo del extremo bajo. En su lugar el ramal se arquea hacia `side` (horizontal, unitario) en media onda de
 * seno: largo ≈ d + π²·f²/(4d), así que la flecha es f = (2/π)·√(d·holgura), como mucho `maxF`; lo que sobre se queda
 * sobre el gancho.
 */
export function bow(a: V3, b: V3, len: number, n: number, side: V3, maxF: number, out: V3[] = []): V3[] {
  while (out.length < n + 1) out.push({ x: 0, y: 0, z: 0 });
  out.length = n + 1;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
  const f = Math.min(maxF, (2 / Math.PI) * Math.sqrt(d * Math.max(0, len - d)));
  for (let i = 0; i <= n; i++) {
    const k = i / n, s = f * Math.sin(Math.PI * k);
    out[i].x = a.x + dx * k + side.x * s; out[i].y = a.y + dy * k + side.y * s; out[i].z = a.z + dz * k + side.z * s;
  }
  return out;
}

/** ¿Algún punto quedaría por debajo de `floor`? (la catenaria se recortaría contra el suelo o el gancho) */
export function dips(p: V3[], floor: number) {
  return p.some((v) => v.y < floor - 1e-3);
}

/** Largo de una polilínea (pruebas) */
export function polyLength(p: V3[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
  return s;
}
