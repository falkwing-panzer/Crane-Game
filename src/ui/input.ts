import type { CraneInput } from '../crane/kinematics';

// Mismas teclas que la referencia (keymap de crane-v20.html).
const KEYMAP: Record<string, string> = {
  KeyA: 'sll', KeyD: 'slr', KeyW: 'lu', KeyS: 'ld', KeyE: 'to', KeyQ: 'ti', KeyR: 'hu', KeyF: 'hd',
};

export class Input {
  private k: Record<string, number> = { sll: 0, slr: 0, lu: 0, ld: 0, to: 0, ti: 0, hu: 0, hd: 0 };
  private fine = false;
  onHook: () => void = () => {};
  /** X: reponer la carga (ayuda de prueba, no está en la referencia) */
  onReset: () => void = () => {};

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.fine = true;
      if (e.code === 'KeyX' && !e.repeat) { this.onReset(); return; }
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
}
