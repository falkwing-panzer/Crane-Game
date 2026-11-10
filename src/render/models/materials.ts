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

const cache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string, emissive?: string) {
  const k = color + (emissive ?? '');
  let m = cache.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: emissive ?? '#000000' });
    cache.set(k, m);
  }
  return m;
}

export type Palette = Record<MatKey, THREE.MeshLambertMaterial>;

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
    out[k] = e ? mat(e[0], e[1]) : mat(colorOf(T, k));
  }
  return out;
}
