import * as THREE from 'three';
import type { Quat, V3 } from '../crane/pose';

// Ayudas para principiantes (fase 21), activables en Opciones: plomada del gancho (o de la carga) al suelo, marca de
// la planta de la carga en el suelo, círculo del radio actual y contorno del radio máximo con la carga colgada.
// Solo líneas (4 llamadas de dibujo), sin sombra, recolocadas cada cuadro.

const N_RING = 72;
/** Altura sobre el suelo de las marcas (m) */
const LIFT = 0.08;

export interface AidsInput {
  /** Punto del que cuelga la plomada (fondo de la carga o del gancho) */
  from: V3;
  /** Carga enganchada: centro, giro y medias medidas (null sin carga) */
  load: { t: V3; q: Quat; half: V3 } | null;
  /** Eje de giro en el mundo y radio actual (m) */
  piv: V3;
  radius: number;
  /** Contorno del radio máximo en el mundo (x, z); null sin carga colgada */
  maxRing: { x: number; z: number }[] | null;
  ground: (x: number, z: number) => number;
}

function lineObj(n: number, color: number, loop: boolean, opacity = 0.9) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const l = loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
  l.frustumCulled = false;
  l.renderOrder = 5;
  return l;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Aids {
  readonly group = new THREE.Group();
  private plumb = lineObj(2, 0xffffff, false);
  private mark = lineObj(4, 0xf0bb27, true);
  private ring = lineObj(N_RING, 0x5fd0ff, true, 0.8);
  private max = lineObj(36, 0xff8b3d, true);

  constructor(scene: THREE.Scene) {
    this.group.add(this.plumb, this.mark, this.ring, this.max);
    this.group.visible = false;
    scene.add(this.group);
  }

  update(on: boolean, a: AidsInput | null) {
    this.group.visible = on && !!a;
    if (!on || !a) return;
    const set = (l: THREE.Line, i: number, x: number, y: number, z: number) => (l.geometry.attributes.position as THREE.BufferAttribute).setXYZ(i, x, y, z);
    const done = (l: THREE.Line) => { (l.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; };
    // plomada
    set(this.plumb, 0, a.from.x, a.from.y, a.from.z);
    set(this.plumb, 1, a.from.x, a.ground(a.from.x, a.from.z) + LIFT, a.from.z);
    done(this.plumb);
    // planta de la carga en el suelo
    this.mark.visible = !!a.load;
    if (a.load) {
      const { t, q, half } = a.load;
      _q.set(q.x, q.y, q.z, q.w);
      [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([sx, sz], i) => {
        _v.set(sx * half.x, 0, sz * half.z).applyQuaternion(_q);
        const x = t.x + _v.x, z = t.z + _v.z;
        set(this.mark, i, x, a.ground(x, z) + LIFT, z);
      });
      done(this.mark);
    }
    // radio actual
    for (let i = 0; i < N_RING; i++) {
      const s = (i / N_RING) * Math.PI * 2, x = a.piv.x + a.radius * Math.cos(s), z = a.piv.z + a.radius * Math.sin(s);
      set(this.ring, i, x, a.ground(x, z) + LIFT, z);
    }
    done(this.ring);
    // radio máximo con la carga colgada
    this.max.visible = !!a.maxRing && a.maxRing.length > 2;
    if (a.maxRing && a.maxRing.length > 2) {
      const pts = a.maxRing;
      const attr = this.max.geometry.attributes.position as THREE.BufferAttribute;
      if (attr.count !== pts.length) this.max.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3));
      pts.forEach((p, i) => set(this.max, i, p.x, a.ground(p.x, p.z) + LIFT, p.z));
      done(this.max);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const l of [this.plumb, this.mark, this.ring, this.max]) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
  }
}
