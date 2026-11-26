// Progreso del jugador guardado en localStorage (fase 22): estadísticas, logros y la mejor suavidad de cada nivel.
// Claves aparte de `gruas-records` (fase 9), que no se toca: así los récords de la 1.0 siguen igual.
// Sin almacenamiento (Node, modo privado lleno) todo funciona y simplemente no se guarda.

const K_STATS = 'gruas-estadisticas', K_ACH = 'gruas-logros', K_SMOOTH = 'gruas-suavidad';

/**
 * Hay almacenamiento (en el navegador). En Node se mira `window` primero: leer `localStorage` sin más ya escribe un
 * aviso en la consola.
 */
export const hasStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function read<T>(key: string, fallback: T): T {
  try {
    if (!hasStorage()) return fallback;
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch { return fallback; }
}

function write(key: string, v: unknown) {
  try { if (hasStorage()) localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

/** Estadísticas acumuladas de todas las partidas */
export interface Stats {
  /** Toneladas izadas (la carga más pesada de cada izaje; en el tándem, la parte de esa grúa) */
  tons: number;
  /** Izajes (cargas despegadas y vueltas a apoyar o soltadas) */
  lifts: number;
  /** Izajes seguidos sin golpe ahora y la mejor racha */
  clean: number; bestClean: number;
  /** Segundos manejando cada grúa (por id de CRANES) */
  secs: Record<string, number>;
  /** Golpes (chasis, plumín, torre, carga de costado), vuelcos y aterrizajes duros */
  bumps: number; tips: number; hard: number;
  /** Metros conducidos y, de ellos, con el gancho amarrado */
  meters: number; tiedMeters: number;
  /** Niveles completados (cada vez) */
  levels: number;
  /** Carga más pesada en un gancho (t) */
  heaviest: number;
}

export const newStats = (): Stats => ({
  tons: 0, lifts: 0, clean: 0, bestClean: 0, secs: {}, bumps: 0, tips: 0, hard: 0, meters: 0, tiedMeters: 0, levels: 0, heaviest: 0,
});

/** Lo guardado, con los campos que falten (o rotos) a cero */
export function loadStats(): Stats {
  const s = read<Partial<Stats>>(K_STATS, {}), out = newStats();
  for (const k of Object.keys(out) as (keyof Stats)[]) {
    const v = s[k];
    if (k === 'secs') {
      if (v && typeof v === 'object') for (const [id, n] of Object.entries(v)) if (Number.isFinite(n)) out.secs[id] = n as number;
    } else if (Number.isFinite(v)) (out[k] as number) = v as number;
  }
  return out;
}

export const saveStats = (s: Stats) => write(K_STATS, s);

/** Logros conseguidos: id → fecha (ms) */
export const loadAchievements = (): Record<string, number> => {
  const v = read<Record<string, number>>(K_ACH, {});
  return v && typeof v === 'object' ? v : {};
};
export const saveAchievements = (a: Record<string, number>) => write(K_ACH, a);

/** Récords de los trabajos con obra propia (reto diario, contratos): clave → estrellas y tiempo */
export const loadJobRecords = (): Record<string, { stars: number; time: number }> => {
  const v = read<Record<string, { stars: number; time: number }>>('gruas-reto', {});
  return v && typeof v === 'object' ? v : {};
};

/** Guarda si mejora; devuelve si mejoró */
export function saveJobRecord(key: string, stars: number, time: number): boolean {
  const all = loadJobRecords(), old = all[key];
  const better = !old || stars > old.stars || time < old.time;
  all[key] = { stars: Math.max(stars, old?.stars ?? 0), time: Math.min(time, old?.time ?? Infinity) };
  write('gruas-reto', all);
  return better;
}

/** Mejor nota de suavidad (0–100) por índice de nivel */
export const loadSmooth = (): Record<number, number> => {
  const v = read<Record<number, number>>(K_SMOOTH, {});
  return v && typeof v === 'object' ? v : {};
};

/** Guarda la nota si mejora; devuelve si mejoró */
export function saveSmooth(li: number, score: number): boolean {
  const all = loadSmooth(), old = all[li];
  if (old !== undefined && old >= score) return false;
  all[li] = score;
  write(K_SMOOTH, all);
  return true;
}
