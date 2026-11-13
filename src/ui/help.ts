import { t } from '../i18n';
import { DEFAULT_KEYS, activeKeys, keyLabel, rebind, saveKeys, type Action, type KeyMap } from './keys';

// Ayuda de controles (fase 13): tecla H o botón "?". Las teclas van agrupadas y solo salen las que sirven con la(s)
// grúa(s) de esta partida. helpGroups() no toca el DOM (se prueba suelta); Help es el panel.
// Fase 14: las teclas son las que tenga asignadas el jugador, y el mismo panel tiene el editor de teclas.

/** Qué tiene la partida (en el tándem, lo que tenga alguna de las dos grúas) */
export interface HelpFlags {
  /** pluma telescópica (Q/E) */
  tele: boolean;
  /** grúa torre: Q/E mueven el carro y M monta la torre */
  tower: boolean;
  /** estabilizadores (O) */
  outriggers: boolean;
  /** alguna grúa de orugas (giro en el sitio) */
  crawler: boolean;
  /** alguna grúa con dirección (ruedas) */
  wheels: boolean;
  /** amarre del gancho al gancho de remolque delantero (grúas de ruedas, no la grúa torre) */
  tie: boolean;
  ballast: boolean;
  yguy: boolean;
  jib: boolean;
  superlift: boolean;
  /** dos grúas: Tab y cámara libre */
  tandem: boolean;
  /** prueba libre: X reponer la carga y P puentear el LMI */
  free: boolean;
}

export interface HelpGroup {
  title: string;
  /** [teclas, qué hacen] */
  keys: [string, string][];
}

