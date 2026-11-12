import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';
import { padAxes, padEdges, pressedList, type PadAction, type PadAxes } from './gamepad';

// Mismas teclas que la referencia (keymap de crane-v20.html).
const KEYMAP: Record<string, string> = {
  KeyA: 'sll', KeyD: 'slr', KeyW: 'lu', KeyS: 'ld', KeyE: 'to', KeyQ: 'ti', KeyR: 'hu', KeyF: 'hd',
  ArrowUp: 'fw', ArrowDown: 'bk', ArrowLeft: 'stl', ArrowRight: 'str',
  KeyK: 'sli', KeyL: 'slo', KeyT: 'ju', KeyG: 'jd',
};

export class Input {
  private k: Record<string, number> = { sll: 0, slr: 0, lu: 0, ld: 0, to: 0, ti: 0, hu: 0, hd: 0, fw: 0, bk: 0, stl: 0, str: 0, sli: 0, slo: 0, ju: 0, jd: 0 };
  private fine = false;
  /** mando (fase 11): ejes del último poll() y botones pulsados entonces */
  private pad: PadAxes | null = null;
  private padPrev: boolean[] = [];
  /** se avisó de que hay un mando conectado */
  onPad: (name: string) => void = () => {};
  private padName = '';
  onHook: () => void = () => {};
  /** X: reponer la carga (ayuda de prueba, no está en la referencia) */
  onReset: () => void = () => {};
  /** O: estabilizadores */
  onOutriggers: () => void = () => {};
  /** P: puenteo del LMI (ayuda de prueba, no está en la referencia) */
  onBypass: () => void = () => {};
  /** B: lastre */
  onBallast: () => void = () => {};
  /** Y: arriostramiento en Y */
  onYGuy: () => void = () => {};
  /** V: cambiar de cámara */
  onView: () => void = () => {};
  /** M: montaje del plumín */
  onMount: () => void = () => {};
  /** Tab: cambiar de grúa en el tándem (fase 10) */
  onSwitch: () => void = () => {};
  /** N: silenciar el sonido (fase 11) */
  onMute: () => void = () => {};
  /** H: ayuda de controles (fase 13) */
  onHelp: () => void = () => {};
  /** Esc: cerrar la ayuda (fase 13) */
  onEscape: () => void = () => {};
  /**
   * Motivos por los que las teclas y el mando no mueven la grúa (solo H y Esc): la ayuda abierta (fase 13) o el
   * juego en pausa (fase 14: pestaña oculta, ventana sin foco, gráfica perdida).
   */
  private blocks = new Set<string>();
  private get paused() { return this.blocks.size > 0; }

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.repeat) { this.onHelp(); return; }
      if (e.code === 'Escape' && !e.repeat) { this.onEscape(); return; }
      if (this.paused) { if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); return; }
      if (e.key === 'Shift') this.fine = true;
      if (e.code === 'KeyX' && !e.repeat) { this.onReset(); return; }
      if (e.code === 'KeyO' && !e.repeat) { this.onOutriggers(); return; }
      if (e.code === 'KeyP' && !e.repeat) { this.onBypass(); return; }
      if (e.code === 'KeyV' && !e.repeat) { this.onView(); return; }
      if (e.code === 'KeyB' && !e.repeat) { this.onBallast(); return; }
      if (e.code === 'KeyY' && !e.repeat) { this.onYGuy(); return; }
      if (e.code === 'KeyM' && !e.repeat) { this.onMount(); return; }
      if (e.code === 'KeyN' && !e.repeat) { this.onMute(); return; }
      if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.onSwitch(); return; }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.onHook();
        return;
      }
      const a = KEYMAP[e.code];
      if (a) { this.k[a] = 1; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.fine = false;
      const a = KEYMAP[e.code];
      if (a) this.k[a] = 0;
    });
    addEventListener('blur', () => this.release());
  }

  /** Suelta todas las teclas pulsadas */
  release() {
    for (const a in this.k) this.k[a] = 0;
    this.fine = false;
  }

  /** Ayuda abierta: no se aceptan teclas ni mando, y se sueltan las que estaban pulsadas */
  pause(on: boolean) { this.block('ayuda', on); }

  /** Pone o quita un motivo para no aceptar teclas ni mando; siempre suelta las pulsadas */
  block(reason: string, on: boolean) {
    if (on) this.blocks.add(reason); else this.blocks.delete(reason);
    this.release();
  }

  /**
   * Mando (fase 11): lee el primer mando conectado; llamar una vez por cuadro. Los botones de un toque llaman a los
   * mismos avisos que las teclas.
   */
  poll() {
    const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (!gp) { this.pad = null; this.padPrev = []; this.padName = ''; return; }
    if (this.paused) { this.pad = null; this.padPrev = pressedList(gp.buttons); return; }
    if (gp.id !== this.padName) { this.padName = gp.id; this.onPad(gp.id); }
    this.pad = padAxes(gp.axes, gp.buttons);
    const act: Record<PadAction, () => void> = {
      hook: () => this.onHook(), outriggers: () => this.onOutriggers(), ballast: () => this.onBallast(), view: () => this.onView(),
      mount: () => this.onMount(), yguy: () => this.onYGuy(), switch: () => this.onSwitch(),
    };
    for (const a of padEdges(this.padPrev, gp.buttons)) act[a]();
    this.padPrev = pressedList(gp.buttons);
  }

  state(): CraneInput {
    const k = this.k, p = this.pad;
    // la tecla manda; si no hay tecla, el mando (proporcional)
    const m = (key: number, pad: number | undefined) => (key !== 0 ? key : pad ?? 0);
    return {
      slew: m(k.sll - k.slr, p?.slew), luff: m(k.lu - k.ld, p?.luff), tele: m(k.to - k.ti, p?.tele), hoist: m(k.hd - k.hu, p?.hoist),
      fine: this.fine || !!p?.fine, sl: m(k.slo - k.sli, p?.sl), jib: m(k.jd - k.ju, p?.jib),
    };
  }

  drive(): DriveInput {
    const k = this.k, p = this.pad;
    const m = (key: number, pad: number | undefined) => (key !== 0 ? key : pad ?? 0);
    return { throttle: m(k.fw - k.bk, p?.throttle), steer: m(k.stl - k.str, p?.steer), fine: this.fine || !!p?.fine };
  }
}
