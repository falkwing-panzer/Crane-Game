import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';

// Mismas teclas que la referencia (keymap de crane-v20.html).
const KEYMAP: Record<string, string> = {
  KeyA: 'sll', KeyD: 'slr', KeyW: 'lu', KeyS: 'ld', KeyE: 'to', KeyQ: 'ti', KeyR: 'hu', KeyF: 'hd',
  ArrowUp: 'fw', ArrowDown: 'bk', ArrowLeft: 'stl', ArrowRight: 'str',
};

export class Input {
  private k: Record<string, number> = { sll: 0, slr: 0, lu: 0, ld: 0, to: 0, ti: 0, hu: 0, hd: 0, fw: 0, bk: 0, stl: 0, str: 0 };
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

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.fine = true;
      if (e.code === 'KeyX' && !e.repeat) { this.onReset(); return; }
      if (e.code === 'KeyO' && !e.repeat) { this.onOutriggers(); return; }
      if (e.code === 'KeyP' && !e.repeat) { this.onBypass(); return; }
      if (e.code === 'KeyV' && !e.repeat) { this.onView(); return; }
      if (e.code === 'KeyB' && !e.repeat) { this.onBallast(); return; }
      if (e.code === 'KeyY' && !e.repeat) { this.onYGuy(); return; }
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
    return { slew: k.sll - k.slr, luff: k.lu - k.ld, tele: k.to - k.ti, hoist: k.hd - k.hu, fine: this.fine };
  }

  drive(): DriveInput {
    const k = this.k;
    return { throttle: k.fw - k.bk, steer: k.stl - k.str, fine: this.fine };
  }
}
