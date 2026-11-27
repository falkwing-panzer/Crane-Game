import * as THREE from 'three';
import { lit, type LitMat } from './models/materials';
import type { CraneSpec } from '../crane/cranes';
import { HOOK_HALF_H, type Load, type Physics } from '../physics/world';
import { hookFalls, hookScale } from './models/layout';
import { apply, rotate, type Quat } from '../crane/pose';
import { tieLug } from '../crane/tiedown';
import type { BodyT, UnitFrame } from '../game/interp';
import type { V3 } from '../crane/pose';
import { catenary, SLACK_MIN } from './catenary';
import { RopeSim } from './ropeSim';

/** Tramos de cada ramal del cable y de cada ramal de la eslinga (rectos cuando están tensos) */
const FALL_SEG = 16;
const SLING_SEG = 8;
/** Ramales de la eslinga como mucho (fase 26: 4 + el del balancín) */
const MAX_LEGS = 6;
const _pts: V3[] = [];

/** Punto (x, y, z) del cuerpo en el mundo */
const pt = (b: BodyT, x: number, y: number, z: number) => {
  const p = rotate(b.q, { x, y, z });
  return { x: b.t.x + p.x, y: b.t.y + p.y, z: b.t.z + p.z };
};

// Gancho, cable, eslingas y cargas: se dibujan a partir de los cuerpos de Rapier.
// El aparejo se escala con la grúa (hookScale y ramales de la referencia); el alto sigue al cuerpo de Rapier.

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _hx = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Rigging {
  private hook = new THREE.Group();
  /** Ramales del cable entre la cabeza y el bloque del gancho */
  private falls: THREE.InstancedMesh;
  private nFalls: number;
  /** Cada ramal del cable, simulado como cadena de puntos cuando está flojo (fase 15 C) */
  private ropes: RopeSim[];
  private hb: number;
  private loadMeshes = new Map<Load, THREE.Mesh>();
  private sling: THREE.LineSegments;
  private slingPos: Float32Array;
  /** Balancín de las cargas largas (fase 26) */
  private beam: THREE.Mesh;

  /** drawLoads: dibujar las cargas (en el tándem las dibuja solo el aparejo de la primera grúa) */
  constructor(scene: THREE.Scene, private phys: Physics, private T: CraneSpec, drawLoads = true) {
    const steel = lit({ color: '#7c8389' });
    const block = lit({ color: '#f2b632' });
    const dark = lit({ color: '#2a2e33' });
    const hb = (this.hb = hookScale(T));
    this.nFalls = hookFalls(T);
    this.ropes = Array.from({ length: this.nFalls }, () => new RopeSim(FALL_SEG));

    // Gancho: bloque de poleas (de −0,05 a +0,5, como el cuerpo de Rapier) + vástago + gancho. Origen = centro del cuerpo.
    const parts: [THREE.Material, THREE.BufferGeometry, number, number, number, number, number, number][] = [
      [block, box, 0, 0.225, 0, 1.1 * hb, 0.55, 0.42 * hb],
      [dark, box, 0, 0.36, 0, 1.12 * hb, 0.08, 0.44 * hb],
      [steel, box, 0, -0.08, 0, 0.26 * hb, 0.07, 0.24 * hb],
    ];
    for (const [m, g, x, y, z, sx, sy, sz] of parts) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      this.hook.add(mesh);
    }
    // franjas negras del bloque
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(box, dark);
      m.scale.set(0.2 * hb, 0.07, 0.43 * hb);
      m.position.set((i - 1) * 0.36 * hb, 0.06, 0);
      this.hook.add(m);
    }
    const hr = 0.13 * Math.min(hb, 1.15), ht = 0.045 * Math.min(hb, 1.15);
    const hy = -HOOK_HALF_H + hr + ht, s0 = -0.115, s1 = hy + 0.6 * hr;
    const shank = new THREE.Mesh(cyl, steel);
    shank.scale.set(0.06 * hb, s0 - s1, 0.06 * hb);
    shank.position.y = (s0 + s1) / 2;
    const hk = new THREE.Mesh(new THREE.TorusGeometry(hr, ht, 6, 14, Math.PI * 1.5), steel);
    hk.position.y = hy;
    hk.rotation.z = Math.PI * 0.75;
    for (const m of [shank, hk]) { m.castShadow = true; this.hook.add(m); }
    scene.add(this.hook);

    // fase 15: cada ramal en FALL_SEG tramos, para dibujarlo en catenaria cuando el cable está flojo
    this.falls = new THREE.InstancedMesh(cyl, lit({ color: '#2a2c2e' }), this.nFalls * FALL_SEG);
    this.falls.castShadow = true;
    this.falls.frustumCulled = false;
    scene.add(this.falls);

    // un material por masa (la etiqueta de la textura dice las toneladas); las piezas pesadas, en acero
    // cargas de los niveles: su color y su etiqueta (CT de la referencia)
    const mats = new Map<string, LitMat>();
    for (const l of drawLoads ? phys.loads : []) {
      const key = l.color ? `${l.color}|${l.label}` : String(l.mass);
      let mt = mats.get(key);
      if (!mt) mats.set(key, (mt = lit({ map: l.color ? labelTexture(l.label, l.mass, l.color) : crateTexture(l.mass) })));
      const m = new THREE.Mesh(loadGeo(l.kind), mt);
      m.scale.set(l.half.x * 2, l.half.y * 2, l.half.z * 2);
      m.castShadow = m.receiveShadow = true;
      // sombra sin la textura de la etiqueta (fase 14): el material de profundidad compartido de three.js guarda la
      // última textura que vio y la volvía a subir a la GPU después de liberarla al cambiar de nivel
      m.customDepthMaterial = PLAIN_DEPTH;
      scene.add(m);
      this.loadMeshes.set(l, m);
    }

    // hasta MAX_LEGS ramales de SLING_SEG tramos (dos vértices por tramo)
    this.slingPos = new Float32Array(MAX_LEGS * SLING_SEG * 2 * 3);
    this.beam = new THREE.Mesh(box, lit({ color: '#d39a1c' }));
    this.beam.castShadow = true;
    this.beam.visible = false;
    scene.add(this.beam);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.slingPos, 3));
    this.sling = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1a1a1a' }));
    this.sling.frustumCulled = false;
    scene.add(this.sling);
  }

  /**
   * lat = eje lateral de la superestructura en el mundo (los ramales salen de las poleas de la cabeza). f y loads: lo
   * que se dibuja de esta grúa y de las cargas (fase 15: interpolado entre pasos; las cargas en el orden de phys.loads).
   */
  update(lat: THREE.Vector3, f: UnitFrame, loads: BodyT[], dt = 0) {
    const p = this.phys;
    const hk = f.hook, t = hk.t, r = hk.q;
    this.hook.position.set(t.x, t.y, t.z);
    this.hook.quaternion.set(r.x, r.y, r.z, r.w);

    // Ramales del cable de la cabeza a la parte superior del gancho
    const h = f.head, top = pt(hk, 0, HOOK_HALF_H, 0);
    _lat.copy(lat);
    _hx.set(1, 0, 0).applyQuaternion(this.hook.quaternion);
    const n = this.nFalls;
    // cable flojo: solo con el gancho o su carga apoyados (colgando, el gancho va unos cm por detrás del cabrestante al
    // bajar y eso no es cable flojo). Lo que sobra cae por su peso (RopeSim) y se amontona donde está apoyado el gancho
    // (no baja de su fondo ni del suelo). Amarrado o tenso, recto.
    const slack = p.hookSupported() ? f.S.cable - Math.hypot(top.x - h.x, top.y - h.y, top.z - h.z) : 0;
    const floor = Math.max(0.03, top.y - 2 * HOOK_HALF_H);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2);
      _a.set(h.x, h.y, h.z).addScaledVector(_lat, o * 0.13);
      _b.set(top.x, top.y, top.z).addScaledVector(_hx, o * 0.3 * this.hb);
      const len = _a.distanceTo(_b) + (slack > SLACK_MIN ? slack : 0);
      const pts = this.ropes[i].update(_a, _b, len, floor, dt, SLACK_MIN);
      for (let k = 0; k < FALL_SEG; k++) {
        _a.set(pts[k].x, pts[k].y, pts[k].z);
        _d.set(pts[k + 1].x - _a.x, pts[k + 1].y - _a.y, pts[k + 1].z - _a.z);
        const len = _d.length();
        if (len > 1e-6) _q.setFromUnitVectors(_up, _d.normalize());
        // un poco más largo que el tramo: sin huecos en los quiebres de la curva
        _m4.compose(_a.addScaledVector(_d, len / 2), _q, _s.set(0.025, len + 0.02, 0.025));
        this.falls.setMatrixAt(i * FALL_SEG + k, _m4);
      }
    }
    this.falls.instanceMatrix.needsUpdate = true;

    const lb = (l: Load) => loads[p.loads.indexOf(l)];
    for (const [l, m] of this.loadMeshes) {
      const b = lb(l), lt = b.t, lr = b.q;
      m.position.set(lt.x, lt.y, lt.z);
      m.quaternion.set(lr.x, lr.y, lr.z, lr.w);
    }

    // Eslinga: los ramales de la física (fase 26); con orejetas (tándem), 4 ramales dibujados hasta el punto
    const L = p.attached;
    this.beam.visible = false;
    let legs = 4;
    const tie = L || !p.tied ? null : apply(f.pose, tieLug(this.T));
    this.sling.visible = !!L || !!tie;
    if (tie) {
      // amarre al frente: cuatro ramales cortos del fondo del gancho al gancho de remolque
      const hb = pt(hk, 0, -HOOK_HALF_H, 0);
      let leg = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        this.leg(leg++, hb, { x: tie.x + sx * 0.05, y: tie.y, z: tie.z + sz * 0.12 }, 0, -Infinity);
      }
      (this.sling.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (L && p.rig.length) {
      const lbt = lb(L);
      // el balancín se dibuja donde está respecto de la carga en la física, con la carga interpolada
      let bt: BodyT | null = null;
      if (p.beam && p.beamHalf) {
        const lt = L.body.translation(), lq = L.body.rotation(), bp = p.beam.translation(), bq = p.beam.rotation();
        const iq = { x: -lq.x, y: -lq.y, z: -lq.z, w: lq.w };
        const rel = rotate(iq, { x: bp.x - lt.x, y: bp.y - lt.y, z: bp.z - lt.z });
        bt = { t: pt(lbt, rel.x, rel.y, rel.z), q: qmul(lbt.q, qmul(iq, bq)) };
        this.beam.position.set(bt.t.x, bt.t.y, bt.t.z);
        this.beam.quaternion.set(bt.q.x, bt.q.y, bt.q.z, bt.q.w);
        this.beam.scale.set(p.beamHalf.x * 2, p.beamHalf.y * 2, p.beamHalf.z * 2);
        this.beam.visible = true;
      }
      const sup = p.loadSupported();
      legs = 0;
      for (const l of p.rig) {
        const a = l.from === 'hook' ? pt(hk, l.a.x, l.a.y, l.a.z) : pt(bt!, l.a.x, l.a.y, l.a.z);
        const b = l.to === 'load' ? pt(lbt, l.b.x, l.b.y, l.b.z) : pt(bt!, l.b.x, l.b.y, l.b.z);
        // con la carga apoyada, lo que sobra de cada ramal se queda encima (no baja del punto más bajo)
        const slack = sup ? l.len - Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
        this.leg(legs++, a, b, slack, Math.min(a.y, b.y));
      }
      (this.sling.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    } else if (L) {
      const hb = pt(hk, 0, -HOOK_HALF_H, 0), lbt = lb(L);
      const lug = p.attachedLug >= 0 ? L.lugs![p.attachedLug] : null;
      // holgura de la eslinga (fase 15): con la carga apoyada y el gancho bajado, los ramales cuelgan sobre la carga;
      // al izar se tensan y quedan rectos. La eslinga física va al centro de la cara de arriba (o a la orejeta).
      const an = lug ? pt(lbt, lug.x, lug.y, lug.z) : pt(lbt, 0, L.half.y, 0);
      const slack = p.loadSupported() ? p.slingLength - Math.hypot(an.x - hb.x, an.y - hb.y, an.z - hb.z) : 0;
      let leg = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        // orejeta (tándem): los ramales van a la orejeta, algo abiertos
        const c = lug ? pt(lbt, lug.x + sx * 0.15, lug.y, lug.z + sz * 0.15)
          : pt(lbt, sx * (L.half.x - 0.08), L.half.y, sz * (L.half.z - 0.08));
        // lo que sobra se queda sobre la carga (no baja del punto de enganche)
        this.leg(leg++, hb, c, slack, lug ? -Infinity : Math.min(c.y, hb.y));
      }
      (this.sling.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    this.sling.geometry.setDrawRange(0, legs * SLING_SEG * 2);
  }

  /** Ramal `i` de la eslinga de `a` a `b`, con `slack` m de más (catenaria si sobra); `floor` = no baja de ahí */
  private leg(i: number, a: V3, b: V3, slack: number, floor: number) {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + (slack > SLACK_MIN ? slack : 0);
    const pts = catenary(a, b, len, SLING_SEG, floor, _pts);
    const P = this.slingPos;
    let j = i * SLING_SEG * 6;
    for (let k = 0; k < SLING_SEG; k++) {
      const u = pts[k], v = pts[k + 1];
      P[j++] = u.x; P[j++] = u.y; P[j++] = u.z; P[j++] = v.x; P[j++] = v.y; P[j++] = v.z;
    }
  }
}

/**
 * Fase 27: forma de algunas cargas (solo dibujo; en la física siguen siendo cajas): tramo de torre cilíndrico, buje
 * redondeado y pala afilada hacia la punta (+x). Geometrías de 1 × 1 × 1 que se escalan con la carga.
 */
const LOAD_GEO: Record<string, () => THREE.BufferGeometry> = {
  wtower: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  hub: () => new THREE.SphereGeometry(0.5, 16, 10),
  blade: () => {
    const g = new THREE.BoxGeometry(1, 1, 1, 10, 1, 1), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i) + 0.5; // 0 en la raíz, 1 en la punta
      p.setY(i, p.getY(i) * (1 - 0.75 * k));
      p.setZ(i, p.getZ(i) * (k < 0.15 ? 0.7 + 2 * k : 1 - 0.85 * (k - 0.15)));
    }
    g.computeVertexNormals();
    return g;
  },
};
const loadGeos = new Map<string, THREE.BufferGeometry>();
function loadGeo(kind?: string) {
  const f = kind ? LOAD_GEO[kind] : undefined;
  if (!f) return box;
  let g = loadGeos.get(kind!);
  // las geometrías compartidas se liberan al desmontar la partida (fase 14): se rehacen si hace falta
  if (!g || !g.attributes.position) { g = f(); loadGeos.set(kind!, g); }
  return g;
}

/** Profundidad para las sombras, sin texturas (las cargas son opacas: la etiqueta no cambia la sombra) */
const PLAIN_DEPTH = new THREE.MeshDepthMaterial();

/** Carga de un nivel: su color, con la etiqueta y las toneladas */
function labelTexture(label: string, mass: number, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  g.fillStyle = '#f4f1e8';
  g.textAlign = 'center';
  g.font = 'bold 22px sans-serif';
  g.fillText(label, 64, 56, 116);
  g.font = 'bold 20px sans-serif';
  g.fillText(`${mass.toLocaleString('es')} t`, 64, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crateTexture(mass: number) {
  const steel = mass >= 100;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = steel ? '#8d969e' : '#9a6a3a';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = steel ? '#4f565d' : '#5e3d1d';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
  g.fillStyle = '#f4e7c8';
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.fillText(`${mass.toLocaleString('es')} t`, 64, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Producto de cuaterniones a·b */
function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
