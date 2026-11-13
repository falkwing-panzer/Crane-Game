import * as THREE from 'three';
import { lit } from './models/materials';
import { waterMaterial } from './water';
import type { Obstacle } from '../physics/world';
import type { SoftZone } from '../crane/terrain';

// Obstáculos de la obra (cajas fijas). Los bloques de hormigón van en un InstancedMesh.

const box = new THREE.BoxGeometry(1, 1, 1);

/** Obstáculos de prueba para la conducción (fase 3; los niveles llegan en la fase 9). */
export const TEST_OBSTACLES: Obstacle[] = [
  // fila de bloques de hormigón delante de la grúa
  ...[-6, -3, 0, 3, 6].map((z): Obstacle => ({ label: 'Bloque', kind: 'block', half: { x: 0.6, y: 0.6, z: 1.2 }, pos: { x: 30, y: 0.6, z }, rotY: 0 })),
  // dos bloques sueltos a la derecha
  { label: 'Bloque', kind: 'block', half: { x: 0.6, y: 0.6, z: 1.2 }, pos: { x: 16, y: 0.6, z: 18 }, rotY: 0.5 },
  { label: 'Bloque', kind: 'block', half: { x: 0.6, y: 0.6, z: 1.2 }, pos: { x: 19, y: 0.6, z: 20 }, rotY: 0.3 },
  // contenedor de 20 pies a la izquierda
  { label: 'Contenedor', kind: 'container', half: { x: 3.03, y: 1.3, z: 1.22 }, pos: { x: 4, y: 1.3, z: -18 }, rotY: 0.25, color: '#7a3b33' },
];

/** Carga pesada de prueba para la LR 3000: pieza de 800 t delante a la derecha, a unos 43 m del centro de giro */
export const TEST_HEAVY = { label: 'Pieza', mass: 800, half: { x: 3, y: 2.5, z: 3 }, pos: { x: 40, y: 2.5, z: 16 } };

/**
 * Terreno blando de prueba (fase 6), detrás de la grúa: barro (solo orugas y la RT 90) y, al lado, agua
 * (nadie). Colores de la referencia.
 */
export const TEST_SOFT: SoftZone[] = [
  { kind: 'mud', x: -32, z: 0, w: 26, d: 30 },
  { kind: 'water', x: -32, z: 30, w: 26, d: 14 },
];
const SOFT_COLOR = { mud: '#54432f', water: '#28465e' };

export function buildSite(scene: THREE.Scene, obstacles: Obstacle[], softs: SoftZone[] = []) {
  for (const s of softs) {
    // agua con ondas (fase 16)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), s.kind === 'water' ? waterMaterial(SOFT_COLOR.water) : lit({
      color: SOFT_COLOR[s.kind], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, 0.01, s.z);
    m.receiveShadow = true;
    scene.add(m);
  }
  const concrete = lit({ color: '#a7a39a' });
  const blocks = obstacles.filter((o) => o.kind === 'block');
  const inst = new THREE.InstancedMesh(box, concrete, Math.max(1, blocks.length));
  inst.count = blocks.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  blocks.forEach((o, i) => {
    q.setFromAxisAngle(up, o.rotY);
    m4.compose(new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z), q, new THREE.Vector3(2 * o.half.x, 2 * o.half.y, 2 * o.half.z));
    inst.setMatrixAt(i, m4);
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
  for (const o of obstacles) {
    if (o.kind !== 'container') continue;
    const m = new THREE.Mesh(box, lit({ color: o.color ?? '#3d6f8f' }));
    m.position.set(o.pos.x, o.pos.y, o.pos.z);
    m.rotation.y = o.rotY;
    m.scale.set(2 * o.half.x, 2 * o.half.y, 2 * o.half.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}
