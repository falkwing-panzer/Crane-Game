import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHADOW_LAYER } from './models/builder';
import { Kit, camion, DC, type Prim } from '../decor/kit';
import { rng, type Decor, type Flat, type FlatKind } from '../decor/layout';
import { sockDroop, windYaw } from '../decor/wind';
import { waterMaterial } from './water';
import { hillHeight, type Hills } from '../terrain/terrain';

// Fase 17: dibujo del decorado (`decor/layout.ts`). Todo lo quieto se fusiona: una malla cercana (con su malla solo
// de sombra, como `Parts.build`), una lejana sin sombra, una de detalles que el sombreador quita de lejos, la malla
// de la valla (textura con agujeros), el suelo exterior con ruido, las calles y caminos, el agua que sigue fuera de
// la obra, el horizonte y las nubes. Animado con instancias y sin física: mangas de viento y banderas (giran con el
// viento del nivel y ondean en el sombreador), camiones por las calles y trabajadores. ~10–15 draw calls.

const _c = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

const SKY_HORIZON = new THREE.Color('#cfdde9');

/** Distancia (m, con 1080 líneas) a la que desaparecen los detalles del decorado */
export const DECOR_DETAIL = 80;

/** Geometría de una primitiva (posición y normal, sin índices) */
function primGeo(p: Prim): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.k === 'box') {
    // paredes altas: una fila de vértices a 2,5 m, para que la oclusión del pie (mergePrims) quede abajo
    const tall = p.sy > 3.5;
    g = new THREE.BoxGeometry(p.sx, p.sy, p.sz, 1, tall ? 2 : 1, 1);
    if (tall) {
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i)) < 1e-4) pos.setY(i, -p.sy / 2 + 2.5);
    }
    g.rotateY(p.r);
    g.translate(p.x, p.y, p.z);
  } else if (p.k === 'cyl') {
    _a.set(...p.a);
    _b.set(...p.b).sub(_a);
    const len = _b.length();
    g = new THREE.CylinderGeometry(p.r1, p.r0, Math.max(len, 1e-3), p.seg, 1, false);
    _q.setFromUnitVectors(_up, _b.normalize());
    g.applyQuaternion(_q);
    g.translate((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2);
  } else {
    // prisma: sección (z, y) triangular, a lo largo de x
    const hx = p.sx / 2, hz = p.sz / 2, h = p.sy;
    const v: number[] = [];
    const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
    const A = [-hx, 0, -hz], B = [-hx, 0, hz], C = [-hx, h, 0], A2 = [hx, 0, -hz], B2 = [hx, 0, hz], C2 = [hx, h, 0];
    tri(A, B, C); tri(B2, A2, C2);
    tri(B, B2, C2); tri(B, C2, C);
    tri(A2, A, C); tri(A2, C, C2);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    g.rotateY(p.r);
    g.translate(p.x, p.y, p.z);
  }
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  return n;
}

/**
 * Fusiona primitivas en una geometría con color por vértice. ao: el pie de las piezas más oscuro (oclusión del
 * suelo, barata: por la altura del vértice).
 */
