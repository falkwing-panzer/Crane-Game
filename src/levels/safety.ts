import type { Level, LevelBox } from './levels';
import { WALK } from './people';

// Niveles de la fase 23 (trabajar con gente en la obra): dos a ciegas y la cesta de personal. Aproximación del juego
// (la referencia no los tiene): obra de 84 × 56 m como los de la referencia, coordenadas igual (x a la derecha, z hacia
// abajo vistas desde arriba). Las grúas permitidas son las que el plan de izaje da por buenas desde donde empiezan
// (una prueba lo comprueba).

const B = (x: number, z: number, w: number, d: number, h: number, kind: LevelBox['kind'] = 'building'): LevelBox => ({ x, z, w, d, h, kind });

/** 15. La carga está delante, pero la azotea donde va queda detrás de un edificio más alto */
export const ROOF_BLIND: Level = {
  name: 'Azotea a ciegas', type: 'A ciegas', par: 420, wind: [2, 2, 40], ground: '#3a3c3f',
  cranes: ['large', 'at300', 'xl'], rec: 'large',
  why: { small: 'No llega por encima del edificio', medium: 'No llega por encima del edificio', rt: 'No llega por encima del edificio', crawler: 'No cabe en la calle', lr: 'Demasiado grande para esta obra', sk: 'No llega a la azotea', at450: 'Demasiado grande para esta calle', at650: 'Demasiado grande para esta calle' },
  start: { x: 26, z: 28, h: 0 },
  brief: 'Hay que subir una máquina de clima a la azotea del edificio de atrás. Desde la cabina no se ve la azotea: el edificio de delante la tapa. Guíate por el señalero, que está arriba, y por la cámara del gancho.',
  tips: ['Solo tienes la cámara de la cabina y la del gancho (V). Monta el lastre ({ballast}) y, si la grúa lo lleva, el Y-guy ({yguy}) antes de empezar.', 'El señalero te dice por radio hacia dónde girar, cuándo bajar y cuándo parar.',
    'Antes de izar, la lista de chequeo ({checklist}).', 'Hay gente trabajando junto a la carga: no pases la carga por encima.'],
  boxes: [B(43, 28, 6, 26, 18), B(57, 28, 14, 20, 10), B(74, 8, 10, 8, 6, 'shelter'), B(8, 6, 8, 6, 3, 'container')],
  crates: [{ x: 24, z: 44, w: 2.6, d: 1.8, h: 1.8, m: 5, label: 'CLIMA', color: '#a7b0b8', kind: 'crate' }],
  zones: [{ x: 57, z: 28, w: 6, d: 5, y: 10, label: 'AZOTEA' }],
  rigger: { x: 53, z: 22, y: 10 },
  blind: true, checklist: true,
  workers: [
    { pts: [[12, 52], [32, 52]], speed: WALK, wait: 5 },
    { pts: [[34, 40], [34, 52]], speed: WALK * 0.8, wait: 7, phase: 6 },
  ],
  env: 'urban', seed: 15015,
};

