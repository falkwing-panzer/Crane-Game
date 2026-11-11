import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, pixelRatio, QUALITY } from './settings';

describe('ajustes (fase 11)', () => {
  it('por defecto: calidad alta, sonido encendido', () => {
    expect(loadSettings('', null)).toEqual(DEFAULTS);
    expect(loadSettings('', 'no es json')).toEqual(DEFAULTS);
  });

  it('lee lo guardado y descarta valores raros', () => {
    expect(loadSettings('', JSON.stringify({ calidad: 'bajo', sonido: false, volumen: 0.2 }))).toEqual({ calidad: 'bajo', sonido: false, volumen: 0.2 });
    expect(loadSettings('', JSON.stringify({ calidad: 'ultra', sonido: 'si', volumen: 3 }))).toEqual(DEFAULTS);
  });

  it('?calidad= manda sobre lo guardado', () => {
    expect(loadSettings('?calidad=medio', JSON.stringify({ calidad: 'bajo' })).calidad).toBe('medio');
    expect(loadSettings('?calidad=x', JSON.stringify({ calidad: 'bajo' })).calidad).toBe('bajo');
  });

  it('alto conserva lo de antes; bajo sin sombras ni antialias', () => {
    expect(QUALITY.alto).toEqual({ antialias: true, prMax: 1.5, prScale: 1, shadowMap: 2048 });
    expect(QUALITY.bajo.shadowMap).toBe(0);
    expect(QUALITY.bajo.antialias).toBe(false);
    expect(pixelRatio('alto', 2)).toBe(1.5);
    expect(pixelRatio('medio', 1.25)).toBe(1);
    expect(pixelRatio('bajo', 1)).toBe(0.75);
    expect(pixelRatio('bajo', 1, 2)).toBe(2);
  });
});
