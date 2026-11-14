// Fase 17: hacia dónde apunta la manga de viento (sin three.js). El viento del nivel empuja hacia
// (cos a, sin a) en x y z del mundo (`windForce` de levels/rules.ts, a = dirección en grados): la manga apunta
// hacia ahí, a sotavento. Las piezas animadas tienen su eje largo en +x local; un giro r alrededor de la vertical
// lleva +x a (cos r, −sin r), así que r = −a.

/** Giro alrededor de la vertical de una manga o bandera para el viento de dirección `deg` (°) */
export const windYaw = (deg: number) => -(deg * Math.PI) / 180;

/** Caída de la manga (rad bajo la horizontal): colgando sin viento, horizontal desde ~8 m/s */
export const sockDroop = (v: number) => (1 - Math.min(1, Math.max(0, v) / 8)) * 1.3;
