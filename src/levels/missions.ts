import type { Level, LevelBox, LevelCrate } from './levels';

// Misiones completas (fase 24, parte A). Aproximación del juego (la referencia no las tiene):
// 18. De la base a la obra: conducir por una carretera con un puente limitado por eje (12 t por eje: valor del juego
//     a confirmar con Jesús), un río que no se puede vadear, un cable bajo y coches aparcados; después, el izaje.
// 19. Camiones con horario: dos muelles; cada camión entra a su hora si su muelle está libre (si no, espera y el
//     retraso cuenta); hay que descargarlos y dejar cada carga en una zona.
// 20. Montaje con grúa auxiliar: una AT 60 descarga el lastre de la AT 300-6 del camión y lo deja junto a ella;
//     hasta que está todo, la AT 300-6 no puede montarlo (B). Después, la AT 300-6 iza el generador.

const B = (x: number, z: number, w: number, d: number, h: number, kind: LevelBox['kind'] = 'building'): LevelBox => ({ x, z, w, d, h, kind });
const CT = (x: number, z: number, m: number, label: string, color = '#3d6f8f'): LevelCrate =>
  ({ x, z, w: 6.1, d: 2.44, h: 2.6, m, label, color, kind: 'container' });

/** Límite por eje del puente del nivel 18 (t): valor del juego (sin dato de la referencia) */
export const BRIDGE_AXLE = 12;

export const ROAD_MISSION: Level = {
  name: 'De la base a la obra', type: 'Misión', par: 780, wind: [2, 1.5, 200], ground: '#3a3c3f',
  size: [200, 66],
  cranes: ['small', 'medium'], rec: 'medium',
  why: { large: 'Demasiado ancha para esta carretera', xl: 'Demasiado ancha para esta carretera', at300: 'Demasiado ancha para esta carretera', at450: 'Demasiado ancha para esta carretera', at650: 'Demasiado ancha para esta carretera', rt: 'No puede circular por carretera', crawler: 'No puede circular por carretera', lr: 'No puede circular por carretera', sk: 'No hace falta una grúa torre' },
  start: { x: 8, z: 12, h: 0 },
  brief: 'Sal de la base con la grúa plegada, llega a la obra del este y deja el módulo en su zona. El puente admite 12 t por eje: la AT 60 pesa más y tiene que dar la vuelta por el sur, por donde termina el río. Más adelante cruza un cable bajo: pasa con la pluma recogida y bajada.',
  tips: ['Conduce con las flechas; la carga por eje sale en la ficha de la grúa (City 25 ~10,9 t, AT 60 ~15 t).',
    'El agua no se puede cruzar: el río solo tiene el puente.', 'Con la pluma levantada, el cable bajo la toca.',
    'En la obra: estabilizadores ({outriggers}), engancha, iza y deja el módulo en la zona.'],
  boxes: [
    B(76, 12, 12, 16, 0.2, 'pier'),
    B(40, 3, 10, 4, 3, 'shelter'), B(91, 30, 1.8, 4.5, 1.5, 'cab'), B(112, 9, 4.5, 1.8, 1.5, 'cab'),
    B(130, 30, 12, 10, 8), B(155, 4, 10, 6, 6, 'container'), B(196, 52, 6, 6, 4, 'tank'),
  ],
  crates: [{ x: 168, z: 26, w: 3, d: 2.4, h: 2.4, m: 5, label: 'MÓDULO', color: '#5b7a5e', kind: 'crate' }],
  zones: [{ x: 184, z: 40, w: 7, d: 6, y: 0, label: 'OBRA' }],
  soft: [{ x: 76, z: 2, w: 12, d: 4, kind: 'water' }, { x: 76, z: 34, w: 12, d: 28, kind: 'water' }],
  lines: [{ a: [122, 0], b: [122, 66], y: 6.5, kv: 'telefonía', clear: 0.8, poles: [2, 33, 64] }],
  bridges: [{ x: 76, z: 12, w: 12, d: 16, maxAxle: BRIDGE_AXLE }],
  env: 'field', seed: 18018,
};

