import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';

// Mismas teclas que la referencia (keymap de crane-v20.html).
const KEYMAP: Record<string, string> = {
  KeyA: 'sll', KeyD: 'slr', KeyW: 'lu', KeyS: 'ld', KeyE: 'to', KeyQ: 'ti', KeyR: 'hu', KeyF: 'hd',
  ArrowUp: 'fw', ArrowDown: 'bk', ArrowLeft: 'stl', ArrowRight: 'str',
  KeyK: 'sli', KeyL: 'slo', KeyT: 'ju', KeyG: 'jd',
};

export class Input {
  private k: Record<string, number> = { sll: 0, slr: 0, lu: 0, ld: 0, to: 0, ti: 0, hu: 0, hd: 0, fw: 0, bk: 0, stl: 0, str: 0, sli: 0, slo: 0, ju: 0, jd: 0 };
  private fine = false;
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

  constructor() {
    addEventListener('keydown', (e) => {
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
    addEventListener('blur', () => {
      for (const a in this.k) this.k[a] = 0;
      this.fine = false;
    });
  }

  state(): CraneInput {
    const k = this.k;
    return { slew: k.sll - k.slr, luff: k.lu - k.ld, tele: k.to - k.ti, hoist: k.hd - k.hu, fine: this.fine, sl: k.slo - k.sli, jib: k.jd - k.ju };
  }

  drive(): DriveInput {
    const k = this.k;
    return { throttle: k.fw - k.bk, steer: k.stl - k.str, fine: this.fine };
  }
}
