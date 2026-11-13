import * as THREE from 'three';

/**
 * Agua con movimiento (fase 16): las zonas de agua (el río del nivel 4, el agua de la prueba libre) llevan un material
 * Phong (brillo del sol, sombras y niebla como el resto) cuya normal se ondula con cuatro trenes de ondas que avanzan
 * con el tiempo. Sin reflejos ni texturas: solo cuentas en el sombreador de fragmentos. El tiempo es uno para todas.
 */
const uTime = { value: 0 };

/** Cada cuadro, con el tiempo de dibujo (s) */
export function updateWater(t: number) {
  uTime.value = t % 1000;
}

export function waterMaterial(color: string, polygonOffsetFactor = -1) {
  const m = new THREE.MeshPhongMaterial({
    color, specular: '#b9cfdc', shininess: 70, polygonOffset: true, polygonOffsetFactor, polygonOffsetUnits: polygonOffsetFactor,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n\tvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vWp;\n' + sh.fragmentShader.replace('#include <normal_fragment_begin>', /* glsl */ `
      #include <normal_fragment_begin>
      {
        // ondas: (dirección, número de onda, velocidad, amplitud) → pendiente en x y z
        vec2 p = vWp.xz, g = vec2(0.0);
        float h = 0.0;
        vec4 W[4];
        W[0] = vec4(normalize(vec2(1.0, 0.35)), 0.9, 1.4);
        W[1] = vec4(normalize(vec2(-0.4, 1.0)), 1.7, 1.9);
        W[2] = vec4(normalize(vec2(0.7, -0.8)), 3.1, 2.6);
        W[3] = vec4(normalize(vec2(-1.0, -0.2)), 5.3, 3.4);
        float A[4];
        A[0] = 0.06; A[1] = 0.035; A[2] = 0.018; A[3] = 0.01;
        for (int i = 0; i < 4; i++) {
          float ph = dot(W[i].xy, p) * W[i].z + uTime * W[i].w;
          h += A[i] * sin(ph);
          g += A[i] * W[i].z * cos(ph) * W[i].xy;
        }
        vec3 nw = normalize(vec3(-g.x, 1.0, -g.y));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        diffuseColor.rgb *= 0.92 + 1.6 * h;
      }`);
  };
  m.customProgramCacheKey = () => 'agua';
  return m;
}
