import { describe, expect, it } from 'vitest';
import esSrc from '../i18n/es.ts?raw';
import { es } from '../i18n/es';
import { ACTIONS, DEFAULT_KEYS, HOLD, TAP, codeIndex, keyLabel, normCode, parseKeys, rebind, withKeys } from './keys';

// Fase 14: teclas configurables (guardadas en localStorage, la tabla de siempre por defecto) y textos en es.ts.
describe('teclas configurables', () => {
  it('la tabla por defecto es la de siempre y no repite teclas', () => {
    expect(DEFAULT_KEYS).toMatchObject({
      fw: 'ArrowUp', sll: 'KeyA', slr: 'KeyD', lu: 'KeyW', ld: 'KeyS', ti: 'KeyQ', to: 'KeyE', hu: 'KeyR', hd: 'KeyF',
      ju: 'KeyT', jd: 'KeyG', sli: 'KeyK', slo: 'KeyL', fine: 'Shift', hook: 'Space', outriggers: 'KeyO', ballast: 'KeyB',
      yguy: 'KeyY', mount: 'KeyM', view: 'KeyV', switch: 'Tab', reset: 'KeyX', bypass: 'KeyP', mute: 'KeyN', help: 'KeyH',
    });
    expect(ACTIONS.length).toBe(HOLD.length + TAP.length);
    expect(new Set(Object.values(DEFAULT_KEYS)).size).toBe(ACTIONS.length);
    expect(codeIndex(DEFAULT_KEYS).get('KeyO')).toBe('outriggers');
  });

  it('lo guardado se lee con cuidado: vacío, roto, repetido o Esc vuelven a la tecla por defecto', () => {
    expect(parseKeys(null)).toEqual(DEFAULT_KEYS);
    expect(parseKeys('no es json')).toEqual(DEFAULT_KEYS);
    expect(parseKeys('{"hook":"Escape"}')).toEqual(DEFAULT_KEYS);
    const k = parseKeys('{"outriggers":"KeyU","ballast":"KeyU","fw":"ShiftLeft","fine":7}');
    expect(k.outriggers).toBe('KeyU');
    expect(k.ballast).toBe('KeyB'); // repetida: la primera acción se la queda
    // la flecha arriba pasa a Shift; Shift (de fine) ya está ocupada y fine queda sin tecla
    expect(k.fw).toBe('Shift');
    expect(k.fine).toBe('');
    expect(new Set(Object.values(k).filter(Boolean)).size).toBe(Object.values(k).filter(Boolean).length);
  });

  it('asignar una tecla ocupada intercambia las dos acciones', () => {
    const r = rebind(DEFAULT_KEYS, 'hook', 'KeyO');
    expect(r.keys.hook).toBe('KeyO');
    expect(r.keys.outriggers).toBe('Space');
    expect(r.swapped).toBe('outriggers');
    expect(DEFAULT_KEYS.hook).toBe('Space'); // la tabla por defecto no cambia
    expect(rebind(DEFAULT_KEYS, 'hook', 'Escape').keys).toBe(DEFAULT_KEYS);
    expect(rebind(DEFAULT_KEYS, 'fine', 'ShiftRight').swapped).toBeNull();
  });

  it('Mayús, Ctrl y Alt de los dos lados son la misma tecla; nombres para mostrar', () => {
    expect(normCode('ShiftRight')).toBe('Shift');
    expect(normCode('ControlLeft')).toBe('Control');
    expect(normCode('KeyA')).toBe('KeyA');
    expect(['KeyA', 'Digit3', 'ArrowLeft', 'Space', 'Numpad5', 'Semicolon', ''].map(keyLabel)).toEqual(['A', '3', '←', 'Espacio', 'Num 5', 'ñ', '—']);
  });

  it('los textos con {acción} muestran la tecla en uso', () => {
    expect(withKeys('Recoge los estabilizadores ({outriggers})')).toBe('Recoge los estabilizadores (O)');
    const k = rebind(DEFAULT_KEYS, 'outriggers', 'KeyU').keys;
    expect(withKeys(es.ops.stowToDrive, k)).toBe('Recoge los estabilizadores para conducir (U)');
    expect(withKeys('{noesaccion}')).toBe('{noesaccion}');
  });
});

describe('textos (i18n/es.ts)', () => {
  it('cada {…} de los textos es una acción con tecla', () => {
    // sin las plantillas ${…} de JavaScript
    const tokens = [...esSrc.replace(/\$\{[^}]*\}/g, '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(20);
    for (const a of tokens) expect(ACTIONS, a).toContain(a);
  });

  it('no quedan teclas fijas entre paréntesis en los textos', () => {
    // "(O)", "(Espacio)"… deben ser {acción} para seguir a la tecla que elija el jugador
    expect(esSrc).not.toMatch(/\((?:[A-Z]|Espacio|Shift|Tab)\)/);
  });
});
