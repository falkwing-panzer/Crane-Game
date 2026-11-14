import * as THREE from 'three';
import { lit } from './models/materials';
import { patchRect, type Terrain } from '../terrain/terrain';

// Fase 18: malla de cada parche del terreno con las mismas alturas y los mismos triángulos que el heightfield de
// Rapier (diagonal de (x0, z1) a (x1, z0)). Las celdas planas en 0 no se dibujan: ahí se ve el suelo de siempre.

const TOP = new THREE.Color('#8a7f68'), FLANK = new THREE.Color('#6f604a');
const _c = new THREE.Color();

export function terrainMeshes(terrain: Terrain): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const p of terrain.patches) {
    const n = p.nz + 1, pos: number[] = [], col: number[] = [];
    const H = (i: number, j: number) => p.h[j + i * n];
    const vtx = (i: number, j: number, slope: number) => {
      pos.push(p.x0 + i * p.cell, H(i, j) + 0.004, p.z0 + j * p.cell);
      _c.copy(TOP).lerp(FLANK, Math.min(1, slope * 2.5));
      col.push(_c.r, _c.g, _c.b);
    };
    for (let i = 0; i < p.nx; i++) for (let j = 0; j < p.nz; j++) {
      const a = H(i, j), b = H(i + 1, j), c = H(i, j + 1), d = H(i + 1, j + 1);
      if (!a && !b && !c && !d) continue;
      const s1 = Math.hypot(b - a, c - a) / p.cell, s2 = Math.hypot(d - c, d - b) / p.cell;
      vtx(i, j, s1); vtx(i, j + 1, s1); vtx(i + 1, j, s1);
      vtx(i + 1, j + 1, s2); vtx(i + 1, j, s2); vtx(i, j + 1, s2);
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, lit({ vertexColors: true }));
    m.castShadow = m.receiveShadow = true;
    const r = patchRect(p);
    m.name = `terreno ${r.x0}…${r.x1} × ${r.z0}…${r.z1}`;
    out.push(m);
  }
  return out;
}
