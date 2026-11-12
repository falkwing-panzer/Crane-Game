// Ayuda de controles (fase 13): tecla H o botón "?". Las teclas van agrupadas y solo salen las que sirven con la(s)
// grúa(s) de esta partida. helpGroups() no toca el DOM (se prueba suelta); Help es el panel.

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

export function helpGroups(f: HelpFlags): HelpGroup[] {
  const g: HelpGroup[] = [];
  const drive: [string, string][] = [['↑ / ↓', 'avanzar / retroceder']];
  if (f.wheels) drive.push(['← / →', 'dirección']);
  if (f.crawler) drive.push(['← / →', f.wheels ? 'orugas: girar en el sitio' : 'girar en el sitio (orugas)']);
  if (f.outriggers) drive.push(['O', 'sacar / recoger estabilizadores']);
  g.push({ title: 'Conducción', keys: drive });

  const crane: [string, string][] = [['A / D', 'girar la superestructura'], ['W / S', f.tower ? 'subir / bajar la pluma de la torre' : 'subir / bajar la pluma']];
  if (f.tower && f.tele) crane.push(['Q / E', 'telescopio (grúa móvil) · carro (grúa torre)']);
  else if (f.tower) crane.push(['Q / E', 'mover el carro']);
  else if (f.tele) crane.push(['Q / E', 'recoger / sacar el telescopio']);
  crane.push(['R / F', 'subir / bajar el gancho']);
  crane.push(['Espacio', 'enganchar / soltar la carga']);
  if (f.tie) crane.push(['Espacio', 'junto al gancho de remolque delantero: amarrar / soltar el gancho para conducir']);
  crane.push(['Shift', 'movimiento fino (mantener)']);
  g.push({ title: 'Pluma y gancho', keys: crane });

  const mount: [string, string][] = [];
  if (f.ballast) mount.push(['B', 'montar / desmontar el lastre']);
  if (f.yguy) mount.push(['Y', 'arriostramiento en Y']);
  if (f.jib) mount.push(['M', 'montar / desmontar el plumín'], ['T / G', 'subir / bajar el plumín']);
  if (f.tower) mount.push(['M', 'montar / plegar la torre']);
  if (f.superlift) mount.push(['K / L', 'acercar / alejar el contrapeso superlift']);
  if (mount.length) g.push({ title: 'Montajes', keys: mount });

  const cam: [string, string][] = [
    ['V', f.tandem ? 'cámara: orbital → seguimiento → cabina → libre en la obra' : 'cámara: orbital → seguimiento → cabina'],
    ['Ratón', 'girar (botón izquierdo), desplazar (derecho), acercar (rueda)'],
  ];
  if (f.tandem) cam.push(['Tab', 'cambiar de grúa (la cámara libre se queda donde está)']);
  g.push({ title: f.tandem ? 'Cámara y tándem' : 'Cámara', keys: cam });

  if (f.free) g.push({ title: 'Solo en la prueba libre', keys: [['X', 'reponer la carga en su sitio'], ['P', 'puentear el LMI (sin cortes: se puede volcar)']] });

  g.push({ title: 'Juego', keys: [['H', 'abrir / cerrar esta ayuda'], ['Esc', 'cerrar la ayuda'], ['N', 'sonido sí / no']] });

  const pad: [string, string][] = [
    ['Stick izquierdo', 'marcha y dirección'], ['Stick derecho', 'giro y pluma'], ['LT / RT', 'subir / bajar el gancho'],
  ];
  if (f.tele || f.tower) pad.push(['LB / RB', f.tower && !f.tele ? 'carro' : 'telescopio']);
  if (f.jib || f.superlift) pad.push(['Cruceta', [f.jib && '↑↓ plumín', f.superlift && '←→ superlift'].filter(Boolean).join(' · ')]);
  pad.push(['A', 'enganchar / soltar']);
  if (f.outriggers) pad.push(['B', 'estabilizadores']);
  if (f.ballast) pad.push(['X', 'lastre']);
  pad.push(['Y', 'cámara']);
  if (f.jib || f.tower) pad.push(['View', 'montaje']);
  if (f.yguy) pad.push(['Menu', 'arriostramiento en Y']);
  pad.push(['Clic stick izq.', 'fino']);
  if (f.tandem) pad.push(['Clic stick der.', 'cambiar de grúa']);
  g.push({ title: 'Mando', keys: pad });
  return g;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function helpHtml(groups: HelpGroup[]) {
  return groups.map((gr) => `<section><h3>${esc(gr.title)}</h3><dl>` +
    gr.keys.map(([k, t]) => `<dt>${k.split(' / ').map((p) => `<kbd>${esc(p)}</kbd>`).join(' / ')}</dt><dd>${esc(t)}</dd>`).join('') +
    `</dl></section>`).join('');
}

/** Panel de ayuda; mientras está abierto, la grúa no recibe teclas (la simulación sigue). */
export class Help {
  private el: HTMLElement;
  /** se abrió o se cerró (para soltar las teclas pulsadas) */
  onToggle: (open: boolean) => void = () => {};

  constructor(root: HTMLElement, flags: HelpFlags, button: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `<div class="overlay help" id="help" hidden><div class="lcard" role="dialog" aria-label="Controles">
      <h2>Controles</h2><div class="help-grid">${helpHtml(helpGroups(flags))}</div>
      <div class="row"><button class="btn primary" id="help-close">Cerrar (H)</button></div></div></div>`);
    this.el = root.querySelector('#help')!;
    this.el.querySelector('#help-close')!.addEventListener('click', () => this.toggle(false));
    // clic fuera de la tarjeta: cerrar
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.toggle(false); });
    button.addEventListener('click', () => { this.toggle(); button.blur(); });
  }

  get open() { return !this.el.hidden; }

  toggle(open = !this.open) {
    if (open === this.open) return;
    this.el.hidden = !open;
    this.onToggle(open);
  }
}
