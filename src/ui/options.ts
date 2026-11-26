import { t } from '../i18n';
import { HUD_SIZES, saveSettings, type Settings } from './settings';

// Opciones del operador (fase 21): recuadro de la cámara del gancho, vibración del mando, ayudas, modo experto y
// tamaño del HUD. Botón "Opciones" en la columna de la izquierda; se guardan con los demás ajustes.

const to = t.options;

export class OptionsPanel {
  private el: HTMLElement;
  /** Cambió algo (ya guardado) */
  onChange: (s: Settings) => void = () => {};
  /** Se abrió o se cerró (para no mover la grúa con las teclas mientras tanto) */
  onToggle: (open: boolean) => void = () => {};

  constructor(root: HTMLElement, left: HTMLElement, private s: Settings) {
    left.insertAdjacentHTML('beforeend', `<button class="opts-btn" id="opts-btn">${t.hud.options}</button>`);
    const sizes = HUD_SIZES.map((v) => `<option value="${v}"${v === s.hud ? ' selected' : ''}>${Math.round(v * 100)} %</option>`).join('');
    const box = (id: keyof Settings, label: string, note: string) =>
      `<label><input type="checkbox" data-k="${id}"${s[id] ? ' checked' : ''}><span>${label}<small>${note}</small></span></label>`;
    root.insertAdjacentHTML('beforeend', `<div class="overlay" id="opts" hidden><div class="lcard opts" role="dialog" aria-label="${to.title}">
      <h2>${to.title}</h2>
      ${box('recuadro', to.pip, to.pipNote)}${box('vibracion', to.vibration, to.vibrationNote)}
      ${box('ayudas', to.aids, to.aidsNote)}${box('experto', to.expert, to.expertNote)}
      <label><span>${to.hud} <select id="opts-hud">${sizes}</select></span></label>
      <div class="row"><button class="btn primary" id="opts-close">${to.close}</button></div></div></div>`);
    this.el = root.querySelector('#opts')!;
    const btn = left.querySelector<HTMLButtonElement>('#opts-btn')!;
    btn.addEventListener('click', () => { this.toggle(); btn.blur(); });
    this.el.querySelector('#opts-close')!.addEventListener('click', () => this.toggle(false));
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.toggle(false); });
    this.el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => i.addEventListener('change', () => {
      (this.s as unknown as Record<string, boolean>)[i.dataset.k!] = i.checked;
      this.changed();
    }));
    const sel = this.el.querySelector<HTMLSelectElement>('#opts-hud')!;
    sel.addEventListener('change', () => { this.s.hud = Number(sel.value); this.changed(); });
    this.sync();
  }

  get open() { return !this.el.hidden; }

  toggle(open = !this.open) {
    this.el.hidden = !open;
    this.onToggle(open);
  }

  private changed() {
    saveSettings(this.s);
    this.sync();
    this.onChange(this.s);
  }

  /** En modo experto no hay ayudas: la casilla queda desactivada */
  private sync() {
    const aids = this.el.querySelector<HTMLInputElement>('input[data-k="ayudas"]')!;
    aids.disabled = this.s.experto;
    aids.closest('label')!.style.opacity = this.s.experto ? '0.5' : '';
  }
}