export function mergePrims(list: Prim[], ao = true): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const geos = list.map((p) => {
    const g = primGeo(p);
    _c.set(p.c);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = ao ? 0.66 + 0.34 * Math.min(1, Math.max(0, y / 2.5)) : 1;
      col[3 * i] = _c.r * f; col[3 * i + 1] = _c.g * f; col[3 * i + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const g = mergeGeometries(geos, false);
  for (const x of geos) x.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Material de detalles: Lambert con color por vértice que deja los vértices lejanos fuera de la pantalla */
function detailMaterial(uDist: { value: number }) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = uDist;
    sh.vertexShader = 'uniform float uDetail;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      if (distance((modelMatrix * vec4(transformed, 1.0)).xyz, cameraPosition) > uDetail) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
  };
  m.customProgramCacheKey = () => 'decor-detail';
  return m;
}

/** Textura de malla de simple torsión (rombos) con transparencia */
function chainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(150,156,160,1)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FLAT_Y: Record<FlatKind, number> = { grass: 0.012, dirt: 0.014, gravel: 0.016, concrete: 0.02, road: 0.026, side: 0.032, line: 0.038 };
const FLAT_COL: Record<FlatKind, string> = {
  grass: '#62743f', dirt: '#7e6b51', gravel: '#8f8a80', concrete: '#9c9a93', road: '#4a4c4f', side: '#a5a39c', line: '#e4e1d6',
};

function flatsGeo(flats: Flat[]) {
  if (!flats.length) return null;
  const pos: number[] = [], col: number[] = [];
  for (const f of flats) {
    const y = FLAT_Y[f.kind];
    _c.set(FLAT_COL[f.kind]);
    const q = [[f.x0, f.z0], [f.x0, f.z1], [f.x1, f.z1], [f.x0, f.z0], [f.x1, f.z1], [f.x1, f.z0]];
    for (const [x, z] of q) { pos.push(x, y, z); col.push(_c.r, _c.g, _c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Ruido de valor 2D (mismo en JS que en el sombreador del suelo, aproximado) */
function noise2(R: () => number) {
  const N = 64, tab = Array.from({ length: N * N }, () => R());
  const at = (i: number, j: number) => tab[((i % N) + N) % N * N + ((j % N) + N) % N];
  return (x: number, z: number) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sz;
  };
}

/** Suelo exterior: plano grande con dos colores mezclados con ruido y grano fino en el sombreador */
const HILL = new THREE.Color('#56664a'), HILL_CITY = new THREE.Color('#6d7a86');

function groundMesh(D: Decor, hills: Hills | null) {
  // fase 18: llega hasta pasadas las colinas (antes, 1600 m fijos); celdas de ~20 m
  const size = Math.max(1600, hills ? 2 * (hills.r1 + 260) : 0), seg = Math.round(size / 20);
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  g.translate(D.center[0], -0.03, D.center[1]);
  g.deleteAttribute('uv');
  if (hills) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + hillHeight(hills, p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
  }
  const n = noise2(rng(D.seed + 1)), A = new THREE.Color(D.ground.a), B = new THREE.Color(D.ground.b);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, (n(x / 70, z / 70) * 0.7 + n(x / 23 + 17, z / 23 + 5) * 0.3 - 0.35) * 2.2));
    _c.copy(A).lerp(B, t);
    // fase 18: las colinas, del color del anillo de la fase 17 (verde; gris azulado en la ciudad)
    const y = pos.getY(i);
    if (y > 0.5) _c.lerp(D.city ? HILL_CITY : HILL, Math.min(1, (y - 0.5) / 12) * 0.85);
    col[3 * i] = _c.r; col[3 * i + 1] = _c.g; col[3 * i + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vGw;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n\tvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // fase 18: las colinas (por encima de unos metros) se velan como mucho al 55 %, como el anillo de la fase 17
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', '#ifdef USE_FOG\n' +
      '\tfloat fogF = smoothstep(fogNear, fogFar, vFogDepth);\n' +
      '\tfogF = mix(fogF, min(fogF, 0.55), smoothstep(1.5, 12.0, vGw.y));\n' +
      '\tgl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);\n#endif');
    sh.fragmentShader = 'varying vec3 vGw;\n#define vGp vGw.xz\nfloat gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      'float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);' +
      ' return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
      sh.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n\tdiffuseColor.rgb *= 0.86 + 0.16 * gn(vGp * 0.45) + 0.08 * gn(vGp * 2.3);');
  };
  m.customProgramCacheKey = () => 'decor-ground';
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.name = 'suelo-exterior';
  return mesh;
}

/**
 * Horizonte: en la ciudad, siluetas de edificios sin niebla, teñidas de cielo. Los dos anillos de colinas de la fase 17
 * son ahora terreno de verdad (fase 18, `Hills` en el suelo exterior). null fuera de la ciudad.
 */
