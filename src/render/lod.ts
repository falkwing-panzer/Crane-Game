import * as THREE from 'three';
import { DETAIL } from './models/builder';

/**
 * Nivel de detalle (fase 16): las mallas de detalle de cada grupo (barandillas, escalerillas, pilotos, limpiaparabrisas,
 * mangueras; ver `Parts.detail`) se dejan de dibujar cuando quedan lejos de la cámara. Así la grúa lejana del tándem y
 * las vistas generales se ahorran esos triángulos y draw calls. No se toca `visible` (la vista de cabina oculta piezas
 * con él): la malla pasa a la capa `LOD_LAYER`, que la cámara no ve.
 */
export const LOD_LAYER = 2;
/** Distancia a la que se ocultan los detalles con una pantalla de 1080 líneas (m); escala con la altura del lienzo */
export const LOD_DIST = 70;

const _c = new THREE.Vector3();

export class DetailLod {
  private meshes: THREE.Mesh[] = [];

  constructor(roots: THREE.Object3D[]) {
    for (const r of roots) r.traverse((o) => { if (o.name === DETAIL && (o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh); });
  }

  get count() { return this.meshes.length; }

  /** Cada cuadro, antes de dibujar (con las matrices del cuadro anterior: basta) */
  update(camera: THREE.Camera, viewH: number) {
    const lim = LOD_DIST * Math.max(0.5, viewH / 1080);
    for (const m of this.meshes) {
      const s = m.geometry.boundingSphere;
      if (!s) continue;
      _c.copy(s.center).applyMatrix4(m.matrixWorld);
      const far = _c.distanceTo(camera.position) - s.radius > lim;
      m.layers.set(far ? LOD_LAYER : 0);
    }
  }
}
