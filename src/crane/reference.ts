// Arnés de pruebas: extrae de referencia/crane-v20.html el bloque de datos y funciones de estabilidad
// (desde `const D` hasta el final de `ratedCap`) y lo ejecuta en Node. Así las pruebas comparan contra
// el código original, no contra una copia. Solo para vitest: no se importa desde el juego.
import raw from '../../referencia/crane-v20.html?raw';

type Any = any;

export interface Reference {
  CRANES: Record<string, Any>;
  KF: Record<string, number>;
  yNoGuy(Lb: number): number;
  reach(T: Any, Lb: number, ang: number): number;
  structCap(T: Any, Lb: number): number;
  supportRect(T: Any, md: string): Any;
  craneMasses(T: Any, Lb: number, ang: number, slew: number): number[][];
  tipUtil(T: Any, md: string, ms: number[][]): number;
  lmiStatic(T: Any, md: string, Lb: number, ang: number, slew: number, m: number): number;
  ratedCap(T: Any, md: string, Lb: number, ang: number, slew: number): number;
}

export function loadReference(): Reference {
  const html = raw.replace(/\r\n/g, '\n');
  const a = html.indexOf('const D = Math.PI / 180');
  const end = html.indexOf('function ratedCap(');
  const b = html.indexOf('\n}\n', end) + 2;
  if (a < 0 || end < 0 || b < end) throw new Error('No se encontró el bloque de estabilidad en la referencia');
  const code = html.slice(a, b);
  return new Function(`${code}\nreturn { CRANES, KF, yNoGuy, reach, structCap, supportRect, craneMasses, tipUtil, lmiStatic, ratedCap };`)();
}

export interface TowerReference {
  towerGeom(slew?: number): Any;
  pivotPos(slew?: number): { x: number; y: number; z: number };
  headPos(ang?: number, Lb?: number, slew?: number): { x: number; y: number; z: number };
  tipPos(ang?: number, Lb?: number, slew?: number): { x: number; y: number; z: number };
}

/**
 * Geometría de la grúa torre de la referencia (de `const lift` a `function mode()`: towerGeom, pivotPos, headPos,
 * tipPos), ejecutada con un estado `S` y una grúa `T` propios (en la referencia son variables globales).
 */
export function loadTowerReference(T: Any, S: Any): TowerReference {
  const html = raw.replace(/\r\n/g, '\n');
  const a = html.indexOf('const lift = ');
  const b = html.indexOf('function mode()');
  if (a < 0 || b < a) throw new Error('No se encontró la geometría de la torre en la referencia');
  const code = html.slice(a, b);
  return new Function('S', 'T', `const clamp = (v, a, b) => Math.max(a, Math.min(b, v));\n${code}\nreturn { towerGeom, pivotPos, headPos, tipPos };`)(S, T);
}

/** Niveles de la referencia (de `const B = ` al final de `LEVELS`), para compararlos con src/levels. */
export function loadLevelsReference(): Any[] {
  const html = raw.replace(/\r\n/g, '\n');
  const a = html.indexOf('const B = (x, z');
  const l = html.indexOf('const LEVELS = [');
  const b = html.indexOf('\n];\n', l) + 3;
  if (a < 0 || l < a || b < l) throw new Error('No se encontraron los niveles en la referencia');
  return new Function(`${html.slice(a, b)}\nreturn LEVELS;`)();
}

/** windAt (con el nivel L) y segSeg de la referencia, para comparar con src/levels/rules.ts. */
export function loadRulesReference(L: Any): { windAt(t: number): number; segSeg(p1: number[], q1: number[], p2: number[], q2: number[]): number } {
  const html = raw.replace(/\r\n/g, '\n');
  const cut = (from: string, to: string) => {
    const a = html.indexOf(from), b = html.indexOf(to, a);
    if (a < 0 || b < a) throw new Error(`No se encontró ${from} en la referencia`);
    return html.slice(a, b);
  };
  const code = cut('function windAt(', '// ---------- geometría') + cut('function segSeg(', '// ---------- física');
  return new Function('L', `const clamp = (v, a, b) => Math.max(a, Math.min(b, v));\n${code}\nreturn { windAt, segSeg };`)(L);
}
