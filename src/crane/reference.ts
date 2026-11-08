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