export function helpGroups(f: HelpFlags, k: KeyMap = activeKeys()): HelpGroup[] {
  const h = t.help, p = h.pad_;
  const K = (a: Action) => keyLabel(k[a]);
  const two = (a: Action, b: Action) => `${K(a)} / ${K(b)}`;
  const g: HelpGroup[] = [];
  const drive: [string, string][] = [[two('fw', 'bk'), h.fwBk]];
  if (f.wheels) drive.push([two('stl', 'str'), h.steer]);
  if (f.crawler) drive.push([two('stl', 'str'), f.wheels ? h.crawlTurnBoth : h.crawlTurn]);
  if (f.outriggers) drive.push([K('outriggers'), h.outriggers]);
  g.push({ title: h.drive, keys: drive });

  const crane: [string, string][] = [[two('sll', 'slr'), h.slew], [two('lu', 'ld'), f.tower ? h.luffTower : h.luff]];
  if (f.tower && f.tele) crane.push([two('ti', 'to'), h.teleTower]);
  else if (f.tower) crane.push([two('ti', 'to'), h.trolley]);
  else if (f.tele) crane.push([two('ti', 'to'), h.tele]);
  crane.push([two('hu', 'hd'), h.hoist]);
  crane.push([K('hook'), h.hook]);
  if (f.tie) crane.push([K('hook'), h.tie]);
  crane.push([K('fine'), h.fine]);
  g.push({ title: h.crane, keys: crane });

  const mount: [string, string][] = [];
  if (f.ballast) mount.push([K('ballast'), h.ballast]);
  if (f.yguy) mount.push([K('yguy'), h.yguy]);
  if (f.jib) mount.push([K('mount'), h.jibMount], [two('ju', 'jd'), h.jib]);
  if (f.tower) mount.push([K('mount'), h.tower]);
  if (f.superlift) mount.push([two('sli', 'slo'), h.superlift]);
  if (mount.length) g.push({ title: h.mount, keys: mount });

  const cam: [string, string][] = [[K('view'), f.tandem ? h.camTandem : h.cam], [h.mouse, h.mouseText]];
  if (f.tandem) cam.push([K('switch'), h.switch]);
  g.push({ title: f.tandem ? h.camTitleTandem : h.camTitle, keys: cam });

  if (f.free) g.push({ title: h.free, keys: [[K('reset'), h.reset], [K('bypass'), h.bypass], [K('rewind'), h.rewind]] });

  g.push({ title: h.game, keys: [[K('help'), h.help], [keyLabel('Escape'), h.esc], [K('mute'), h.mute]] });

  const pad: [string, string][] = [[p.lstick, p.lstickText], [p.rstick, p.rstickText], ['LT / RT', p.triggers]];
  if (f.tele || f.tower) pad.push(['LB / RB', f.tower && !f.tele ? p.bumpersTrolley : p.bumpers]);
  if (f.jib || f.superlift) pad.push([p.dpad, [f.jib && p.dpadJib, f.superlift && p.dpadSl].filter(Boolean).join(' · ')]);
  pad.push(['A', p.a]);
  if (f.outriggers) pad.push(['B', p.b]);
  if (f.ballast) pad.push(['X', p.x]);
  pad.push(['Y', p.y]);
  if (f.jib || f.tower) pad.push(['View', p.view]);
  if (f.yguy) pad.push(['Menu', p.menu]);
  pad.push([p.l3, p.l3Text]);
  if (f.tandem) pad.push([p.r3, p.r3Text]);
  g.push({ title: h.pad, keys: pad });
  return g;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function helpHtml(groups: HelpGroup[]) {
  return groups.map((gr) => `<section><h3>${esc(gr.title)}</h3><dl>` +
    gr.keys.map(([k, d]) => `<dt>${k.split(' / ').map((p) => `<kbd>${esc(p)}</kbd>`).join(' / ')}</dt><dd>${esc(d)}</dd>`).join('') +
    `</dl></section>`).join('');
}

/** Grupos del editor de teclas (todas las acciones, sirvan o no a la grúa de esta partida) */
export const KEY_GROUPS: [keyof typeof t.keys.groups, Action[]][] = [
  ['drive', ['fw', 'bk', 'stl', 'str', 'outriggers']],
  ['crane', ['sll', 'slr', 'lu', 'ld', 'ti', 'to', 'hu', 'hd', 'ju', 'jd', 'sli', 'slo', 'fine', 'hook']],
  ['mount', ['ballast', 'yguy', 'mount']],
  ['game', ['view', 'switch', 'reset', 'bypass', 'rewind', 'mute', 'help']],
];

/** HTML del editor: un botón con la tecla de cada acción */
export function keysHtml(k: KeyMap, editing: Action | null) {
  return KEY_GROUPS.map(([g, list]) => `<section><h3>${esc(t.keys.groups[g])}</h3><dl>` + list.map((a) =>
    `<dt><button type="button" class="kbtn${a === editing ? ' on' : ''}" data-a="${a}">` +
    (a === editing ? esc(t.help.press) : `<kbd>${esc(keyLabel(k[a]))}</kbd>`) +
    `</button></dt><dd>${esc(t.keys.actions[a])}</dd>`).join('') + `</dl></section>`).join('');
}

/** Lo que el panel necesita del teclado (Input) para cambiar las teclas */
export interface KeyHost {
  keyMap: KeyMap;
  setKeys(k: KeyMap): void;
  capture: ((code: string) => void) | null;
}

/** Panel de ayuda; mientras está abierto, la grúa no recibe teclas (la simulación sigue). */
export class Help {
  private el: HTMLElement;
  private grid: HTMLElement;
  private note: HTMLElement;
  private editBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private editing = false;
  private waiting: Action | null = null;
  /** se abrió o se cerró (para soltar las teclas pulsadas) */
  onToggle: (open: boolean) => void = () => {};
  /** cambiaron las teclas (para rehacer los textos que las muestran) */
  onKeys: () => void = () => {};

  constructor(root: HTMLElement, private flags: HelpFlags, button: HTMLElement, private host: KeyHost) {
    root.insertAdjacentHTML('beforeend', `<div class="overlay help" id="help" hidden><div class="lcard" role="dialog" aria-label="${esc(t.help.title)}">
      <h2>${esc(t.help.title)}</h2><p class="help-note" hidden></p><div class="help-grid"></div>
      <div class="row"><button class="btn" id="help-reset" hidden>${esc(t.help.restore)}</button><button class="btn" id="help-edit"></button>
      <button class="btn primary" id="help-close"></button></div></div></div>`);
    this.el = root.querySelector('#help')!;
    this.grid = this.el.querySelector('.help-grid')!;
    this.note = this.el.querySelector('.help-note')!;
    this.editBtn = this.el.querySelector('#help-edit')!;
    this.resetBtn = this.el.querySelector('#help-reset')!;
    this.closeBtn = this.el.querySelector('#help-close')!;
    this.closeBtn.addEventListener('click', () => this.toggle(false));
    this.editBtn.addEventListener('click', () => { this.editing = !this.editing; this.stopWaiting(); this.render(); this.editBtn.blur(); });
    this.resetBtn.addEventListener('click', () => { this.apply({ ...DEFAULT_KEYS }, t.help.restored); this.resetBtn.blur(); });
    this.grid.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.kbtn');
      if (b) this.listen(b.dataset.a as Action);
    });
    // clic fuera de la tarjeta: cerrar
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.toggle(false); });
    button.addEventListener('click', () => { this.toggle(); button.blur(); });
    this.render();
  }

  get open() { return !this.el.hidden; }

  toggle(open = !this.open) {
    if (open === this.open) return;
    this.stopWaiting();
    if (!open) this.editing = false;
    this.el.hidden = !open;
    this.render();
    this.onToggle(open);
  }

  private render(msg = '') {
    const k = this.host.keyMap;
    this.grid.innerHTML = this.editing ? keysHtml(k, this.waiting) : helpHtml(helpGroups(this.flags, k));
    this.note.hidden = !this.editing;
    this.note.textContent = msg || `${t.help.editHint} ${t.help.fixed}`;
    this.resetBtn.hidden = !this.editing;
    this.editBtn.textContent = this.editing ? t.help.back : t.help.edit;
    this.closeBtn.textContent = t.help.close(keyLabel(k.help));
  }

  /** Espera la tecla nueva para una acción (Esc cancela) */
  private listen(a: Action) {
    this.waiting = a;
    this.host.capture = (code) => {
      this.waiting = null;
      if (code === 'Escape') { this.render(); return; }
      const r = rebind(this.host.keyMap, a, code);
      this.apply(r.keys, r.swapped ? t.help.swapped(t.keys.actions[r.swapped], keyLabel(r.keys[r.swapped])) : '');
    };
    this.render();
  }

  private stopWaiting() {
    this.waiting = null;
    this.host.capture = null;
  }

  private apply(k: KeyMap, msg: string) {
    this.host.setKeys(k);
    saveKeys(k);
    this.render(msg);
    this.onKeys();
  }
}
