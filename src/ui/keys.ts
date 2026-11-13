import { t } from '../i18n';

// Teclas configurables (fase 14). Sin DOM: la tabla, cómo se guarda y cómo se nombra cada tecla se prueban sueltas.
// Las teclas se guardan por `KeyboardEvent.code` (posición física: la W es la W también en un teclado AZERTY).
// Mayús, Ctrl y Alt valen igual a la izquierda que a la derecha (`normCode`).

/** Mandos que se mantienen pulsados */
export const HOLD = ['fw', 'bk', 'stl', 'str', 'sll', 'slr', 'lu', 'ld', 'ti', 'to', 'hu', 'hd', 'ju', 'jd', 'sli', 'slo', 'fine'] as const;
/** Acciones de un toque */
export const TAP = ['hook', 'outriggers', 'ballast', 'yguy', 'mount', 'view', 'switch', 'reset', 'bypass', 'mute', 'help'] as const;
export type HoldAction = (typeof HOLD)[number];
export type TapAction = (typeof TAP)[number];
export type Action = HoldAction | TapAction;
export type KeyMap = Record<Action, string>;

/** La tabla de siempre (la de la referencia más las teclas que se añadieron después) */
export const DEFAULT_KEYS: Readonly<KeyMap> = Object.freeze({
  fw: 'ArrowUp', bk: 'ArrowDown', stl: 'ArrowLeft', str: 'ArrowRight',
  sll: 'KeyA', slr: 'KeyD', lu: 'KeyW', ld: 'KeyS', ti: 'KeyQ', to: 'KeyE', hu: 'KeyR', hd: 'KeyF',
  ju: 'KeyT', jd: 'KeyG', sli: 'KeyK', slo: 'KeyL', fine: 'Shift',
  hook: 'Space', outriggers: 'KeyO', ballast: 'KeyB', yguy: 'KeyY', mount: 'KeyM', view: 'KeyV', switch: 'Tab',
  reset: 'KeyX', bypass: 'KeyP', mute: 'KeyN', help: 'KeyH',
});

export const ACTIONS = [...HOLD, ...TAP] as Action[];

/** Esc no se puede asignar: cierra la ayuda y cancela el cambio de una tecla */
export const RESERVED = new Set(['Escape']);

/** Mayús, Ctrl, Alt y Meta: la izquierda y la derecha cuentan como la misma tecla */
export function normCode(code: string) {
  return code.replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$1');
}

const STORE = 'gruas-teclas';

/**
 * Lee la tabla de una cadena guardada. Lo que falte o no valga (tecla repetida, reservada o vacía) vuelve a su tecla
 * por defecto, siempre que esa no la use ya otra acción; si no, se queda sin tecla ('').
 */
export function parseKeys(raw: string | null): KeyMap {
  let saved: Partial<Record<string, unknown>> = {};
  try { saved = raw ? (JSON.parse(raw) ?? {}) : {}; } catch { saved = {}; }
  const out = {} as KeyMap, used = new Set<string>();
  for (const a of ACTIONS) {
    const v = saved[a];
    const code = typeof v === 'string' ? normCode(v) : '';
    if (code && !RESERVED.has(code) && !used.has(code)) { out[a] = code; used.add(code); } else out[a] = '';
  }
  for (const a of ACTIONS) if (!out[a] && !used.has(DEFAULT_KEYS[a])) { out[a] = DEFAULT_KEYS[a]; used.add(DEFAULT_KEYS[a]); }
  return out;
}

export function loadKeys(): KeyMap {
  try { return parseKeys(localStorage.getItem(STORE)); } catch { return { ...DEFAULT_KEYS }; }
}

/** Guarda solo lo que cambia respecto de la tabla por defecto */
export function saveKeys(k: KeyMap) {
  const diff: Partial<KeyMap> = {};
  for (const a of ACTIONS) if (k[a] !== DEFAULT_KEYS[a]) diff[a] = k[a];
  try {
    if (Object.keys(diff).length) localStorage.setItem(STORE, JSON.stringify(diff));
    else localStorage.removeItem(STORE);
  } catch { /* sin almacenamiento: vale para esta visita */ }
}

/**
 * Asigna una tecla a una acción. Si otra acción la tenía, se intercambian (la otra se queda con la tecla anterior):
 * así nunca hay dos acciones en la misma tecla ni una se queda sin ella. Devuelve la tabla nueva y la acción que
 * cambió también (o null).
 */
export function rebind(k: KeyMap, action: Action, code: string): { keys: KeyMap; swapped: Action | null } {
  code = normCode(code);
  if (RESERVED.has(code)) return { keys: k, swapped: null };
  const keys = { ...k };
  const other = ACTIONS.find((a) => a !== action && keys[a] === code) ?? null;
  if (other) keys[other] = keys[action];
  keys[action] = code;
  return { keys, swapped: other };
}

/** Acción de cada tecla */
export function codeIndex(k: KeyMap): Map<string, Action> {
  const m = new Map<string, Action>();
  for (const a of ACTIONS) if (k[a]) m.set(k[a], a);
  return m;
}

/**
 * Nombre de una tecla para mostrar. Las letras y los números como tales; los signos, como en un teclado español
 * (`code` es la posición, no el carácter).
 */
export function keyLabel(code: string) {
  if (!code) return t.keys.none;
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1];
  const np = /^Numpad(.+)$/.exec(code);
  if (np) return t.keys.numpad(np[1]);
  return t.keys.names[code] ?? code;
}

/** Tabla en uso (la pone `Input`); la usan los textos con {acción} */
let current: KeyMap = { ...DEFAULT_KEYS };
export const activeKeys = () => current;
export function useKeys(k: KeyMap) { current = k; }

const ACTION_SET = new Set<string>(ACTIONS);

/** Cambia cada {acción} de un texto por el nombre de su tecla (las llaves que no son acciones se dejan) */
export function withKeys(text: string, k: KeyMap = current) {
  return text.replace(/\{(\w+)\}/g, (all, a: string) => (ACTION_SET.has(a) ? keyLabel(k[a as Action]) : all));
}
