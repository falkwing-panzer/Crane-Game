import * as THREE from 'three';
import { hookCamPose, type HookAnchor } from './camera';

// Recuadro con la cámara del gancho (fase 21): una segunda vista de la escena en una esquina, desde bajo la cabeza de
// la pluma mirando hacia abajo. Para que cueste poco:
// - se dibuja en una textura pequeña (PIP_W × PIP_H píxeles, sin la escala de la pantalla) y solo uno de cada
//   `EVERY` cuadros; en los demás se vuelve a poner la última imagen (1 llamada de dibujo);
// - no vuelve a dibujar el mapa de sombras (usa el del cuadro) y ve menos lejos.
// Las llamadas de dibujo de lo que ve sí se repiten en los cuadros en que se redibuja.

/** Tamaño del recuadro (px CSS) y su separación del borde derecho y de abajo (sobre la línea de teclas) */
export const PIP_W = 288, PIP_H = 216, PIP_RIGHT = 10, PIP_BOTTOM = 56;
/** Se redibuja uno de cada tantos cuadros (a 60 fps, 30 imágenes por segundo) */
export const EVERY = 2;

export class HookPip {
  readonly cam = new THREE.PerspectiveCamera(62, PIP_W / PIP_H, 0.3, 220);
  readonly el: HTMLElement;
  private rt: THREE.WebGLRenderTarget | null = null;
  private quad: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mesh: THREE.Mesh } | null = null;
  private vp = new THREE.Vector4();
  private sc = new THREE.Vector4();
  private n = 0;
  on = false;

  constructor(parent: HTMLElement, title: string) {
    parent.insertAdjacentHTML('beforeend', `<div class="pip-frame" hidden style="width:${PIP_W}px;height:${PIP_H}px"><span>${title}</span></div>`);
    this.el = parent.lastElementChild as HTMLElement;
  }

  setOn(on: boolean) {
    this.on = on;
    this.el.hidden = !on;
    this.n = 0; // al encenderlo, se dibuja enseguida
  }

  /** Dibuja el recuadro encima del cuadro ya dibujado. Devuelve las llamadas de dibujo y triángulos que añadió. */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, a: HookAnchor) {
    let calls = 0, triangles = 0;
    this.rt ??= new THREE.WebGLRenderTarget(PIP_W - 4, PIP_H - 4);
    const prevTarget = r.getRenderTarget();
    if (this.n++ % EVERY === 0) {
      const p = hookCamPose(a), cam = this.cam;
      cam.position.set(p.pos.x, p.pos.y, p.pos.z);
      cam.up.set(p.up.x, p.up.y, p.up.z);
      cam.lookAt(p.at.x, p.at.y, p.at.z);
      cam.updateMatrixWorld();
      const au = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false; // el mapa de sombras del cuadro vale
      r.setRenderTarget(this.rt);
      r.render(scene, cam);
      calls += r.info.render.calls;
      triangles += r.info.render.triangles;
      r.shadowMap.autoUpdate = au;
      r.setRenderTarget(prevTarget);
    }
    // la imagen en la esquina
    const q = this.quad ??= (() => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.rt!.texture, depthTest: false, depthWrite: false }));
      const s = new THREE.Scene();
      s.add(mesh);
      return { scene: s, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh };
    })();
    const x = r.domElement.clientWidth - PIP_RIGHT - PIP_W + 2, y = PIP_BOTTOM + 2, w = PIP_W - 4, h = PIP_H - 4;
    r.getViewport(this.vp);
    r.getScissor(this.sc);
    const scTest = r.getScissorTest(), ac = r.autoClear;
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.setScissorTest(true);
    r.autoClear = false;
    r.render(q.scene, q.cam);
    calls += r.info.render.calls;
    triangles += r.info.render.triangles;
    r.autoClear = ac;
    r.setScissorTest(scTest);
    r.setScissor(this.sc);
    r.setViewport(this.vp);
    return { calls, triangles };
  }

  dispose() {
    this.rt?.dispose();
    if (this.quad) { this.quad.mesh.geometry.dispose(); (this.quad.mesh.material as THREE.Material).dispose(); }
    this.el.remove();
  }
}
