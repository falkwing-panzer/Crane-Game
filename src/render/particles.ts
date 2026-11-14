import * as THREE from 'three';

/**
 * Partículas baratas (fase 16): un sistema = un `THREE.Points` = una draw call. Las partículas viven en arreglos fijos
 * (sin crear objetos por cuadro); cada una tiene posición, velocidad, edad, vida y tamaño. Se dibujan como discos
 * difuminados (sin textura), se apagan al envejecer y respetan la niebla. Solo dibujo: usan Math.random y no tocan la
 * simulación (el determinismo no cambia).
 */
export interface ParticleLook {
  color: string;
  /** opacidad máxima */
  alpha: number;
  /** cuánto crece el tamaño a lo largo de la vida (1 = nada) */
  grow: number;
  /** aceleración vertical (m/s²; positiva = sube, como el humo) */
  lift: number;
  /** frenado del aire (1/s) */
  drag: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor, vAlpha * (1.0 - r) * (1.0 - r));
  #include <fog_fragment>
}`;

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private next = 0;
  /** Partículas vivas (para las pruebas) */
  alive = 0;

  constructor(readonly n: number, private look: ParticleLook) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(look.color) }, uScale: { value: 500 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Altura del lienzo en píxeles (el tamaño de los puntos va en metros) */
  setView(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Una partícula nueva (reemplaza a la más vieja si no hay sitio) */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[3 * i] = x; this.pos[3 * i + 1] = y; this.pos[3 * i + 2] = z;
    this.vel[3 * i] = vx; this.vel[3 * i + 1] = vy; this.vel[3 * i + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
  }

  update(dt: number) {
    const { lift, drag, grow, alpha } = this.look;
    const k = Math.exp(-drag * dt);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      alive++;
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      this.vel[3 * i] *= k; this.vel[3 * i + 1] = this.vel[3 * i + 1] * k + lift * dt; this.vel[3 * i + 2] *= k;
      this.pos[3 * i] += this.vel[3 * i] * dt;
      this.pos[3 * i + 1] = Math.max(0.05, this.pos[3 * i + 1] + this.vel[3 * i + 1] * dt);
      this.pos[3 * i + 2] += this.vel[3 * i + 2] * dt;
      this.size[i] = this.size0[i] * (1 + (grow - 1) * t);
      // aparece rápido y se desvanece despacio
      this.alpha[i] = alpha * Math.min(1, t * 8) * (1 - t);
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    this.points.visible = alive > 0;
  }
}

/**
 * Lluvia (fase 16): gotas como trazos cortos en una caja que acompaña a la cámara; caen en el sombreador de vértices
 * (la CPU no las mueve). Una draw call.
 */
export class Rain {
  readonly lines: THREE.LineSegments;
  private uni = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color('#c7d3dd') } };

  constructor(n = 5000, box = 60, height = 30) {
    const seed = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * box, y = Math.random() * height, z = Math.random() * box;
      for (let e = 0; e < 2; e++) { seed.set([x, y, z], (2 * i + e) * 3); end[2 * i + e] = e; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uni]),
      transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          float B = ${box.toFixed(1)}, H = ${height.toFixed(1)};
          // caja que se repite alrededor de la cámara: cada gota vuelve a caer desde arriba
          vec3 p = position;
          p.x = mod(p.x - uCenter.x + 0.08 * p.y, B) - B * 0.5 + uCenter.x;
          p.z = mod(p.z - uCenter.z, B) - B * 0.5 + uCenter.z;
          p.y = mod(p.y - uTime * 11.0, H) + max(0.0, uCenter.y - H * 0.5);
          // trazo: el extremo de arriba, 0,45 m más alto e inclinado con el viento
          p += aEnd * vec3(0.04, 0.45, 0.0);
          vA = 0.25 + 0.2 * aEnd;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(uColor, vA);
          #include <fog_fragment>
        }`,
    });
    this.lines = new THREE.LineSegments(g, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }

  update(time: number, camera: THREE.Camera) {
    const u = (this.lines.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
  }
}
