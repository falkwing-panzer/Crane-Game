import * as THREE from 'three';
import type { CraneSpec } from '../../crane/cranes';

// Paleta de materiales compartidos. Los colores son los de craneModel() de la referencia, agrupados en pocas
// claves para que cada grupo rígido de la grúa se dibuje con pocas draw calls (una por material).
// Los materiales se guardan por color: dos grúas con el mismo color usan los mismos objetos.

export type MatKey =
  | 'yellow' | 'yellowDark' | 'yellowShade' | 'grey' | 'greyDark' | 'greyDeep' | 'dark' | 'black'
  | 'tire' | 'glass' | 'chrome' | 'steel' | 'rim' | 'lamp' | 'beacon' | 'red' | 'warn' | 'drum' | 'cabin'
  // orugas y celosía (fase 6)
  | 'lattice' | 'latticeDiag' | 'latticeFoot' | 'mast' | 'pendant' | 'roller' | 'idler' | 'undercarriage';

/** Oscurece o aclara un color hexadecimal (shade() de la referencia). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Colores fijos (iguales para todas las grúas) */
const FIXED: Partial<Record<MatKey, string>> = {
  grey: '#9aa0a6', greyDark: '#7c838a', greyDeep: '#5d646b', dark: '#3a3f45', black: '#1d2125',
  tire: '#17191c', glass: '#3f6a85', chrome: '#c9ced3', steel: '#8a929b', red: '#c0392b', warn: '#f2b632',
  drum: '#5a4a3a', cabin: '#d8962a',
  // colores de la referencia para la celosía, el caballete y el tren de rodaje
  lattice: '#e3a52a', latticeDiag: '#d39a28', latticeFoot: '#d0951f', mast: '#7d858f', pendant: '#c9cdd2',
  roller: '#454b52', idler: '#30353b', undercarriage: '#2f353d',
};
const EMISSIVE: Partial<Record<MatKey, [string, string]>> = {
  lamp: ['#f3ecd0', '#6b6440'],
  beacon: ['#e67e22', '#7a3c00'],
};

/**
 * Fase 16: material estándar (metal y rugosidad) en calidad alta, en vez de Lambert. Se elige una vez al arrancar
 * (cambiar la calidad recarga la página), antes de crear la escena y los modelos.
 */
let standard = false;
export function useStandard(on: boolean) { standard = on; }
export function isStandard() { return standard; }

/** Material iluminado (Lambert o estándar según la calidad): todo lo de la escena que no es especial */
export type LitMat = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
export function lit(p: THREE.MeshStandardMaterialParameters = {}): LitMat {
  if (standard) return new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...p });
  const { roughness: _r, metalness: _m, ...rest } = p;
  return new THREE.MeshLambertMaterial(rest as THREE.MeshLambertMaterialParameters);
}

/** [rugosidad, metal] de cada clave (solo con el material estándar; aproximación visual) */
export function surface(k: MatKey): [number, number] {
  switch (k) {
    case 'chrome': case 'pendant': return [0.22, 0.9];
    case 'steel': case 'mast': return [0.38, 0.7];
    case 'rim': return [0.4, 0.55];
    case 'tire': case 'black': case 'roller': case 'idler': case 'undercarriage': return [0.92, 0];
    case 'dark': case 'drum': return [0.7, 0.15];
    case 'glass': return [0.08, 0.3];
    case 'grey': case 'greyDark': case 'greyDeep': return [0.55, 0.25];
    default: return [0.42, 0.12]; // pintura de la grúa
  }
}

const cache = new Map<string, LitMat>();
function mat(color: string, emissive?: string, k?: MatKey) {
  const key = color + (emissive ?? '') + (k === 'glass' ? 'g' : '');
  let m = cache.get(key);
  if (!m) {
    const [roughness, metalness] = surface(k ?? 'yellow');
    m = lit({ color, emissive: emissive ?? '#000000', roughness, metalness });
    cache.set(key, m);
  }
  return m;
}

/**
 * Material de los colores lisos fusionados (`Parts.build`): el color va en cada vértice (el de la paleta, en espacio
 * lineal, con la oclusión ambiental). Con el material estándar, la rugosidad y el metal también van por vértice
 * (atributo `rm`), así cada grupo sigue siendo una sola malla.
 */
let vcMat: LitMat | null = null;
export function vcMaterial(): LitMat {
  if (vcMat && (vcMat instanceof THREE.MeshStandardMaterial) === standard) return vcMat;
  if (!standard) return (vcMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 rm;\nvarying vec2 vRM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvRM = rm;');
    sh.fragmentShader = 'varying vec2 vRM;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vRM.y;');
  };
  m.customProgramCacheKey = () => 'vc-rm';
  return (vcMat = m);
}

export type Palette = Record<MatKey, LitMat>;

/** Colores de la grúa: el amarillo y la llanta salen de los datos (color, rim); lo demás es fijo. */
export function colorOf(T: CraneSpec, k: MatKey): string {
  switch (k) {
    case 'yellow': return T.color;
    case 'yellowDark': return shade(T.color, 0.88);
    case 'yellowShade': return shade(T.color, 0.8);
    // cabina del operador: casi el amarillo de la grúa (fase 8B; antes naranja fijo). Material propio porque la RT
    // oculta su cabina en la vista de cabina buscando este material.
    case 'cabin': return shade(T.color, 0.94);
    // llantas grises como en las imágenes (fase 8B); la RT conserva las oscuras de la referencia
    case 'rim': return T.rt ? T.rim! : T.rim && T.rim !== '#f0be22' ? T.rim : '#b9bfc5';
    default: return FIXED[k] ?? EMISSIVE[k]![0];
  }
}

export function palette(T: CraneSpec): Palette {
  const out = {} as Palette;
  const keys: MatKey[] = ['yellow', 'yellowDark', 'yellowShade', 'grey', 'greyDark', 'greyDeep', 'dark', 'black',
    'tire', 'glass', 'chrome', 'steel', 'rim', 'lamp', 'beacon', 'red', 'warn', 'drum', 'cabin',
    'lattice', 'latticeDiag', 'latticeFoot', 'mast', 'pendant', 'roller', 'idler', 'undercarriage'];
  for (const k of keys) {
    const e = EMISSIVE[k];
    out[k] = e ? mat(e[0], e[1], k) : mat(colorOf(T, k), undefined, k);
  }
  return out;
}
