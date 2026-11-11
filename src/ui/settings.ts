// Ajustes del jugador (fase 11): calidad gráfica y sonido. Se guardan en localStorage; ?calidad=bajo|medio|alto en
// la URL manda sobre lo guardado (para comparar). Sin three.js, para poder probarlo.

export type Quality = 'bajo' | 'medio' | 'alto';
export const QUALITIES: Quality[] = ['bajo', 'medio', 'alto'];

export interface QualitySpec {
  /** antialias del renderer (no se puede cambiar en marcha: cambiar la calidad recarga la página) */
  antialias: boolean;
  /** tope de la escala de píxel (devicePixelRatio se recorta a esto) */
  prMax: number;
  /** escala de píxel mínima: en bajo se dibuja por debajo de la resolución de la pantalla */
  prScale: number;
  /** sombras; 0 = sin sombras */
  shadowMap: number;
}

/** alto = lo de siempre (60 fps en la laptop de Jesús); medio y bajo para equipos más justos. */
export const QUALITY: Record<Quality, QualitySpec> = {
  alto: { antialias: true, prMax: 1.5, prScale: 1, shadowMap: 2048 },
  medio: { antialias: true, prMax: 1, prScale: 1, shadowMap: 1024 },
  bajo: { antialias: false, prMax: 1, prScale: 0.75, shadowMap: 0 },
};

export interface Settings {
  calidad: Quality;
  /** sonido encendido (tecla N) */
  sonido: boolean;
  /** volumen 0…1 */
  volumen: number;
}

const STORE = 'gruas-ajustes';
export const DEFAULTS: Settings = { calidad: 'alto', sonido: true, volumen: 0.6 };

function isQuality(v: unknown): v is Quality {
  return typeof v === 'string' && (QUALITIES as string[]).includes(v);
}

/** Ajustes guardados (los que falten o estén mal, por defecto) y ?calidad= de la URL. */
export function loadSettings(search = typeof location !== 'undefined' ? location.search : '', raw?: string | null): Settings {
  let saved: Partial<Settings> = {};
  try {
    const txt = raw !== undefined ? raw : localStorage.getItem(STORE);
    saved = JSON.parse(txt || '{}') || {};
  } catch { /* sin almacenamiento o dañado: por defecto */ }
  const s: Settings = {
    calidad: isQuality(saved.calidad) ? saved.calidad : DEFAULTS.calidad,
    sonido: typeof saved.sonido === 'boolean' ? saved.sonido : DEFAULTS.sonido,
    volumen: typeof saved.volumen === 'number' && saved.volumen >= 0 && saved.volumen <= 1 ? saved.volumen : DEFAULTS.volumen,
  };
  const q = new URLSearchParams(search).get('calidad');
  if (isQuality(q)) s.calidad = q;
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Escala de píxel para una calidad (prOverride = ?pr= de la URL). */
export function pixelRatio(q: Quality, dpr: number, prOverride?: number) {
  if (prOverride) return prOverride;
  const Q = QUALITY[q];
  return Math.min(dpr, Q.prMax) * Q.prScale;
}