function horizonMesh(D: Decor) {
  if (!D.city) return null;
  const R = rng(D.seed + 2);
  const pos: number[] = [], col: number[] = [];
  const [cx, cz] = D.center;
  R(); R(); R(); // (fase 17: fases del anillo lejano; así las siluetas salen donde estaban)
  if (D.city) {
    // siluetas de la ciudad delante del anillo lejano
    const city = new THREE.Color('#8a96a3');
    const n = D.env === 'dense' ? 90 : 60;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, rad = 330 + R() * 50, w = 10 + R() * 22, h = (D.env === 'dense' ? 30 : 18) + R() * (D.env === 'dense' ? 80 : 45);
      const c = city.clone().lerp(SKY_HORIZON, 0.42 + R() * 0.15);
      const tx = -Math.sin(a), tz = Math.cos(a), x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
      const q = [[x - tx * w / 2, z - tz * w / 2], [x + tx * w / 2, z + tz * w / 2]];
      const v = [[q[0], -2], [q[1], -2], [q[1], h], [q[0], -2], [q[1], h], [q[0], h]] as const;
      for (const [[px, pz], y] of v) { pos.push(px, y, pz); col.push(c.r, c.g, c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'horizonte';
  mesh.renderOrder = -0.5;
  return mesh;
}

/** Nubes: planos horizontales instanciados que avanzan con el viento y dan la vuelta en una caja de 800 m */
function cloudMesh(D: Decor, uTime: { value: number }, uDrift: { value: THREE.Vector2 }) {
  const R = rng(D.seed + 3), n = 26;
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime, uDrift, uCenter: { value: new THREE.Vector2(...D.center) } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec2 uDrift; uniform vec2 uCenter;
      varying vec2 vUv; varying float vFade; varying float vSeed;
      void main() {
        vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 p = mod(c.xz + uDrift * uTime - uCenter + 400.0, 800.0) - 400.0;
        vec3 w = vec3(p.x + uCenter.x, c.y, p.y + uCenter.y) + (instanceMatrix * vec4(position, 0.0)).xyz;
        vUv = uv; vSeed = c.x * 0.013 + c.z * 0.007;
        vFade = 1.0 - smoothstep(300.0, 390.0, length(p));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vFade; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        vec2 q = (vUv - 0.5) * 2.0;
        float d = length(q);
        float k = n(vUv * 4.0 + vSeed) * 0.6 + n(vUv * 9.0 - vSeed) * 0.4;
        float a = smoothstep(1.0, 0.25, d + (k - 0.5) * 0.7) * vFade * 0.82;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.86, 0.88, 0.91), vec3(1.0), k), a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 380;
    _p.set(D.center[0] + Math.cos(a) * r, 150 + R() * 70, D.center[1] + Math.sin(a) * r);
    _s.set(70 + R() * 110, 1, 35 + R() * 50);
    _q.setFromAxisAngle(_up, R() * Math.PI);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }
  _s.set(1, 1, 1);
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.4;
  mesh.name = 'nubes';
  return mesh;
}

/** Trapo de la manga (cono abierto a lo largo de +x desde el mástil, franjas naranja y blanco) */
function sockGeo() {
  const g = new THREE.CylinderGeometry(0.2, 0.4, 2.6, 10, 6, true).rotateZ(-Math.PI / 2).translate(1.3, 0, 0);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const o = new THREE.Color(DC.orange), w = new THREE.Color('#f2f0ea');
  for (let i = 0; i < pos.count; i++) {
    const c = Math.floor((pos.getX(i) / 2.6) * 5 - 1e-4) % 2 === 0 ? o : w;
    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Bandera: rectángulo de 1,8 × 1,2 m desde el mástil (+x), el borde de arriba en y = 0 */
function flagGeo() {
  const g = new THREE.PlaneGeometry(1.8, 1.2, 10, 1).translate(0.9, -0.6, 0);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}

/** Material del trapo: ondea con el tiempo y el viento (desplaza en z local, más cuanto más lejos del mástil) */
function clothMaterial(uTime: { value: number }, uWind: { value: number }) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uWind = uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float L = max(position.x, 0.0);
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        float amp = (0.05 + 0.02 * min(uWind, 10.0)) * L;
        transformed.z += sin(uTime * (3.0 + 0.5 * uWind) - position.x * 2.4 + ph) * amp;
        transformed.y += cos(uTime * (2.3 + 0.4 * uWind) - position.x * 1.7 + ph) * amp * 0.25;
      }`);
  };
  m.customProgramCacheKey = () => 'decor-cloth';
  return m;
}

/** Trabajador: botas, pantalón, chaleco reflectante, cabeza y casco (frente hacia +x) */
function workerGeo() {
  const k = new Kit();
  k.solid = false;
  for (const z of [-0.13, 0.13]) k.box(DC.dark, -0.1, 0.12, 0, 0.85, z - 0.08, z + 0.08);
  k.box('#e2c22a', -0.14, 0.14, 0.85, 1.45, -0.24, 0.24);
  for (const z of [-0.3, 0.3]) k.box('#3f4a5a', -0.07, 0.07, 0.9, 1.42, z - 0.06, z + 0.06);
  k.box('#c79a78', -0.1, 0.1, 1.45, 1.68, -0.1, 0.1);
  k.box(DC.white, -0.14, 0.15, 1.66, 1.78, -0.14, 0.14);
  return mergePrims(k.near, false)!;
}

/** Camión del tráfico (frente hacia +x) */
function truckGeo() {
  const k = new Kit();
  k.solid = false;
  camion(k, '#2f5d8a', DC.offWhite);
  return mergePrims([...k.near, ...k.detail], false)!;
}

interface Mover { pts: [number, number][]; lens: number[]; total: number; loop: boolean; speed: number; phase: number }

export class DecorView {
  readonly root = new THREE.Group();
  private uDetail = { value: DECOR_DETAIL };
  private uTime = { value: 0 };
  private uWind = { value: 0 };
  private uDrift = { value: new THREE.Vector2() };
  private socks: THREE.InstancedMesh | null = null;
  private flags: THREE.InstancedMesh | null = null;
  private trucks: THREE.InstancedMesh | null = null;
  private workers: THREE.InstancedMesh | null = null;
  private movers: Mover[] = [];
  private t = 0;

  /** low = calidad baja (detalles más cerca, sin sombras del decorado) */
  constructor(scene: THREE.Scene, private D: Decor, private windDir: number, private low = false, hills: Hills | null = null) {
    const root = this.root;
    root.name = 'decorado';
    scene.add(root);
    if (low) this.uDetail.value = DECOR_DETAIL / 2;
    root.add(groundMesh(D, hills));
    const fg = flatsGeo(D.flats);
    if (fg) {
      const fm = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      fm.receiveShadow = true;
      fm.name = 'calles';
      root.add(fm);
    }
    if (D.water.length) {
      const pos: number[] = [];
      for (const w of D.water) pos.push(w.x0, 0.012, w.z0, w.x0, 0.012, w.z1, w.x1, 0.012, w.z1, w.x0, 0.012, w.z0, w.x1, 0.012, w.z1, w.x1, 0.012, w.z0);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const wm = new THREE.Mesh(g, waterMaterial('#28465e', -2));
      wm.receiveShadow = true;
      wm.name = 'agua-exterior';
      root.add(wm);
    }
    // quieto: cerca (con sombra), lejos, detalles
    const near = mergePrims(D.kit.near);
    if (near) {
      const m = new THREE.Mesh(near, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true;
      m.name = 'decorado-cerca';
      root.add(m);
      if (!low) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', near.attributes.position);
        sg.boundingSphere = near.boundingSphere;
        const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial());
        sm.castShadow = true;
        sm.layers.set(SHADOW_LAYER);
        sm.name = 'sombra';
        root.add(sm);
      }
    }
    const far = mergePrims(D.kit.far);
    if (far) {
      const m = new THREE.Mesh(far, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true;
      m.name = 'decorado-lejos';
      root.add(m);
    }
    const det = mergePrims(D.kit.detail);
    if (det) {
      const m = new THREE.Mesh(det, detailMaterial(this.uDetail));
      m.receiveShadow = true;
      m.name = 'decorado-detalle';
      root.add(m);
    }
    // valla de malla
    if (D.kit.fence.length) {
      const pos: number[] = [], uv: number[] = [], nor: number[] = [];
      for (const f of D.kit.fence) {
        const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), u = len / 0.9, v = f.h / 0.9;
        const nx = -(f.b[1] - f.a[1]) / len, nz = (f.b[0] - f.a[0]) / len;
        const P = [[f.a[0], 0.05, f.a[1], 0, 0], [f.b[0], 0.05, f.b[1], u, 0], [f.b[0], f.h, f.b[1], u, v], [f.a[0], f.h, f.a[1], 0, v]];
        for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(P[i][0], P[i][1], P[i][2]); uv.push(P[i][3], P[i][4]); nor.push(nx, 0, nz); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: chainTexture(), alphaTest: 0.35, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      m.name = 'valla';
      root.add(m);
    }
    // cables de las líneas eléctricas fuera de la obra
    if (D.wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(D.wires.flatMap(([a, b]) => [...a, ...b]), 3));
      root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1d1f22' })));
    }
    const hz = horizonMesh(D);
    if (hz) root.add(hz);
    root.add(cloudMesh(D, this.uTime, this.uDrift));

    // animado
    const cloth = clothMaterial(this.uTime, this.uWind);
    if (D.socks.length) {
      this.socks = new THREE.InstancedMesh(sockGeo(), cloth, D.socks.length);
      this.socks.name = 'mangas';
      root.add(this.socks);
    }
    if (D.flags.length) {
      this.flags = new THREE.InstancedMesh(flagGeo(), cloth, D.flags.length);
      D.flags.forEach((f, i) => this.flags!.setColorAt(i, _c.set(f.c)));
      this.flags.name = 'banderas';
      root.add(this.flags);
    }
    for (const r of D.routes) {
      const lens: number[] = [];
      const segs = r.loop ? r.pts.length : r.pts.length - 1;
      for (let i = 0; i < segs; i++) { const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length]; lens.push(Math.hypot(b[0] - a[0], b[1] - a[1])); }
      const total = lens.reduce((s, x) => s + x, 0);
      for (let j = 0; j < r.n; j++) this.movers.push({ pts: r.pts, lens, total, loop: r.loop, speed: r.speed, phase: (j / r.n) * total + j * 13 });
    }
    if (this.movers.length) {
      this.trucks = new THREE.InstancedMesh(truckGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), this.movers.length);
      const cols = ['#2f5d8a', '#8b2f2a', '#e9e6dc', '#3f6b45', '#c48a2a'];
      this.movers.forEach((_, i) => this.trucks!.setColorAt(i, _c.set(cols[i % cols.length]).lerp(new THREE.Color('#ffffff'), 0.35)));
      this.trucks.frustumCulled = false;
      this.trucks.name = 'trafico';
      root.add(this.trucks);
    }
    if (D.walkers.length) {
      this.workers = new THREE.InstancedMesh(workerGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), D.walkers.length);
      this.workers.frustumCulled = false;
      this.workers.name = 'trabajadores';
      root.add(this.workers);
    }
    this.update(0, 0, null, 1080);
  }

  /** Cuadro: dt (0 en pausa), velocidad del viento (m/s), cámara y alto del lienzo (detalles) */
  update(dt: number, wind: number, camera: THREE.Camera | null, viewH: number) {
    this.t += dt;
    const t = this.t;
    this.uTime.value = t;
    this.uWind.value = wind;
    this.uDetail.value = (this.low ? DECOR_DETAIL / 2 : DECOR_DETAIL) * Math.max(0.5, viewH / 1080);
    const a = (this.windDir * Math.PI) / 180, drift = 1.5 + wind * 0.8;
    this.uDrift.value.set(Math.cos(a) * drift, Math.sin(a) * drift);
    const yaw = windYaw(this.windDir), droop = sockDroop(wind);
    if (this.socks) {
      this.D.socks.forEach((p, i) => {
        _e.set(0, yaw, -droop, 'YXZ');
        this.socks!.setMatrixAt(i, _m.compose(_p.set(...p), _q.setFromEuler(_e), _s));
      });
      this.socks.instanceMatrix.needsUpdate = true;
      this.socks.computeBoundingSphere();
    }
    if (this.flags) {
      const fd = Math.min(1.45, sockDroop(wind) * 1.12);
      this.D.flags.forEach((f, i) => {
        _e.set(0, yaw, -fd, 'YXZ');
        this.flags!.setMatrixAt(i, _m.compose(_p.set(...f.p), _q.setFromEuler(_e), _s));
      });
      this.flags.instanceMatrix.needsUpdate = true;
      this.flags.computeBoundingSphere();
    }
    if (this.trucks) {
      this.movers.forEach((m, i) => {
        let s = (m.phase + m.speed * t) % m.total;
        let k = 0;
        while (k < m.lens.length - 1 && s > m.lens[k]) { s -= m.lens[k]; k++; }
        const A = m.pts[k], B = m.pts[(k + 1) % m.pts.length];
        const L = m.lens[k] || 1, dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
        // carril de la derecha (−z = izquierda con el frente en +x: la derecha es (−dz, dx))
        const x = A[0] + dx * s - dz * 2.2, z = A[1] + dz * s + dx * 2.2;
        _q.setFromAxisAngle(_up, Math.atan2(-dz, dx));
        this.trucks!.setMatrixAt(i, _m.compose(_p.set(x, 0, z), _q, _s));
      });
      this.trucks.instanceMatrix.needsUpdate = true;
    }
    if (this.workers) {
      this.D.walkers.forEach((w, i) => {
        const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz);
        let x = w.a[0], z = w.a[1], r = i * 1.7 + Math.sin(t * 0.2 + i) * 0.8, bob = 0;
        if (L > 0.5) {
          const per = (2 * L) / 1.1, u = ((t + i * 7.3) % per) / per, back = u > 0.5, f = back ? 2 - 2 * u : 2 * u;
          x += dx * f; z += dz * f;
          r = Math.atan2(-(back ? -dz : dz), back ? -dx : dx);
          bob = Math.abs(Math.sin(t * 7 + i)) * 0.04;
        }
        _q.setFromAxisAngle(_up, r);
        this.workers!.setMatrixAt(i, _m.compose(_p.set(x, bob, z), _q, _s));
      });
      this.workers.instanceMatrix.needsUpdate = true;
    }
    void camera;
  }
}
