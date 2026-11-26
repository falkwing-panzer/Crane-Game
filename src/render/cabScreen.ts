import * as THREE from 'three';
import { t } from '../i18n';

// Pantalla del LMI en la cabina (fase 21): en la vista de cabina, un monitor abajo, como los de las
// grúas, con radio, carga, capacidad, largo y ángulo de la pluma y la barra del LMI. Es una textura de canvas que se
// redibuja como mucho 6 veces por segundo y solo si cambia algo. Va pegada a la cámara (las piezas de la cabina se
// ocultan en esa vista, así que nada la tapa) y en su propia capa, que solo ve la cámara principal.

const tc = t.cab, th = t.hud;
/** Capa de la pantalla: la cámara principal la ve; la del recuadro del gancho y la de sombras no */
export const CAB_LAYER = 3;
const W = 512, H = 288;
/** Medidas del monitor (m) y distancia a la que va delante del ojo */
const SW = 0.27, SH = (SW * H) / W, DIST = 0.62;

export interface CabData {
  name: string;
  radius: number;
  load: number | null;
  rated: number;
  lmi: number;
  Lb: number;
  angDeg: number;
  tower: boolean;
  cut: boolean;
  expert: boolean;
}

const f1 = (v: number) => v.toFixed(1).replace('.', ',');
export const LMI_COL = { ok: '#4cc38a', warn: '#f5c542', bad: '#ff6b5a' } as const;

/** Lo que dice la pantalla, en texto (para probarlo sin canvas) */
export function cabLines(d: CabData): [string, string][] {
  const rows: [string, string][] = [
    [tc.radius, `${f1(d.radius)} m`],
    [tc.load, d.load === null ? tc.free : `${f1(d.load)} t`],
  ];
  if (!d.expert) rows.push([tc.cap, `${f1(d.rated)} t`]);
  rows.push(d.tower ? [tc.trolley, `${f1(d.Lb)} m`] : [tc.boom, `${f1(d.Lb)} m`], [tc.angle, `${f1(d.angDeg)}°`]);
  return rows;
}

export class CabScreen {
  readonly group = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';
  private last = -Infinity;

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH),
      new THREE.MeshBasicMaterial({ map: this.tex, fog: false, depthTest: false, toneMapped: false }));
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(SW + 0.03, SH + 0.03),
      new THREE.MeshBasicMaterial({ color: 0x15181c, fog: false, depthTest: false }));
    bezel.position.z = -0.002;
    bezel.renderOrder = 20;
    screen.renderOrder = 21;
    for (const m of [bezel, screen]) { m.layers.set(CAB_LAYER); m.frustumCulled = false; this.group.add(m); }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Cada cuadro: sigue a la cámara (abajo a la derecha, un poco girada hacia el ojo) y se redibuja si hace falta */
  update(cam: THREE.PerspectiveCamera, on: boolean, d: CabData | null, now = performance.now()) {
    this.group.visible = on && !!d;
    if (!on || !d) return;
    // abajo en el centro (la esquina derecha es del recuadro del gancho), con un ancho según la vista
    const halfH = DIST * Math.tan((cam.fov * Math.PI) / 360), halfW = halfH * cam.aspect;
    const k = Math.min(1, (0.55 * halfW) / SW, (0.5 * halfH) / SH);
    this.group.scale.setScalar(k);
    this.group.position.set(-0.05 * halfW, -halfH + (SH * k) / 2 + 0.14 * halfH, -DIST);
    this.group.position.applyQuaternion(cam.quaternion).add(cam.position);
    this.group.quaternion.copy(cam.quaternion).multiply(_tilt);
    const key = JSON.stringify([cabLines(d), Math.round(d.lmi * 100), d.cut, d.name]);
    if (key === this.key || now - this.last < 160) return;
    this.key = key;
    this.last = now;
    this.draw(d);
  }

  private draw(d: CabData) {
    const g = this.g;
    g.fillStyle = '#0b0e11';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f0bb27';
    g.font = 'bold 26px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillText(`${tc.title} · ${d.name}`, 18, 14);
    let y = 56;
    if (!d.expert) {
      const c = d.lmi >= 1 ? 'bad' : d.lmi >= 0.9 ? 'warn' : 'ok', col = LMI_COL[c];
      g.fillStyle = col;
      g.font = 'bold 46px system-ui, sans-serif';
      g.fillText(`${th.lmiIcon[c]} ${Math.round(d.lmi * 100)} %`, 18, y);
      g.font = 'bold 22px system-ui, sans-serif';
      g.fillText(th.lmiState[c].toUpperCase(), 270, y + 14);
      y += 58;
      g.fillStyle = '#2a3038';
      g.fillRect(18, y, W - 36, 16);
      g.fillStyle = col;
      g.fillRect(18, y, (W - 36) * Math.min(1, d.lmi / 1.25), 16);
      g.fillStyle = '#fff';
      g.fillRect(18 + (W - 36) * 0.8 - 1, y - 3, 3, 22); // 100 %
      y += 30;
    } else y += 10;
    g.font = '24px system-ui, sans-serif';
    const rows = cabLines(d);
    rows.forEach(([k, v], i) => {
      const x = i % 2 ? W / 2 + 10 : 18, yy = y + Math.floor(i / 2) * 34;
      g.fillStyle = '#aab3bc';
      g.fillText(k, x, yy);
      g.fillStyle = '#f2f4f6';
      g.textAlign = 'right';
      g.fillText(v, x + W / 2 - 40, yy);
      g.textAlign = 'left';
    });
    if (d.cut) {
      g.fillStyle = '#ff6b5a';
      g.fillRect(W - 140, 12, 122, 34);
      g.fillStyle = '#111';
      g.font = 'bold 22px system-ui, sans-serif';
      g.fillText(th.cut.split(' ')[0].toUpperCase(), W - 130, 18);
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.tex.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }
}

/** Un poco girada hacia el ojo (como un monitor en la consola de la derecha) */
const _tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, -0.12, 0));
