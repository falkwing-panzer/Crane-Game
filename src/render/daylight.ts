import * as THREE from 'three';
import type { SceneCtx } from './scene';

// Fase 27: atardecer y noche. Sigue habiendo una sola luz con sombras (el sol, o la luna de noche); los focos de trabajo
// son luces puntuales sin sombra (como mucho MAX_LAMPS: cada una cuesta en todos los materiales iluminados). Solo
// dibujo: no toca la simulación.

export type LightMode = 'atardecer' | 'noche';
export const MAX_LAMPS = 3;

interface Look {
  sun: string; sunK: number; hemiSky: string; hemiGround: string; hemiK: number; top: string; horizon: string;
  /** Dirección hacia el sol (se escala como la de siempre): más baja al atardecer */
  dir: [number, number, number];
}

const LOOK: Record<LightMode, Look> = {
  atardecer: { sun: '#ffb27a', sunK: 0.85, hemiSky: '#f3c3a0', hemiGround: '#4c3d33', hemiK: 0.7, top: '#46598a', horizon: '#f4a76f', dir: [-50, 14, 22] },
  noche: { sun: '#9fb4e6', sunK: 0.16, hemiSky: '#3a4a6a', hemiGround: '#141416', hemiK: 0.4, top: '#04060c', horizon: '#18202f', dir: [20, 45, -30] },
};

/** Cambia la luz de la escena y pone los focos; `dispose` lo deja como estaba */
export class Daylight {
  private saved: { sun: THREE.Color; sunI: number; hemi: [THREE.Color, THREE.Color, number] | null; bg: unknown; fog: THREE.Color | null; top?: THREE.Color; hor?: THREE.Color };
  private added: THREE.Object3D[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  /** Dirección del sol para la cámara (encuadre de sombras) */
  readonly sunDir: THREE.Vector3;

  constructor(private ctx: SceneCtx, mode: LightMode, lamps: [number, number, number][], groundY: (x: number, z: number) => number) {
    const L = LOOK[mode], { scene, sun } = ctx;
    const hemi = scene.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight) ?? null;
    const sky = scene.children.find((o) => o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).uniforms?.top) as THREE.Mesh | undefined;
    const u = sky ? (sky.material as THREE.ShaderMaterial).uniforms : null;
    this.saved = {
      sun: sun.color.clone(), sunI: sun.intensity, hemi: hemi ? [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity] : null,
      bg: scene.background, fog: scene.fog ? (scene.fog as THREE.Fog).color.clone() : null,
      top: u?.top.value.clone(), hor: u?.horizon.value.clone(),
    };
    sun.color.set(L.sun);
    sun.intensity *= L.sunK;
    if (hemi) { hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity *= L.hemiK; }
    const horizon = new THREE.Color(L.horizon);
    scene.background = horizon;
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(horizon);
    if (u) { u.top.value = new THREE.Color(L.top); u.horizon.value = horizon.clone(); }
    this.sunDir = new THREE.Vector3(...L.dir);

    // focos: poste, cabezal que brilla y una luz puntual sin sombra
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 1, 6).translate(0, 0.5, 0);
    const head = new THREE.BoxGeometry(0.9, 0.35, 0.5);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#5a5f66' });
    const headMat = new THREE.MeshBasicMaterial({ color: '#fff3d6' });
    this.geos.push(pole, head);
    this.mats.push(poleMat, headMat);
    for (const [x, z, h] of lamps.slice(0, MAX_LAMPS)) {
      const y0 = groundY(x, z);
      const p = new THREE.Mesh(pole, poleMat);
      p.position.set(x, y0, z);
      p.scale.y = h;
      const hd = new THREE.Mesh(head, headMat);
      hd.position.set(x, y0 + h + 0.2, z);
      const light = new THREE.PointLight('#ffe2b0', mode === 'noche' ? 900 : 350, 70, 1.6);
      light.position.set(x, y0 + h - 0.3, z);
      this.added.push(p, hd, light);
    }
    for (const o of this.added) scene.add(o);
  }

  dispose() {
    const { scene, sun } = this.ctx, s = this.saved;
    sun.color.copy(s.sun);
    sun.intensity = s.sunI;
    const hemi = scene.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight);
    if (hemi && s.hemi) { hemi.color.copy(s.hemi[0]); hemi.groundColor.copy(s.hemi[1]); hemi.intensity = s.hemi[2]; }
    scene.background = s.bg as THREE.Color;
    if (scene.fog && s.fog) (scene.fog as THREE.Fog).color.copy(s.fog);
    const sky = scene.children.find((o) => o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).uniforms?.top) as THREE.Mesh | undefined;
    if (sky && s.top && s.hor) { const u = (sky.material as THREE.ShaderMaterial).uniforms; u.top.value = s.top; u.horizon.value = s.hor; }
    for (const o of this.added) o.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
