import type { CraneSpec } from './cranes';
import { craneMasses, type CraneConfig } from './stability';

/**
 * Carga por eje al circular (fase 24): la masa de la grúa con la pluma recogida (las masas de `craneMasses`, sin la
 * bandeja del superlift, que apoya en el suelo) repartida por igual entre sus ejes. Los datos son de la referencia;
 * el reparto por igual es una aproximación del juego (la referencia no trae cargas por eje). Orugas: null.
 */
export function axleLoad(T: CraneSpec, C: CraneConfig): number | null {
  if (T.crawler || !T.axles?.length) return null;
  const m = craneMasses(T, C, T.boom.min, 0, 0).reduce((a, p) => a + (p[3] ? 0 : p[0]), 0);
  return m / T.axles.length;
}
