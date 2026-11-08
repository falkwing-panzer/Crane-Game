import * as THREE from 'three';
import { HOOK_HALF_H, type Load, type Physics } from '../physics/world';

// Gancho, cable, eslingas y cargas: se dibujan a partir de los cuerpos de Rapier.

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Rigging {
  private hook = new THREE.Group();
  private cable: THREE.Mesh;
  private loadMeshes = new Map<Load, THREE.Mesh>();
  private sling: THREE.LineSegments;
  private slingPos: Float32Array;

  constructor(scene: THREE.Scene, private phys: Physics) {
    const steel = new THREE.MeshLambertMaterial({ color: '#7c8389' });
    const block = new THREE.MeshLambertMaterial({ color: '#e0a21b' });

    // Gancho: bloque de poleas + gancho. Origen = centro del cuerpo de Rapier.
    const b = new THREE.Mesh(box, block);
    b.scale.set(0.56, 0.6, 0.36);
    b.position.y = 0.18;
    const shank = new THREE.Mesh(cyl, steel);
    shank.scale.set(0.06, 0.25, 0.06);
    shank.position.y = -0.22;
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14, Math.PI * 1.5), steel);
    hk.position.y = -0.48 + 0.16;
    hk.rotation.z = Math.PI * 0.75;
    for (const m of [b, shank, hk]) { m.castShadow = true; this.hook.add(m); }
    scene.add(this.hook);

    this.cable = new THREE.Mesh(cyl, new THREE.MeshLambertMaterial({ color: '#2a2c2e' }));
    this.cable.castShadow = true;
    scene.add(this.cable);

    const crateMat = new THREE.MeshLambertMaterial({ map: crateTexture() });
    for (const l of phys.loads) {
      const m = new THREE.Mesh(box, crateMat);
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

  update() {
    const p = this.phys;
    const t = p.hookBody.translation(), r = p.hookBody.rotation();
    this.hook.position.set(t.x, t.y, t.z);
    this.hook.quaternion.set(r.x, r.y, r.z, r.w);

    // Cable de la cabeza a la parte superior del gancho
    const h = p.headWorld(), top = p.hookTop();
    _a.set(h.x, h.y, h.z);
    _b.set(top.x, top.y, top.z);
    _d.subVectors(_b, _a);
    const len = _d.length();
    this.cable.position.copy(_a).addScaledVector(_d, 0.5);
    this.cable.quaternion.setFromUnitVectors(_up, _d.normalize());
    this.cable.scale.set(0.03, len, 0.03);

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

function crateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a6a3a';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#5e3d1d';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
  g.fillStyle = '#f4e7c8';
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.fillText('2 t', 64, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
