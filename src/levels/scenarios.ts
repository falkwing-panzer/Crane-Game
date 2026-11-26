import type { Level, LevelBox, LevelCrate } from './levels';
import { WALK } from './people';

// Fase 27: escenarios nuevos con trabajos típicos de grúa. Medidas, pesos y horarios del juego (la referencia no los
// tiene; la fase pedía preguntarlos y Jesús pidió hacerlo sin esperar): están en CLAUDE.md para revisarlos.

const B = (x: number, z: number, w: number, d: number, h: number, kind: LevelBox['kind'] = 'building', color?: string): LevelBox =>
  ({ x, z, w, d, h, kind, ...(color ? { color } : {}) });
const CT = (x: number, z: number, m: number, label: string, color: string): LevelCrate =>
  ({ x, z, w: 6.1, d: 2.44, h: 2.6, m, label, color, kind: 'container' });

/** Ráfagas anunciadas cada `every` s desde `t0` (la carga grande espera a la calma entre ellas) */
const gusts = (t0: number, every: number, n: number, v: number, dur: number) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'gust' as const, t: t0 + i * every, v, dur }));

/**
 * 24. Aerogenerador en una loma: dos tramos de torre de 15 m, la góndola encima y el rotor (buje y tres palas) al
 * premontaje en el suelo. Entre ráfagas hay calma: con más de WIND_LIMIT m/s no se puede llevar colgada la góndola, el
 * buje ni una pala (mucha superficie).
 */
export const WIND_FARM: Level = {
  name: 'Aerogenerador en la loma', type: 'Escenario', par: 1500, wind: [5, 2, 250], ground: '#4b5240',
  cranes: ['at450', 'at650', 'lr'], rec: 'at450',
  why: { small: 'No llega a la góndola', medium: 'No llega a la góndola', large: 'Capacidad insuficiente a esa altura', rt: 'No llega a la góndola', xl: 'No llega a la altura de la góndola con esa carga', at300: 'Capacidad insuficiente a esa altura', sk: 'Capacidad insuficiente', crawler: 'No llega a la góndola' },
  start: { x: 50, z: 52, h: 0 },
  size: [100, 80],
  brief: 'Monta el aerogenerador sobre su cimentación: los dos tramos de torre uno encima del otro y la góndola arriba. Después lleva el buje y las tres palas a la zona de premontaje del rotor. Arriba de la loma sopla: la góndola, el buje y las palas solo se pueden izar en calma.',
  tips: ['Monta el lastre ({ballast}) antes de empezar. Los tramos se apilan centrados sobre la cimentación.',
    'El anemómetro anuncia cada ráfaga 10 s antes: con la góndola, el buje o una pala colgando y más de 10 m/s de viento, el trabajo se para (falla).',
    'Las palas son largas y livianas: van con balancín; oriéntalas con las cuerdas guía ({tgl} / {tgr}).'],
  boxes: [B(46, 32, 7, 7, 1, 'pad'), B(24, 62, 26, 2.4, 1, 'bed'), B(24, 66, 26, 2.4, 1, 'bed'), B(24, 70, 26, 2.4, 1, 'bed'),
    B(86, 70, 8, 4, 3, 'shelter'), B(84, 12, 6, 3, 2.6, 'container')],
  crates: [
    { x: 66, z: 36, w: 4.2, d: 4.2, h: 15, m: 42, label: 'TORRE 1', color: '#e8ecef', kind: 'wtower' },
    { x: 66, z: 44, w: 4.2, d: 4.2, h: 15, m: 36, label: 'TORRE 2', color: '#e8ecef', kind: 'wtower' },
    { x: 64, z: 64, w: 8, d: 3.6, h: 3.6, m: 40, label: 'GÓNDOLA', color: '#eef1f3', kind: 'nacelle' },
    { x: 36, z: 36, w: 3.6, d: 3.6, h: 3.4, m: 18, label: 'BUJE', color: '#d9dee2', kind: 'hub' },
    ...[62, 66, 70].map((z, i) => ({ x: 24, z, w: 28, d: 2, h: 1.2, m: 6, label: `PALA ${i + 1}`, color: '#f2f4f5', kind: 'blade' })),
  ],
  zones: [
    { x: 46, z: 32, w: 5.2, d: 5.2, y: 1, label: 'TRAMO 1', stack: 0 },
    { x: 46, z: 32, w: 5.2, d: 5.2, y: 16, label: 'TRAMO 2', stack: 1 },
    { x: 46, z: 32, w: 9, d: 5, y: 31, label: 'GÓNDOLA', stack: 2 },
    { x: 24, z: 44, w: 34, d: 12, y: 0, label: 'PREMONTAJE' },
  ],
  events: gusts(150, 240, 8, 7, 70),
  windLimit: { v: 10, kinds: ['nacelle', 'hub', 'blade'] },
  ridge: true,
  env: 'field', seed: 24024,
};

