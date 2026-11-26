import { t } from '../i18n';
import type { Signal } from '../game/signals';

// Fase 23: la radio del señalero (texto y, si se quiere, voz) y la lista de chequeo antes del izaje.

const tr = t.rigger;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Radio del señalero: una línea encima de las teclas; con voz, lee cada orden nueva (como mucho una cada 1,4 s) */
export class RadioPanel {
  private el: HTMLElement;
  private last: Signal | null = null;
  private spoken = 0;
  voice = false;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `<div class="panel radio" hidden><small>📻 ${tr.radio}</small><b></b></div>`);
    this.el = root.lastElementChild as HTMLElement;
  }

  update(sig: Signal | null, now = performance.now()) {
    this.el.hidden = !sig;
    if (!sig || sig === this.last) return;
    this.last = sig;
    const text = tr.say[sig];
    this.el.querySelector('b')!.textContent = text;
    this.el.classList.toggle('stop', sig === 'para' || sig === 'espera');
    if (this.voice && typeof speechSynthesis !== 'undefined' && now - this.spoken > 1400) {
      this.spoken = now;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      u.rate = 1.15;
      speechSynthesis.speak(u);
    }
  }

  dispose() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.el.remove();
  }
}

/** Lo que se comprueba solo, y los datos de la carga para el punto del peso */
export interface CheckState { level: boolean; clear: boolean; wind: number; load: { label: string; m: number } | null; done: boolean }

/** Lista de chequeo: 3 puntos automáticos y 2 que marca el jugador. "Lista hecha" solo con todo bien. */
export class ChecklistPanel {
  private el: HTMLElement;
  private manual = { weight: false, sling: false };
  /** Confirmada (la manda a la simulación como acción del paso) */
  onConfirm: () => void = () => {};
  onToggle: (open: boolean) => void = () => {};
  private st: CheckState | null = null;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `<div class="overlay" id="checklist" hidden><div class="lcard checklist" role="dialog" aria-label="${tr.checkTitle}"></div></div>`);
    this.el = root.querySelector('#checklist')!;
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.toggle(false); });
  }

  get open() { return !this.el.hidden; }

  toggle(open = !this.open) {
    this.el.hidden = !open;
    if (open) { this.manual = { weight: false, sling: false }; this.draw(); }
    this.onToggle(open);
  }

  /** Cada cuadro mientras está abierta: repinta los automáticos si cambian */
  update(st: CheckState) {
    const key = JSON.stringify(this.st), changed = key !== JSON.stringify(st);
    this.st = st;
    if (this.open && changed) this.draw();
  }

  private draw() {
    const st = this.st, card = this.el.firstElementChild as HTMLElement;
    if (!st) return;
    const auto = (ok: boolean, text: string) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${text}</li>`;
    const man = (k: 'weight' | 'sling', text: string) =>
      `<li><label><input type="checkbox" data-k="${k}"${this.manual[k] ? ' checked' : ''}> ${text}</label></li>`;
    const windOk = st.wind < 9;
    const all = st.level && st.clear && windOk && this.manual.weight && this.manual.sling;
    card.innerHTML = `<h2>${tr.checkTitle}</h2><p>${tr.checkIntro}</p><ul class="checks">
      ${auto(st.level, tr.level)}${auto(st.clear, tr.clear)}${auto(windOk, tr.wind(f1(st.wind)))}
      ${man('weight', st.load ? tr.weight(st.load.label, f1(st.load.m)) : tr.weight('—', '0'))}${man('sling', tr.sling)}</ul>
      ${st.done ? `<p class="rec">${tr.done}</p>` : ''}
      <div class="row"><button class="btn" id="ck-close">${tr.cancel}</button><button class="btn primary" id="ck-ok"${all ? '' : ' disabled'}>${tr.confirm}</button></div>`;
    card.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => i.addEventListener('change', () => {
      this.manual[i.dataset.k as 'weight' | 'sling'] = i.checked;
      this.draw();
    }));
    card.querySelector('#ck-close')!.addEventListener('click', () => this.toggle(false));
    card.querySelector('#ck-ok')!.addEventListener('click', () => { this.onConfirm(); this.toggle(false); });
  }

  dispose() { this.el.remove(); }
}
