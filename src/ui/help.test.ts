import { describe, expect, it } from 'vitest';
import inputSrc from './input.ts?raw';
import { CRANES, isCrawler, type CraneId } from '../crane/cranes';
import { canTie } from '../crane/tiedown';
import { helpGroups, helpHtml, type HelpFlags } from './help';
import { showFps, stickyParams } from './settings';

const ALL: HelpFlags = {
  tele: true, tower: true, outriggers: true, crawler: true, wheels: true, tie: true, ballast: true, yguy: true,
  jib: true, superlift: true, tandem: true, free: true,
};

/** Flags de una grúa sola en la prueba libre (como los calcula main.ts) */
const flagsOf = (id: CraneId, free = true): HelpFlags => {
  const T = CRANES[id];
  return {
    tele: !T.tower && T.boom.max > T.boom.min, tower: !!T.tower, outriggers: !!T.out, crawler: isCrawler(T), wheels: !isCrawler(T),
    tie: canTie(T), ballast: !!T.ballast, yguy: !!T.yguy, jib: !!T.jibDef, superlift: !!T.superlift, tandem: false, free,
  };
};

/** Todas las teclas que lee input.ts, con el nombre que muestra la ayuda */
function inputKeys() {
  const codes = new Set<string>();
  for (const m of inputSrc.matchAll(/\b(Key[A-Z]|Arrow\w+|Space|Tab|Escape)\b/g)) codes.add(m[1]);
  const name = (c: string) => c.startsWith('Key') ? c.slice(3)
    : ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Espacio', Tab: 'Tab', Escape: 'Esc' } as Record<string, string>)[c];
  return [...codes].map(name);
}

/** Texto de la ayuda, sin el grupo del mando (sus botones A, B, X, Y se confundirían con las teclas) */
const shown = (g: ReturnType<typeof helpGroups>) => g.filter((x) => x.title !== 'Mando').flatMap((x) => x.keys.map(([k, t]) => `${k} ${t}`)).join('\n');

describe('ayuda de controles (fase 13)', () => {
  it('con todo activado lista todas las teclas de input.ts', () => {
    const text = shown(helpGroups(ALL));
    const keys = inputKeys();
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(text, `falta ${k}`).toMatch(new RegExp(`(^|[\\s/])${k}([\\s/]|$)`, 'm'));
    expect(text).toContain('Shift');
  });

  it('incluye lo que se fue añadiendo: cámara libre del tándem y amarre del gancho', () => {
    const text = shown(helpGroups(ALL));
    expect(text).toMatch(/libre en la obra/);
    expect(text).toMatch(/gancho de remolque/);
  });

  it('cada grúa ve solo sus teclas', () => {
    const at60 = shown(helpGroups(flagsOf('medium')));
    expect(at60).toMatch(/^O /m);
    expect(at60).toMatch(/gancho de remolque/);
    expect(at60).not.toMatch(/^B /m);
    expect(at60).not.toMatch(/^K \/ L/m);
    expect(at60).not.toMatch(/^Tab/m);

    const lr = shown(helpGroups(flagsOf('lr')));
    expect(lr).toMatch(/^K \/ L/m);
    expect(lr).toMatch(/girar en el sitio/);
    expect(lr).not.toMatch(/^O /m); // orugas: sin estabilizadores
    expect(lr).not.toMatch(/gancho de remolque/);

    const sk = shown(helpGroups(flagsOf('sk')));
    expect(sk).toMatch(/^Q \/ E mover el carro/m);
    expect(sk).toMatch(/montar \/ plegar la torre/);
    expect(sk).not.toMatch(/gancho de remolque/); // la grúa torre no se amarra

    const at650 = shown(helpGroups(flagsOf('at650')));
    expect(at650).toMatch(/^T \/ G/m);
    expect(at650).toMatch(/^Y /m);
  });

  it('X y P solo en la prueba libre', () => {
    expect(shown(helpGroups(flagsOf('medium', true)))).toMatch(/^X /m);
    const lvl = shown(helpGroups(flagsOf('medium', false)));
    expect(lvl).not.toMatch(/^X /m);
    expect(lvl).not.toMatch(/^P /m);
  });

  it('el HTML escapa el texto', () => {
    expect(helpHtml([{ title: 'a<b', keys: [['<', 'x & y']] }])).toBe('<section><h3>a&lt;b</h3><dl><dt><kbd>&lt;</kbd></dt><dd>x &amp; y</dd></dl></section>');
  });
});

describe('contador de fps (fase 13)', () => {
  it('en desarrollo siempre; publicado solo con ?fps=1', () => {
    expect(showFps(true, '')).toBe(true);
    expect(showFps(false, '')).toBe(false);
    expect(showFps(false, '?nivel=3')).toBe(false);
    expect(showFps(false, '?fps=1')).toBe(true);
    expect(showFps(false, '?nivel=3&fps=1')).toBe(true);
    expect(showFps(true, '?fps=0')).toBe(false);
  });

  it('?fps= se conserva al cambiar de nivel o de grúa', () => {
    expect(stickyParams('?nivel=2&grua=xl')).toEqual([]);
    expect(stickyParams('?nivel=2&fps=1')).toEqual([['fps', '1']]);
  });
});