export const TRUCKS_MISSION: Level = {
  name: 'Camiones con horario', type: 'Misión', par: 540, wind: [2, 2, 90], ground: '#3a3c3f',
  cranes: ['large', 'at300'], rec: 'large',
  why: { small: 'Capacidad insuficiente para 8 t', medium: 'Capacidad insuficiente a 21 m', rt: 'Demasiado lenta para descargar', crawler: 'No cabe en el patio', lr: 'Demasiado grande para este patio', sk: 'Capacidad insuficiente', xl: 'Demasiado grande para este patio', at450: 'Demasiado grande para este patio', at650: 'Demasiado grande para este patio' },
  start: { x: 30, z: 28, h: 0 },
  brief: 'Llegan cuatro camiones con contenedores a los dos muelles del oeste. Cada camión entra a su hora si su muelle está libre; si no, espera en la calle y el retraso cuenta. Descarga cada contenedor en una de las zonas del patio.',
  tips: ['Los camiones 3 y 4 llegan a los 2:30 y a los 3:30: vacía antes su muelle.', 'Más de 20 s de retraso en total cuesta la estrella de las faltas.',
    'Saca los estabilizadores ({outriggers}) y trabaja sin mover la grúa.'],
  boxes: [B(16, 12, 9, 2.6, 1.4, 'bed'), B(22.1, 12, 3, 2.6, 3.2, 'cab'), B(16, 44, 9, 2.6, 1.4, 'bed'), B(22.1, 44, 3, 2.6, 3.2, 'cab'),
    B(76, 6, 10, 6, 5, 'shelter'), B(78, 50, 8, 6, 3, 'container')],
  crates: [CT(16, 12, 6, 'C-1'), CT(16, 44, 7, 'C-2', '#8f3d3d'), CT(-14, 12, 5, 'C-3', '#3d8f5a'), CT(-14, 44, 8, 'C-4', '#8f7a3d')],
  zones: [{ x: 58, z: 10, w: 8, d: 5, y: 0, label: 'A' }, { x: 58, z: 46, w: 8, d: 5, y: 0, label: 'B' },
    { x: 64, z: 28, w: 8, d: 5, y: 0, label: 'C' }, { x: 40, z: 48, w: 8, d: 5, y: 0, label: 'D' }],
  trucks: [{ at: 0, bay: 0, crate: 0 }, { at: 0, bay: 1, crate: 1 }, { at: 150, bay: 0, crate: 2 }, { at: 210, bay: 1, crate: 3 }],
  bays: [{ x: 16, z: 12, y: 1.4 }, { x: 16, z: 44, y: 1.4 }],
  env: 'logistics', seed: 19019,
};

export const AUX_MISSION: Level = {
  name: 'Montaje con grúa auxiliar', type: 'Misión', par: 900, wind: [1.5, 1.5, 0], ground: '#3a3c3f',
  cranes: ['at300'], rec: 'at300', why: {},
  start: { x: 50, z: 30, h: 0 },
  crew: [{ id: 'at300', x: 50, z: 30, h: 0, out: true }, { id: 'medium', x: 18, z: 30, h: Math.PI / 2, out: false }],
  brief: 'El lastre de la AT 300-6 llegó en un camión. Con la AT 60 (Tab cambia de grúa) descárgalo y déjalo en la zona LASTRE, detrás de la AT 300-6. Con el lastre en su sitio, móntalo en la AT 300-6 ({ballast}) y lleva el generador a su bancada.',
  tips: ['En el juego llegan 4 placas de 9 t (aproximación: el lastre completo de la AT 300-6 son 86 t).',
    'Hasta que las 4 placas estén en la zona LASTRE, la AT 300-6 no puede montar el lastre.',
    'El generador pesa 30 t: sin lastre, la AT 300-6 no lo levanta a ese radio.'],
  boxes: [B(30, 8, 12, 2.6, 1.4, 'bed'), B(37.6, 8, 3, 2.6, 3.2, 'cab'), B(76, 50, 6, 5, 1.2, 'pad'), B(8, 8, 8, 6, 3, 'shelter')],
  crates: [
    ...[0, 1, 2, 3].map((i): LevelCrate => ({ x: 25.5 + i * 3, z: 8, w: 2.4, d: 1.6, h: 0.9, m: 9, label: `LASTRE ${i + 1}`, color: '#7a8088', kind: 'ballast' })),
    { x: 66, z: 12, w: 3.2, d: 2.2, h: 2.6, m: 30, label: 'GENERADOR', color: '#5b7a5e', kind: 'crate' },
  ],
  zones: [{ x: 35, z: 30, w: 6, d: 8, y: 0, label: 'LASTRE' }, { x: 76, z: 50, w: 6, d: 5, y: 1.2, label: 'BANCADA' }],
  ballastZone: 'LASTRE',
  env: 'industrial', seed: 20020,
};

export const MISSION_LEVELS: Level[] = [ROAD_MISSION, TRUCKS_MISSION, AUX_MISSION];
