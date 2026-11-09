import * as THREE from 'three';
import type { CraneSpec } from '../crane/cranes';
import { HOOK_HALF_H, type Load, type Physics } from '../physics/world';
import { hookFalls, hookScale } from './models/layout';

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
  private hb: number;
  private loadMeshes = new Map<Load, THREE.Mesh>();
  private sling: THREE.LineSegments;
  private slingPos: Float32Array;

  constructor(scene: THREE.Scene, private phys: Physics, T: CraneSpec) {
    const steel = new THREE.MeshLambertMaterial({ color: '#7c8389' });
    const block = new THREE.MeshLambertMaterial({ color: '#f2b632' });
    const dark = new THREE.MeshLambertMaterial({ color: '#2a2e33' });
    const hb = (this.hb = hookScale(T));
    this.nFalls = hookFalls(T);

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

    this.falls = new THREE.InstancedMesh(cyl, new THREE.MeshLambertMaterial({ color: '#2a2c2e' }), this.nFalls);
    this.falls.castShadow = true;
    this.falls.frustumCulled = false;
    scene.add(this.falls);

    // un material por masa (la etiqueta de la textura dice las toneladas); las piezas pesadas, en acero
    const mats = new Map<number, THREE.MeshLambertMaterial>();
    for (const l of phys.loads) {
      let mt = mats.get(l.mass);
      if (!mt) mats.set(l.mass, (mt = new THREE.MeshLambertMaterial({ map: crateTexture(l.mass) })));
      const m = new THREE.Mesh(box, mt);
      m.scale.set(l.half.x * 2, l.half.y * 2, l.half.z * 2);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      this.loadMeshes.set(l, m);
    }

    this.slingPos = new Float32Array(8 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.slingPos, 3));
    this.sling = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1a1a1a' }));
    this.sling.frustumCulled = false;
    scene.add(this.sling);
  }

  /** lat = eje lateral de la superestructura en el mundo (los ramales salen de las poleas de la cabeza) */
  update(lat: THREE.Vector3) {
    const p = this.phys;
    const t = p.hookBody.translation(), r = p.hookBody.rotation();
    this.hook.position.set(t.x, t.y, t.z);
    this.hook.quaternion.set(r.x, r.y, r.z, r.w);

    // Ramales del cable de la cabeza a la parte superior del gancho
    const h = p.headWorld(), top = p.hookTop();
    _lat.copy(lat);
    _hx.set(1, 0, 0).applyQuaternion(this.hook.quaternion);
    const n = this.nFalls;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2);
      _a.set(h.x, h.y, h.z).addScaledVector(_lat, o * 0.13);
      _b.set(top.x, top.y, top.z).addScaledVector(_hx, o * 0.3 * this.hb);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _q.setFromUnitVectors(_up, _d.normalize());
      _m4.compose(_a.addScaledVector(_d, len / 2), _q, _s.set(0.025, len, 0.025));
      this.falls.setMatrixAt(i, _m4);
    }
    this.falls.instanceMatrix.needsUpdate = true;

    for (const [l, m] of this.loadMeshes) {
      const lt = l.body.translation(), lr = l.body.rotation();
      m.position.set(lt.x, lt.y, lt.z);
      m.quaternion.set(lr.x, lr.y, lr.z, lr.w);
    }

    // Eslinga de 4 ramales (solo visual; en física es un punto)
    const L = p.attached;
    this.sling.visible = !!L;
    if (L) {
      const hb = p.bodyPoint(p.hookBody, 0, -HOOK_HALF_H, 0);
      let i = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const c = p.bodyPoint(L.body, sx * (L.half.x - 0.08), L.half.y, sz * (L.half.z - 0.08));
        this.slingPos.set([hb.x, hb.y, hb.z, c.x, c.y, c.z], i);
        i += 6;
      }
      (this.sling.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
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
