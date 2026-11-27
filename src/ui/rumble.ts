// Vibración del mando (fase 21; vibrationActuator de la API Gamepad, efecto 'dual-rumble'). Sin DOM: decide qué
// vibración toca; `Input.rumble` la manda al mando. Suave y continua desde el 90 % de LMI (más fuerte cuanto más
// cerca del corte), fuerte en golpes y aterrizajes duros, pulsos con la alarma de la línea eléctrica.

import { HARD_LANDING } from '../levels/rules';

export interface RumbleFx { strong: number; weak: number; ms: number }

/** Cada cuánto se renueva la vibración continua (s): un poco menos que su duración, para que no tenga huecos */
const LMI_EVERY = 0.18, LMI_MS = 220;
/** Pulso de la alarma de la línea: medio segundo, como el pitido */
const PROX_EVERY = 0.5, PROX_MS = 140;

export class Rumble {
  private lmiT = 0;
  private proxT = 0;

  /** Golpe de la carga o aterrizaje (v en m/s); null si es tan suave que no se nota */
  hit(kind: 'land' | 'strike' | 'tip', v = 0): RumbleFx | null {
    if (kind === 'tip') return { strong: 1, weak: 1, ms: 700 };
    if (kind === 'strike') return v > 0.25 ? { strong: Math.min(1, 0.5 + v * 0.4), weak: 0.6, ms: 250 } : null;
    if (v >= HARD_LANDING) return { strong: 1, weak: 0.8, ms: 320 };
    if (v >= 0.6) return { strong: 0.45, weak: 0.4, ms: 160 };
    return null;
  }

  /** Cada cuadro: vibración continua del LMI y pulsos de la línea (null si no toca mandar nada ahora) */
  frame(dt: number, s: { lmi: number; prox: boolean; off: boolean }): RumbleFx | null {
    if (s.off) { this.lmiT = 0; this.proxT = 0; return null; }
    let fx: RumbleFx | null = null;
    if (s.prox) {
      this.proxT -= dt;
      if (this.proxT <= 0) { this.proxT = PROX_EVERY; fx = { strong: 0.7, weak: 0.3, ms: PROX_MS }; }
    } else this.proxT = 0;
    if (s.lmi >= 0.9) {
      this.lmiT -= dt;
      if (this.lmiT <= 0) {
        this.lmiT = LMI_EVERY;
        const k = Math.min(1, (s.lmi - 0.9) / 0.2);
        const l = { strong: s.lmi >= 1 ? 0.35 : 0, weak: 0.15 + 0.55 * k, ms: LMI_MS };
        // la de la línea manda (más fuerte); si no, la del LMI
        fx = fx ? { strong: Math.max(fx.strong, l.strong), weak: Math.max(fx.weak, l.weak), ms: fx.ms } : l;
      }
    } else this.lmiT = 0;
    return fx;
  }
}
