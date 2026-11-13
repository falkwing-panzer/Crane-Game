import { isCrawler, type CraneSpec } from './cranes';
import type { CraneInput } from './kinematics';
import type { V3 } from './pose';
import { t } from '../i18n';

// Amarre del gancho al frente del chasis (posición de transporte; no está en la referencia, pedido de Jesús):
// con la pluma tumbada hacia delante, el motón se ata al gancho de remolque delantero para que no se balancee al
// conducir. Solo grúas de ruedas (las orugas y la grúa torre no tienen ese frente). Cotas en el marco del chasis;
// el gancho de remolque es el del dibujo (carrier.ts: x = L1 + 0,30…0,42, y = deckLo − 0,15…+0,05).

/**
 * ¿Se puede amarrar? El fondo del gancho a menos de 4 m en planta de la argolla y entre 1 m por debajo y 1,5 m por
 * encima de ella: la eslinga tira del motón hacia atrás (la RT 90 tiene la cabeza 3,4 m por delante del frente).
 */
export function tieReach(lug: V3, hookBottom: V3) {
  const dy = hookBottom.y - lug.y;
  return Math.hypot(lug.x - hookBottom.x, lug.z - hookBottom.z) <= 4 && dy >= -1 && dy <= 1.5;
}

export const canTie = (T: CraneSpec) => !isCrawler(T) && !T.tower;

/** Argolla de amarre: el gancho de remolque delantero */
export const tieLug = (T: CraneSpec): V3 => ({ x: T.len[1] + 0.36, y: T.deckLo - 0.05, z: 0 });

/**
 * Centro del gancho amarrado: delante del parachoques, con el fondo a la altura de la argolla. El motón se gira 90°
 * (su lado estrecho, 0,21·hb, mira al camión). hb = hookScale(T), halfH = medio alto del gancho.
 */
export const tiedHookCenter = (T: CraneSpec, hb: number, halfH: number): V3 =>
  ({ x: T.len[1] + 0.48 + 0.21 * hb, y: T.deckLo - 0.1 + halfH, z: 0 });

/** Con el gancho amarrado no se mueven pluma, giro, telescopio, cable ni plumín (conducir sí). */
export function blockWhileTied(inp: CraneInput): string | null {
  const tried = inp.slew || inp.luff || inp.tele || inp.hoist || inp.jib;
  inp.slew = inp.luff = inp.tele = inp.hoist = inp.jib = 0;
  return tried ? t.ops.tiedBlock : null;
}
