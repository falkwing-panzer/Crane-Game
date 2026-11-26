import * as THREE from 'three';
import type { Ring } from '../school/lessons';
import type { LevelZone } from '../levels/levels';

// Escuela (fase 19): los aros adonde hay que llevar la cabeza de la pluma. Miran siempre a la cámara (así se ven
// redondos desde cualquier lado); el del paso actual, amarillo y opaco; los siguientes, tenues; los hechos no se ven.
// Sin sombra ni luz: un aro de señal, no una pieza de la obra. Las zonas de la lección llevan además un borde
// amarillo con un poste en cada esquina (las de los niveles, translúcidas, casi no se ven desde lejos).

const NOW = new THREE.Color('#f0bb27'), NEXT = new THREE.Color('#d5dbe1');

export class RingsView {
  private meshes: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene, rings: Ring[], zones: LevelZone[] = []) {
    if (zones.length) scene.add(zoneMarks(zones));
    if (!rings.length) return;
    const geo = new THREE.TorusGeometry(1, 0.07, 8, 48);
    for (const r of rings) {
      const mat = new THREE.MeshBasicMaterial({ color: NEXT, transparent: true, opacity: 0.25, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(r.x, r.y, r.z);
      m.scale.setScalar(r.r);
      m.name = 'aro escuela';
      m.renderOrder = 2;
      scene.add(m);
      this.meshes.push(m);
      this.mats.push(mat);
    }
  }

  /** step = paso actual (el aro i es el del paso i) */
  update(step: number, camera: THREE.Camera) {
    this.meshes.forEach((m, i) => {
      m.visible = i >= step;
      m.quaternion.copy(camera.quaternion);
      const now = i === step;
      this.mats[i].color.copy(now ? NOW : NEXT);
      this.mats[i].opacity = now ? 0.95 : 0.25;
    });
  }
}

/** Borde (cinta de 0,25 m) y postes de 1,2 m en las esquinas de cada zona, en una sola malla */
function zoneMarks(zones: LevelZone[]) {
  const parts: THREE.BufferGeometry[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.push(g.toNonIndexed());
    g.dispose();
  };
  const w = 0.25, y0 = 0.04, y1 = 0.08; // por encima del relleno translúcido de la zona
  for (const z of zones) {
    const x0 = z.x - z.w / 2, x1 = z.x + z.w / 2, z0 = z.z - z.d / 2, z1 = z.z + z.d / 2, b = z.y;
    box(x0, x1, b + y0, b + y1, z0, z0 + w); box(x0, x1, b + y0, b + y1, z1 - w, z1);
    box(x0, x0 + w, b + y0, b + y1, z0, z1); box(x1 - w, x1, b + y0, b + y1, z0, z1);
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(px - 0.08, px + 0.08, b, b + 1.2, pz - 0.08, pz + 0.08);
  }
  const pos = parts.flatMap((g) => [...(g.getAttribute('position').array as Float32Array)]);
  parts.forEach((g) => g.dispose());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: NOW }));
  m.name = 'zonas escuela';
  return m;
}
