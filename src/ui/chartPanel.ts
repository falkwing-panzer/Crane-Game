import type { CraneSpec } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';
import { reach, ratedCap, type CraneConfig, type SupportMode } from '../crane/stability';
import { teleLimit } from '../crane/assembly';
import { chartMark, loadChart, type LoadChart } from '../crane/loadChart';
import { withKeys } from './keys';
import { t } from '../i18n';

// Tabla de cargas (fase 20): panel que se abre con C. Es solo interfaz (no se graba ni para la simulación): se puede
// tener abierto mientras se maneja y la casilla de la posición actual se marca sola. La tabla se recalcula solo
// cuando cambia la configuración (apoyo, lastre, Y-guy, plumín, superlift; con "giro actual", también el giro), como
// mucho cada 0,4 s.

const tc = t.chart;
const D = Math.PI / 180;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');
/** Capacidad en la tabla: con un decimal por debajo de 10 t */
export const capText = (c: number) => (c < 10 ? f1(c) : Math.round(c).toString());

export interface ChartInput { T: CraneSpec; S: CraneState; C: CraneConfig; md: SupportMode; mHook: number }

export class ChartPanel {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private setup: HTMLElement;
  private table: HTMLElement;
  private now: HTMLElement;
  private all: HTMLInputElement;
  private ch: LoadChart | null = null;
  private key = '';
  private markKey = '';
  private lastCalc = -Infinity;

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML('beforeend', `<div class="panel chart" hidden>
      <div class="chart-head"><b></b><button type="button" class="chart-x"></button></div>
      <label class="chart-mode"><input type="checkbox" checked> ${tc.all}</label>
      <small class="chart-setup"></small><div class="chart-table"></div><div class="chart-now"></div><small>${tc.legend}</small></div>`);
    this.el = parent.lastElementChild as HTMLElement;
    this.head = this.el.querySelector('.chart-head b')!;
    this.setup = this.el.querySelector('.chart-setup')!;
    this.table = this.el.querySelector('.chart-table')!;
    this.now = this.el.querySelector('.chart-now')!;
    this.all = this.el.querySelector('input')!;
    this.all.addEventListener('change', () => { this.key = ''; this.all.blur(); });
    const x = this.el.querySelector<HTMLButtonElement>('.chart-x')!;
    x.addEventListener('click', () => { this.toggle(false); x.blur(); });
  }

  get open() { return !this.el.hidden; }

  toggle(open = !this.open) {
    this.el.hidden = !open;
    this.el.querySelector('.chart-x')!.textContent = withKeys(tc.close);
    this.key = '';
  }

  /** Cada cuadro con el panel abierto: recalcula si cambió la configuración y mueve la marca */
  update(u: ChartInput, now = performance.now()) {
    if (!this.open) return;
    const { T, S, C, md } = u;
    const slew = this.all.checked ? null : Math.round(S.slew / (2 * D)) * 2 * D;
    const maxLb = T.tower ? T.boom.max : teleLimit(T, S);
    const key = [T.id, md, C.mCw, C.yOn, C.jib ? C.jibRel.toFixed(2) : '-', C.slR.toFixed(1), maxLb, slew ?? 'all'].join('|');
    if (key !== this.key && (now - this.lastCalc > 400 || !this.ch || this.ch.md !== md)) {
      this.key = key;
      this.lastCalc = now;
      this.ch = loadChart(T, C, md, slew, maxLb);
      this.head.textContent = tc.title(T.name);
      const extra = (C.yOn ? tc.yguy : '') + (C.jib ? tc.jib(f1((C.jibRel) / D)) : '') +
        (T.superlift ? tc.superlift(f1(C.slR)) : '') + (maxLb < T.boom.max ? tc.teleMax(f1(maxLb)) : '');
      this.setup.textContent = tc.setup(t.hud.modes[md], f1(C.mCw), extra, f1(T.hookM));
      this.markKey = '';
    }
    const ch = this.ch!;
    const R = Math.max(0, reach(T, C, S.Lb, S.ang));
    const mk = chartMark(ch, R, S.Lb, S.ang);
    const mHook = Math.round(u.mHook * 10) / 10;
    const mkKey = `${this.key}|${mk.row}|${mk.col}|${mHook}`;
    if (mkKey !== this.markKey) {
      this.markKey = mkKey;
      this.table.innerHTML = chartHtml(ch, mk, mHook);
    }
    const cap = ratedCap(T, C, md, S.Lb, S.ang, S.slew);
    this.now.innerHTML = T.tower ? tc.nowTower(f1(R), f1(S.ang / D), capText(cap), f1(u.mHook))
      : tc.now(f1(R), f1(S.Lb), capText(cap), f1(u.mHook));
  }
}

/** HTML de la tabla: filas = radio, columnas = largo (o ángulo); marca la fila, la columna y la casilla actuales */
export function chartHtml(ch: LoadChart, mk: { row: number; col: number }, mHook: number) {
  const colHead = ch.kind === 'tower' ? tc.angCol : tc.boomCol;
  const num = (v: number) => (Number.isInteger(v) ? String(v) : f1(v));
  let h = `<table><thead><tr><th>${tc.radius}</th><th colspan="${ch.cols.length}">${colHead}</th></tr>` +
    `<tr><th>m</th>${ch.cols.map((c, j) => `<th class="${j === mk.col ? 'on' : ''}">${num(c)}</th>`).join('')}</tr></thead><tbody>`;
  ch.radii.forEach((R, i) => {
    h += `<tr class="${i === mk.row ? 'on' : ''}"><th>${num(R)}</th>` + ch.cap[i].map((c, j) => {
      const cls = [i === mk.row && j === mk.col ? 'now' : j === mk.col ? 'col' : '', c !== null && c < mHook ? 'over' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}">${c === null ? '' : capText(c)}</td>`;
    }).join('') + '</tr>';
  });
  return h + '</tbody></table>';
}
