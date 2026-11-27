import type { Unit } from './session';
import { mixFrame, readFrame, readInto, type Frame } from './interp';

// Repetición del fallo (fase 21): al volcar o fallar un nivel, los últimos ~8 s otra vez a cámara lenta.
// Se guarda lo que se dibuja de cada paso (lo mismo que la interpolación: grúas, poses, gancho, ancla del cable y
// cargas) en un anillo, y la repetición dibuja esos cuadros mezclados entre sí. No vuelve a simular: así no se
// disparan otra vez las reglas ni los eventos del turno, y el resultado es exactamente lo que se vio.
// (La grabación de entradas de la fase 15 daría lo mismo volviendo a simular desde una instantánea, pero haría falta
// apartar las reglas, el bus y el sonido mientras tanto; para mirar, basta con lo que se dibujó.)

/** Segundos que se guardan y velocidad de la repetición */
export const REPLAY_S = 8;
export const REPLAY_SPEED = 0.35;
/** Pasos por segundo de la física */
const HZ = 60;

export class ReplayBuffer {
  private ring: Frame[] = [];
  private next = 0;
  private count = 0;

  constructor(readonly cap = REPLAY_S * HZ) {}

  /** Después de cada paso con el turno en marcha */
  capture(units: Unit[]) {
    const f = this.ring[this.next];
    if (f && f.units.length === units.length && f.loads.length === units[0].phys.loads.length) readInto(f, units);
    else this.ring[this.next] = readFrame(units);
    this.next = (this.next + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
  }

  /** Pasos guardados */
  get size() { return this.count; }

  clear() { this.ring = []; this.next = 0; this.count = 0; }

  /** Los cuadros guardados, del más viejo al último, y el anillo queda vacío (lo que llegue después no los pisa) */
  take(): Frame[] {
    const out: Frame[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.ring[(this.next - this.count + i + this.cap) % this.cap]);
    this.clear();
    return out;
  }
}

/** Una repetición en marcha: el cuadro que toca según el tiempo, mezclando los dos pasos más cercanos */
export class Replay {
  private t = 0;
  private out: Frame;

  constructor(readonly frames: Frame[], readonly speed = REPLAY_SPEED) {
    this.out = structuredClone(frames[0]);
  }

  /** Duración de la repetición (s de reloj) */
  get length() { return (this.frames.length - 1) / HZ / this.speed; }
  get done() { return this.t >= this.length; }
  /** Avance 0…1 */
  get progress() { return this.length > 0 ? Math.min(1, this.t / this.length) : 1; }

  /** Avanza dt (s de reloj) y devuelve el cuadro que toca */
  frame(dt: number): Frame {
    this.t = Math.min(this.length, this.t + dt);
    const x = this.t * this.speed * HZ;
    const i = Math.min(this.frames.length - 1, Math.floor(x));
    const j = Math.min(this.frames.length - 1, i + 1);
    return mixFrame(this.frames[i], this.frames[j], x - i, this.out);
  }

  /** Vuelve a empezar (botón "Ver la repetición") */
  rewind() { this.t = 0; }
}
