import * as THREE from 'three';
import { isStandard, lit } from './models/materials';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHADOW_LAYER } from './models/builder';
import { QUALITY, pixelRatio, type Quality } from '../ui/settings';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
}

const SKY_TOP = new THREE.Color('#5d8fc9');
const SKY_HORIZON = new THREE.Color('#cfdde9');

export function createScene(canvas: HTMLCanvasElement, quality: Quality = 'alto'): SceneCtx {
  const Q = QUALITY[quality];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
  // Escala de píxel según la calidad (alto: tope de 1,5 para no renderizar muy por encima de 1080p con el escalado
  // de Windows). Se puede forzar con ?pr=1 en la URL para comparar.
  renderer.setPixelRatio(pixelRatio(quality, devicePixelRatio, Number(new URLSearchParams(location.search).get('pr')) || undefined));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = Q.shadowMap > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON;
  scene.fog = new THREE.Fog(SKY_HORIZON, 120, 420);

  // Cielo: cúpula con degradado (un solo draw call, sin texturas).
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP;' +
      'void main(){ float t = pow(clamp(vP.y,0.0,1.0), 0.6); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  // luz de ambiente de hemisferio: cielo azulado arriba, tierra abajo (las caras de abajo quedan más oscuras)
  const std = isStandard();
  scene.add(new THREE.HemisphereLight('#d6e6f7', '#62584a', std ? 0.7 : 1.15));
  // calidad alta (fase 16): material estándar con el cielo como mapa de entorno (reflejos del cromo y la pintura)
  if (std) {
    scene.environment = skyEnvironment(renderer, skyMat);
    scene.environmentIntensity = 0.45;
  }

  // Una sola luz con sombras, mapa de 2048, encuadre fijo alrededor de la grúa.
  const sun = new THREE.DirectionalLight('#fff4e0', std ? 2.6 : 2.4);
  sun.position.set(30, 50, 20);
  sun.castShadow = Q.shadowMap > 0;
  sun.shadow.mapSize.set(Q.shadowMap || 512, Q.shadowMap || 512);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 140;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  // las mallas solo de sombra (Parts.build) van en la capa 1: el pase de sombras la ve, la cámara no
  s.layers.enable(SHADOW_LAYER);
  scene.add(sun, sun.target);

  // Suelo con cuadrícula de 5 m (referencia de escala) en la zona de la prueba libre (±150 m). Fase 17: solo se ve en
  // la prueba libre; el suelo de alrededor es del decorado (render/decorView.ts), un poco más abajo.
  const tex = gridTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), lit({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'cuadricula';
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 900);
  camera.position.set(22, 16, 26);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(2, 5, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 4;
  controls.maxDistance = 200;
  controls.update();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  return { renderer, scene, camera, controls, sun };
}

/**
 * Mapa de entorno del cielo (fase 16): la cúpula con su degradado y un suelo pardo, filtrados una vez con PMREM. Lo
 * usan los materiales estándar (calidad alta) para la luz de ambiente y los reflejos. Una textura, sin archivos.
 */
function skyEnvironment(renderer: THREE.WebGLRenderer, skyMat: THREE.ShaderMaterial) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), skyMat);
  env.add(dome);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(49, 24), new THREE.MeshBasicMaterial({ color: '#6f6656' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  env.add(floor);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  dome.geometry.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  return tex;
}

/**
 * Niebla de distancia por escena (fase 16): en una obra (nivel) empieza más allá de la diagonal de la parcela, para
 * que se vea entera y se pierda el borde del suelo; en la prueba libre, la de siempre. `size` = escala de la grúa
 * (la LR 3000, ~3): más lejos.
 */
export function sceneFog(ctx: SceneCtx, site: { w: number; d: number } | null, size = 1) {
  const fog = ctx.scene.fog;
  if (!(fog instanceof THREE.Fog)) return;
  const k = Math.max(1, size);
  if (site) {
    const diag = Math.hypot(site.w, site.d);
    fog.near = Math.max(diag, 60 * k);
    fog.far = fog.near + 260 + 40 * k;
  } else {
    fog.near = size > 2 ? 60 * size : 120;
    fog.far = size > 2 ? 420 + 40 * size : 420;
  }
}

/**
 * Fase 14: deja la vista como al crear la escena (cámara, objetivo, niebla, distancia máxima), para montar otra
 * partida sin recargar. `CameraRig` la ajusta después a la grúa nueva (encuadre de sombras, alejamiento de la LR 3000).
 */
export function resetView(ctx: SceneCtx) {
  const { scene, camera, controls } = ctx;
  if (scene.fog instanceof THREE.Fog) { scene.fog.near = 120; scene.fog.far = 420; }
  camera.position.set(22, 16, 26);
  controls.target.set(2, 5, 0);
  controls.maxDistance = 200;
  controls.enabled = true;
  controls.update();
}

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8f8a7a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const v = 120 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 4},${v - 16},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(60,58,50,0.35)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
