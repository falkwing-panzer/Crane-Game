import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHADOW_LAYER } from './models/builder';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
}

const SKY_TOP = new THREE.Color('#5d8fc9');
const SKY_HORIZON = new THREE.Color('#cfdde9');

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Tope de 1,5 para no renderizar muy por encima de 1080p con el escalado de Windows.
  // Se puede forzar con ?pr=1 en la URL para comparar.
  const pr = Number(new URLSearchParams(location.search).get('pr')) || Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
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

  scene.add(new THREE.HemisphereLight('#dbe8f5', '#6b6250', 1.2));

  // Una sola luz con sombras, mapa de 2048, encuadre fijo alrededor de la grúa.
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 140;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  // las mallas solo de sombra (Parts.build) van en la capa 1: el pase de sombras la ve, la cámara no
  s.layers.enable(SHADOW_LAYER);
  scene.add(sun, sun.target);

  // Suelo con cuadrícula de 5 m (referencia de escala).
  const tex = gridTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
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