/** 16. La carga está en un patio cerrado detrás de una nave: no se ve desde la cabina */
export const YARD_BLIND: Level = {
  name: 'Patio interior', type: 'A ciegas', par: 420, wind: [1.5, 1.5, 300], ground: '#3a3c3f',
  cranes: ['large', 'at300', 'xl'], rec: 'at300',
  why: { small: 'No llega al patio', medium: 'No llega al patio', rt: 'No llega al patio', crawler: 'No cabe entre las naves', lr: 'Demasiado grande para esta obra', sk: 'Capacidad insuficiente para 8 t', at450: 'Demasiado grande para esta calle', at650: 'Demasiado grande para esta calle' },
  start: { x: 22, z: 28, h: 0 },
  brief: 'Un depósito de 8 t quedó en el patio interior, detrás de la nave. Sácalo por encima y déjalo en el camión de la calle. Desde la cabina no se ve el patio: el señalero está dentro y te guía por radio.',
  tips: ['Solo tienes la cámara de la cabina y la del gancho (V). Monta el lastre ({ballast}) y, si la grúa lo lleva, el Y-guy ({yguy}) antes de empezar.', 'El señalero habla por radio: gira, sube, baja, despacio, para.',
    'Antes de izar, la lista de chequeo ({checklist}).', 'En el patio hay operarios: espera a que se aparten antes de pasar la carga.'],
  boxes: [B(38, 28, 8, 34, 14), B(54, 18, 14, 0.4, 6, 'wall'), B(54, 38, 14, 0.4, 6, 'wall'), B(61, 28, 0.4, 20, 6, 'wall'),
    B(10, 50, 9, 2.5, 1.4, 'bed'), B(16.1, 50, 3, 2.5, 3.2, 'cab'), B(70, 48, 10, 8, 5, 'container')],
  crates: [{ x: 53, z: 28, w: 2.4, d: 2.4, h: 2.4, m: 8, label: 'DEPÓSITO', color: '#9aa3aa', kind: 'tank' }],
  zones: [{ x: 10, z: 50, w: 8, d: 3, y: 1.4, label: 'CAMIÓN' }],
  rigger: { x: 49, z: 22, y: 0 },
  blind: true, checklist: true,
  workers: [
    { pts: [[49, 21], [54, 21]], speed: WALK * 0.7, wait: 6 },
    { pts: [[58.5, 20.5], [58.5, 23]], speed: WALK * 0.6, wait: 9, phase: 3 },
  ],
  env: 'industrial', seed: 16016,
};

/** 17. Cesta de personal: subir a dos operarios a la plataforma de un depósito */
export const BASKET: Level = {
  name: 'Cesta de personal', type: 'Personas', par: 360, wind: [3, 2.5, 120], ground: '#3a3c3f',
  cranes: ['medium', 'large', 'at300'], rec: 'medium',
  why: { small: 'No llega a la plataforma', rt: 'Sin certificado para cesta (aproximación del juego)', crawler: 'Demasiado lenta para este trabajo', lr: 'Demasiado grande para esta obra', sk: 'Sin certificado para cesta (aproximación del juego)', xl: 'Demasiado grande para esta obra', at450: 'Demasiado grande para esta obra', at650: 'Demasiado grande para esta obra' },
  start: { x: 30, z: 30, h: 0 },
  brief: 'Dos operarios tienen que subir a la plataforma del depósito (18 m) para revisar una válvula. Con personas en la cesta todo va más despacio: no pases del 50 % de LMI, no la balancees y no subas con viento fuerte.',
  tips: ['Con la cesta enganchada la grúa va a media velocidad.', 'Falla si el LMI pasa del 50 %, si la cesta se balancea más de 5° o sube o baja a más de 0,6 m/s más de un segundo, o con viento de más de 9 m/s.',
    'Antes de izar, la lista de chequeo ({checklist}).', 'El señalero está al pie del depósito.'],
  boxes: [B(45, 27, 8, 8, 18, 'tank'), B(14, 10, 10, 6, 4, 'shelter'), B(72, 48, 8, 6, 3, 'container')],
  crates: [{ x: 40, z: 42, w: 1.6, d: 1.2, h: 1.2, m: 0.6, label: 'CESTA', color: '#e2c22a', kind: 'basket', people: 2 }],
  zones: [{ x: 45, z: 27, w: 5, d: 5, y: 18, label: 'PLATAFORMA' }],
  rigger: { x: 40, z: 34, y: 0 },
  checklist: true,
  workers: [{ pts: [[12, 46], [26, 52]], speed: WALK, wait: 6 }],
  env: 'refinery', seed: 17017,
};

export const SAFETY_LEVELS: Level[] = [ROOF_BLIND, YARD_BLIND, BASKET];
