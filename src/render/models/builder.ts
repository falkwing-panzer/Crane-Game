import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface, vcMaterial, type MatKey, type Palette } from './materials';
import { bakeAO, type AoPiece } from './ao';

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

/** Capa de las mallas solo de sombra: la cámara principal ve la 0; la de sombras, la 0 y esta. */
export const SHADOW_LAYER = 1;
/** Material de las mallas de sombra (solo se usa su lado: el pase de sombras pone el suyo). */
const SHADOW_MAT = new THREE.MeshBasicMaterial();
/** Claves que conservan su malla y su material (ver build). */
const OWN_MESH = new Set<MatKey>(['cabin', 'glass', 'lamp', 'beacon']);

/** Nombre de las mallas de detalle (fase 16): se dejan de dibujar de lejos (`render/lod.ts`) */
export const DETAIL = 'detalle';
/** Lado máximo de los trozos en que se parten las caras grandes (la oclusión ambiental va por vértice) */
const AO_SEG = 1.5;

interface Item {
  g: THREE.BufferGeometry;
  /** oscurece a las demás piezas (oclusión ambiental): cajas, perfiles y cilindros alineados con un eje */
  occ: boolean;
  /** detalle pequeño (barandillas, escalerillas, pilotos…): malla aparte, sin sombra, oculta de lejos */
  det: boolean;
}

export class Parts {
  private geos = new Map<MatKey, Item[]>();
  private inDetail = false;

  add(k: MatKey, g: THREE.BufferGeometry, occ = true) {
    let l = this.geos.get(k);
    if (!l) this.geos.set(k, (l = []));
    l.push({ g: clean(g), occ, det: this.inDetail });
  }

  /**
   * Fase 16: lo que se añade dentro de `fn` es detalle pequeño. Va en su propia malla (una por grupo), no proyecta
   * sombra y se deja de dibujar a distancia.
   */
  detail(fn: () => void) {
    const was = this.inDetail;
    this.inDetail = true;
    try { fn(); } finally { this.inDetail = was; }
  }

  /** Caja alineada con los ejes, de (x0, y0, z0) a (x1, y1, z1). */
  box(k: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    if (sx < 1e-4 || sy < 1e-4 || sz < 1e-4) return;
    // fase 16: las caras grandes en trozos de ≤ 1,5 m, para que la oclusión ambiental tenga vértices
    const seg = (v: number) => (this.inDetail ? 1 : Math.min(8, Math.max(1, Math.ceil(v / AO_SEG))));
    const g = new THREE.BoxGeometry(sx, sy, sz, seg(sx), seg(sy), seg(sz));
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
    // un cilindro inclinado no se parece a su caja envolvente: no oscurece a las demás
    this.add(k, g, Math.max(Math.abs(_b.x), Math.abs(_b.y), Math.abs(_b.z)) > 0.99);
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
      // lados largos en trozos (fase 16: oclusión ambiental por vértice; la pluma es una extrusión de decenas de m)
      const ns = this.inDetail ? 1 : Math.min(16, Math.max(1, Math.ceil(Math.abs(z1 - z0) / (2 * AO_SEG))));
      for (let j = 0; j < ns; j++) {
        const za = z0 + ((z1 - z0) * j) / ns, zb = z0 + ((z1 - z0) * (j + 1)) / ns;
        tri([x1, y1, za], [x2, y2, za], [x2, y2, zb], n);
        tri([x1, y1, za], [x2, y2, zb], [x1, y1, zb], n);
      }
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
    this.geos.get(k)![n].g.rotateY(Math.PI / 2);
  }

  /**
   * Fusiona y cuelga las mallas de `parent` (fase 11, para bajar draw calls):
   * - los colores lisos van en **una** malla con colores por vértice (material compartido `vcMaterial()`), con la
   *   oclusión ambiental horneada en el color y, con el material estándar, rugosidad y metal por vértice (atributo
   *   `rm`) (fase 16);
   * - los detalles pequeños (`detail`) van en otra malla de colores, `DETAIL`, que no proyecta sombra (fase 16);
   * - cabina, cristal y luces (emisivas) siguen en mallas propias: la RT y las orugas ocultan su cabina buscando
   *   esos materiales, y las luces tienen brillo propio;
   * - con sombras, las mallas de color no proyectan: **una** malla solo de sombra con todo el grupo (menos el
   *   cristal y los detalles) en la capa `SHADOW_LAYER`, que solo ve la cámara de sombras.
   * La malla de sombra va al final de la lista devuelta (se oculta junto con las demás).
   */
  build(parent: THREE.Object3D, pal: Palette, shadow = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const casters: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, cast: boolean) => {
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = false;
      m.receiveShadow = shadow;
      if (shadow && cast) casters.push(g);
      parent.add(m);
      out.push(m);
      return m;
    };
    const merge = (l: THREE.BufferGeometry[]) => {
      const g = l.length === 1 ? l[0] : mergeGeometries(l, false);
      if (l.length > 1) for (const x of l) x.dispose();
      return g;
    };
    for (const [k, list] of this.geos) if (OWN_MESH.has(k)) add(merge(list.map((x) => x.g)), pal[k], k !== 'glass');
    // oclusión ambiental entre las piezas de color del grupo (los detalles la reciben, pero no oscurecen)
    const flat: { k: MatKey; it: Item }[] = [];
    for (const [k, list] of this.geos) if (!OWN_MESH.has(k)) for (const it of list) flat.push({ k, it });
    const ao = bakeAO(flat.map(({ it }): AoPiece => {
      let box: AoPiece['box'] = null;
      if (it.occ && !it.det) {
        it.g.computeBoundingBox();
        const b = it.g.boundingBox!;
        box = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
      }
      return { pos: it.g.attributes.position.array, nor: it.g.attributes.normal.array, box };
    }));
    const vc = vcMaterial();
    const std = vc instanceof THREE.MeshStandardMaterial;
    const body: THREE.BufferGeometry[] = [], det: THREE.BufferGeometry[] = [];
    flat.forEach(({ k, it }, i) => {
      const g = it.g, c = pal[k].color, f = ao[i];
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) { col[3 * v] = c.r * f[v]; col[3 * v + 1] = c.g * f[v]; col[3 * v + 2] = c.b * f[v]; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (std) {
        const [r, m] = surface(k), rm = new Float32Array(n * 2);
        for (let v = 0; v < n; v++) { rm[2 * v] = r; rm[2 * v + 1] = m; }
        g.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
      }
      (it.det ? det : body).push(g);
    });
    if (body.length) add(merge(body), vc, true);
    if (det.length) add(merge(det), vc, false).name = DETAIL;
    if (casters.length) {
      const sg = mergeGeometries(casters.map((g) => {
        const s = new THREE.BufferGeometry();
        s.setAttribute('position', g.attributes.position);
        return s;
      }), false);
      sg.computeBoundingSphere();
      const sm = new THREE.Mesh(sg, SHADOW_MAT);
      sm.castShadow = true;
      sm.layers.set(SHADOW_LAYER);
      sm.name = 'sombra';
      parent.add(sm);
      out.push(sm);
    }
    this.geos.clear();
    return out;
  }

  /** Triángulos acumulados (para medir). */
  triangles() {
    let n = 0;
    for (const l of this.geos.values()) for (const { g } of l) n += g.attributes.position.count / 3;
    return n;
  }
}