/** 25. Puerto de noche: descargar los contenedores de un barco atracado al muelle */
export const SHIP: Level = {
  name: 'Descarga nocturna', type: 'Escenario', par: 900, wind: [3, 2, 200], ground: '#3d3f43',
  cranes: ['xl', 'at450', 'at650'], rec: 'xl',
  why: { small: 'No llega al barco', medium: 'No llega al barco', large: 'Capacidad insuficiente a ese radio', rt: 'No llega al barco', at300: 'Capacidad insuficiente a ese radio', sk: 'Capacidad insuficiente', crawler: 'No se puede trasladar por el muelle (aproximación del juego)', lr: 'Demasiado grande para este muelle' },
  start: { x: 45, z: 22, h: 0 },
  size: [100, 70],
  brief: 'Un barco de carga general atracó de noche con cuatro contenedores en cubierta. Descárgalos a la zona del muelle con la luz de los focos. El borde del muelle es el límite: la grúa no puede salir al agua.',
  tips: ['Monta el lastre ({ballast}) y el Y-guy ({yguy}). Los contenedores van con balancín: oriéntalos con las cuerdas guía ({tgl} / {tgr}) antes de dejarlos.',
    'Con poca luz, la cámara del gancho (V) ayuda a ver la cubierta.', 'El barco está quieto (aproximación del juego): no hay oleaje.'],
  boxes: [B(45, 52, 64, 12, 3, 'pier', '#2f3a48'), B(13, 52, 4, 9, 6, 'pier', '#2f3a48'), B(80, 49, 6, 6, 9, 'building', '#e7e3d8'),
    B(8, 8, 12.2, 2.5, 5.2, 'container', '#4f7a4a'), B(90, 8, 12.2, 2.5, 2.6, 'container', '#8a6a2a')],
  crates: [CT(30, 50, 18, 'MSCU-11', '#3d7ea6'), CT(40, 54, 22, 'TGHU-12', '#a8473a'), CT(52, 50, 26, 'CMAU-13', '#6b8f3d'), CT(62, 54, 20, 'HLXU-14', '#c48a2a')],
  zones: [0, 1, 2, 3].map((i) => ({ x: 58 + (i % 2) * 8, z: 7 + Math.floor(i / 2) * 5, w: 7.2, d: 3.6, y: 0, label: `MUELLE ${i + 1}` })),
  soft: [{ x: 50, z: 55, w: 100, d: 30, kind: 'water' }],
  light: 'noche',
  lamps: [[20, 14, 14], [70, 14, 14], [45, 40, 12]],
  env: 'port', seed: 25025,
};

/** 26. Ciudad al atardecer: subir una enfriadora a una azotea entre edificios, con señalero */
export const ROOFTOP: Level = {
  name: 'Enfriadora en la azotea', type: 'Escenario', par: 600, wind: [3, 2.5, 90], ground: '#36383c',
  cranes: ['large', 'at300'], rec: 'large',
  why: { small: 'No llega a la azotea', medium: 'No llega a la azotea', rt: 'No puede circular por la ciudad', xl: 'No cabe en la calle', at450: 'No cabe en la calle', at650: 'No cabe en la calle', crawler: 'No puede circular por la ciudad', lr: 'No cabe en la calle', sk: 'Capacidad insuficiente' },
  start: { x: 38, z: 33, h: 0 },
  brief: 'Hay que subir una enfriadora de 12 t a la azotea de +26 m entre los edificios de la avenida, al atardecer. El señalero está arriba y te guía por radio; en la acera hay gente.',
  tips: ['Monta el lastre ({ballast}) y saca los estabilizadores: la calle da justo para ellos.', 'Antes de izar, la lista de chequeo ({checklist}).', 'No pases la carga por encima de la acera mientras haya gente.'],
  boxes: [B(42, 12, 36, 24, 26), B(42, 10, 0.3, 0.3, 27.2, 'pole'), B(12, 10, 20, 20, 18), B(74, 10, 20, 20, 32),
    B(42, 50, 84, 10, 14), B(58, 33, 9, 2.5, 1.4, 'bed'), B(64.1, 33, 3, 2.5, 3.2, 'cab')],
  crates: [{ x: 58, z: 33, w: 4, d: 2.2, h: 2.4, m: 12, label: 'ENFRIADORA', color: '#8b98a5', kind: 'hvac' }],
  zones: [{ x: 46, z: 6, w: 6, d: 5, y: 26, label: 'AZOTEA' }],
  rigger: { x: 52, z: 9, y: 26 },
  checklist: true,
  workers: [
    { pts: [[4, 27], [30, 27]], speed: WALK, wait: 4 },
    { pts: [[80, 41], [56, 41]], speed: WALK * 0.9, wait: 6, phase: 8 },
  ],
  light: 'atardecer',
  lamps: [[26, 33, 8], [66, 39, 8]],
  env: 'urban', seed: 26026,
};

export const SCENARIO_LEVELS: Level[] = [WIND_FARM, SHIP, ROOFTOP];
