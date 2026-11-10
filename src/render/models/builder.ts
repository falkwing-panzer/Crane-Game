import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MatKey, Palette } from './materials';

// Primitivas de craneModel() de la referencia (caja, cilindro entre dos puntos, extrusión de un perfil)
// acumuladas por material. build() fusiona todo lo de un mismo material en una sola malla: cada grupo rígido
// de la grúa (chasis, superestructura, cada tramo de pluma…) cuesta una draw call por material.

export type P3 = [number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Geometría sin índices y solo con posición y normal (lo que hace falta para fusionar). */
function clean(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (n !== g) g.dispose();
  return n;
}

export class Parts {
  private geos = new Map<MatKey, THREE.BufferGeometry[]>();

  add(k: MatKey, g: THREE.BufferGeometry) {
    let l = this.geos.get(k);
    if (!l) this.geos.set(k, (l = []));
    l.push(clean(g));
  }

  /** Caja alineada con los ejes, de (x0, y0, z0) a (x1, y1, z1). */
  box(k: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    if (sx < 1e-4 || sy < 1e-4 || sz < 1e-4) return;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(k, g);
  }

  /** Cilindro de radio r entre los puntos a y b. */
  cyl(k: MatKey, a: P3, b: P3, r: number, seg = 12) {
    _a.set(...a);
    _b.set(...b).sub(_a);
    const len = _b.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(_up, _b.normalize());
    g.applyQuaternion(_q);
    g.translate(a[0] + (b[0] - a[0]) / 2, a[1] + (b[1] - a[1]) / 2, a[2] + (b[2] - a[2]) / 2);
    this.add(k, g);
  }

  /** Extrusión de un perfil (x, y) entre z0 y z1 (ext() de la referencia: perfil a lo largo del eje lateral). */
  ext(k: MatKey, prof: [number, number][], z0: number, z1: number) {
    // orientación antihoraria para que las normales de los lados salgan hacia fuera
    let area = 0;
    for (let i = 0; i < prof.length; i++) {
      const [x1, y1] = prof[i], [x2, y2] = prof[(i + 1) % prof.length];
      area += x1 * y2 - x2 * y1;
    }
    const p = area < 0 ? [...prof].reverse() : prof;
    const pos: number[] = [], nor: number[] = [];
    const tri = (a: P3, b: P3, c: P3, n: P3) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) nor.push(...n); };
    const tris = THREE.ShapeUtils.triangulateShape(p.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [i, j, l] of tris) {
      const A = p[i], B = p[j], C = p[l];
      tri([A[0], A[1], z1], [B[0], B[1], z1], [C[0], C[1], z1], [0, 0, 1]);
      tri([A[0], A[1], z0], [C[0], C[1], z0], [B[0], B[1], z0], [0, 0, -1]);
    }
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
      if (L < 1e-5) continue;
      const n: P3 = [dy / L, -dx / L, 0];
      tri([x1, y1, z0], [x2, y2, z0], [x2, y2, z1], n);
      tri([x1, y1, z0], [x2, y2, z1], [x1, y1, z1], n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.add(k, g);
  }

  /**
   * Extrusión de una sección (z, y) a lo largo de x, de x0 a x1 (para la pluma: sección con cantos achaflanados).
   * Se hace con ext() en el plano (−z, y) y un giro de 90° alrededor de y (x' = z, z' = −x), sin reflejar.
   */
  extX(k: MatKey, sec: [number, number][], x0: number, x1: number) {
    const n = this.geos.get(k)?.length ?? 0;
    this.ext(k, sec.map(([z, y]) => [-z, y] as [number, number]), x0, x1);
    this.geos.get(k)![n].rotateY(Math.PI / 2);
  }

  /** Fusiona por material y cuelga las mallas de `parent`. */
  build(parent: THREE.Object3D, pal: Palette, shadow = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, list] of this.geos) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const x of list) x.dispose();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, pal[k]);
      m.castShadow = shadow && k !== 'glass';
      m.receiveShadow = shadow;
      parent.add(m);
      out.push(m);
    }
    this.geos.clear();
    return out;
  }

  /** Triángulos acumulados (para medir). */
  triangles() {
    let n = 0;
    for (const l of this.geos.values()) for (const g of l) n += g.attributes.position.count / 3;
    return n;
  }
}
