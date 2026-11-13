import * as THREE from 'three';

/**
 * Fase 14: libera en la GPU lo que cuelga de unos objetos (geometrías, materiales, sus texturas, InstancedMesh).
 * Los materiales y geometrías compartidos (paleta de `materials.ts`, `VC_MAT`, geometrías unitarias) también se
 * liberan: three.js los vuelve a subir si otra partida los usa, así que es seguro y no deja nada colgado en la GPU.
 * Devuelve cuántos recursos distintos liberó (pruebas).
 */
export function disposeTree(roots: THREE.Object3D[]) {
  const seen = new Set<{ dispose(): void }>();
  const add = (r: { dispose(): void } | null | undefined) => { if (r) seen.add(r); };
  for (const root of roots) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      add(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) {
        add(mt);
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture) add(v);
        // ShaderMaterial: texturas en los uniforms
        const u = (mt as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) if (u[k].value instanceof THREE.Texture) add(u[k].value);
      }
      if (o instanceof THREE.InstancedMesh) add(o);
    });
  }
  for (const r of seen) r.dispose();
  return seen.size;
}

/**
 * Lo que una partida añadió a la escena: se apunta qué había antes y, al desmontar, se quita y se libera el resto.
 * (Más seguro que llevar la cuenta pieza a pieza: los modelos, la obra y el aparejo añaden objetos sueltos.)
 */
export class SceneMark {
  private before: Set<THREE.Object3D>;
  constructor(private scene: THREE.Scene) { this.before = new Set(scene.children); }

  /** Quita de la escena lo añadido desde la marca y lo libera */
  release() {
    const added = this.scene.children.filter((o) => !this.before.has(o));
    for (const o of added) this.scene.remove(o);
    return disposeTree(added);
  }
}
