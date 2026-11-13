import type { V3 } from '../crane/pose';

/**
 * Cable flojo simulado (fase 15, parte C): solo dibujo. En la física el cable es una distancia máxima sin forma; aquí
 * cada ramal es una cadena de puntos (Verlet) con los extremos fijos en la cabeza y el gancho, gravedad, tramos que no
 * se estiran y un suelo. Así el cable sobrante cae por su peso, se amontona donde está apoyado el gancho y se mueve
 * con él. No toca la simulación del juego (no afecta al determinismo).
 */

const G = 9.81;
/** Paso interno (s) y como mucho cuántos por cuadro */
const SUB = 1 / 120;
const MAX_SUB = 6;
/** Pasadas de las restricciones de largo por paso */
const ITER = 24;
/** Fracción de la velocidad que se conserva por paso (aire) y en el suelo (rozamiento) */
const AIR = 0.985;
const GROUND = 0.6;

export class RopeSim {
  readonly p: V3[];
  private q: V3[];
  /** El cable estaba tenso en el último cuadro (los puntos están en la recta) */
  private straight = true;
  private acc = 0;

  constructor(readonly n: number) {
    this.p = Array.from({ length: n + 1 }, () => ({ x: 0, y: 0, z: 0 }));
    this.q = Array.from({ length: n + 1 }, () => ({ x: 0, y: 0, z: 0 }));
  }

  /** Pone los puntos en la recta de `a` a `b`, quietos */
  private line(a: V3, b: V3) {
    const { p, q, n } = this;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      p[i].x = q[i].x = a.x + (b.x - a.x) * k;
      p[i].y = q[i].y = a.y + (b.y - a.y) * k;
      p[i].z = q[i].z = a.z + (b.z - a.z) * k;
    }
  }

  /**
   * Avanza `dt` s con los extremos en `a` y `b`, el cable de largo `len` y el suelo a `floor`. Si el cable no sobra
   * (len ≤ distancia + `slackMin`), la recta. Devuelve los puntos.
   */
  update(a: V3, b: V3, len: number, floor: number, dt: number, slackMin = 0.03): V3[] {
    const { p, q, n } = this;
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len <= d + slackMin) {
      this.line(a, b);
      this.straight = true;
      this.acc = 0;
      return p;
    }
    if (this.straight) { this.line(a, b); this.straight = false; }
    const rest = len / n;
    this.acc = Math.min(this.acc + Math.max(0, dt), MAX_SUB * SUB);
    while (this.acc >= SUB) {
      this.acc -= SUB;
      // Verlet con gravedad; en el suelo casi no se desliza
      for (let i = 1; i < n; i++) {
        const v = p[i], o = q[i];
        const k = v.y <= floor + 1e-3 ? GROUND : AIR;
        const vx = (v.x - o.x) * k, vy = (v.y - o.y) * AIR, vz = (v.z - o.z) * k;
        o.x = v.x; o.y = v.y; o.z = v.z;
        v.x += vx; v.y += vy - G * SUB * SUB; v.z += vz;
      }
      p[0].x = a.x; p[0].y = a.y; p[0].z = a.z;
      p[n].x = b.x; p[n].y = b.y; p[n].z = b.z;
      for (let it = 0; it < ITER; it++) {
        // un cable no se estira (se puede doblar): solo se acortan los tramos largos
        for (let i = 0; i < n; i++) {
          const u = p[i], w = p[i + 1];
          const dx = w.x - u.x, dy = w.y - u.y, dz = w.z - u.z, l = Math.hypot(dx, dy, dz);
          if (l <= rest || l < 1e-9) continue;
          const c = (l - rest) / l;
          // los extremos no se mueven: la corrección va entera al otro punto
          const wu = i === 0 ? 0 : i + 1 === n ? 1 : 0.5, ww = 1 - wu;
          u.x += dx * c * wu; u.y += dy * c * wu; u.z += dz * c * wu;
          w.x -= dx * c * ww; w.y -= dy * c * ww; w.z -= dz * c * ww;
        }
        for (let i = 1; i < n; i++) if (p[i].y < floor) p[i].y = floor;
      }
    }
    return p;
  }
}
