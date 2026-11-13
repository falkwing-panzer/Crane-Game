import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';

/**
 * Entradas de la simulación paso a paso (fase 15): base del determinismo. Con las mismas entradas desde el mismo
 * estado, la partida sale igual paso a paso. Las acciones de un toque que cambian la simulación (Espacio, O, B…) no
 * se aplican al pulsar: se encolan y entran en el paso siguiente, así quedan grabadas en su paso.
 */

/** Acciones de un toque que cambian la simulación (la cámara, el sonido o la ayuda no cuentan) */
export type Cmd = 'hook' | 'reset' | 'outriggers' | 'ballast' | 'yguy' | 'mount' | 'bypass' | 'switch';

/** Lo que entra en un paso: mandos de la grúa que se maneja, conducción y acciones */
export interface StepInput {
  crane: CraneInput;
  drive: DriveInput;
  cmds: Cmd[];
}

/** De dónde salen las entradas de cada paso (el jugador, una grabación, un guion) */
export interface InputSource {
  /** Entradas del paso siguiente; null = se acabó (vuelve el jugador) */
  next(): StepInput | null;
}

const sameCrane = (a: CraneInput, b: CraneInput) => a.slew === b.slew && a.luff === b.luff && a.tele === b.tele && a.hoist === b.hoist
  && a.fine === b.fine && (a.sl ?? 0) === (b.sl ?? 0) && (a.jib ?? 0) === (b.jib ?? 0);
const sameDrive = (a: DriveInput, b: DriveInput) => a.throttle === b.throttle && a.steer === b.steer && a.fine === b.fine;

/** Tramo de la grabación: `n` pasos seguidos con las mismas entradas (las acciones, solo en el primero) */
interface Run { n: number; crane: CraneInput; drive: DriveInput; cmds: Cmd[] }

/**
 * Grabación de las entradas, comprimida por tramos (una hora con las teclas quietas es un tramo). `length` = pasos.
 */
export class Recording {
  private runs: Run[] = [];
  length = 0;

  push(s: StepInput) {
    const last = this.runs[this.runs.length - 1];
    if (last && !s.cmds.length && sameCrane(last.crane, s.crane) && sameDrive(last.drive, s.drive)) last.n++;
    else this.runs.push({ n: 1, crane: { ...s.crane }, drive: { ...s.drive }, cmds: [...s.cmds] });
    this.length++;
  }

  /** Se queda con los primeros `steps` pasos (rebobinar) */
  truncate(steps: number) {
    if (steps >= this.length) return;
    let k = 0;
    const out: Run[] = [];
    for (const r of this.runs) {
      if (k >= steps) break;
      const n = Math.min(r.n, steps - k);
      out.push({ ...r, n });
      k += n;
    }
    this.runs = out;
    this.length = Math.max(0, steps);
  }

  clear() { this.runs = []; this.length = 0; }

  /** Tramos (para guardar o comparar) */
  toJSON() { return this.runs.map((r) => ({ ...r })); }

  static fromJSON(runs: Run[]) {
    const r = new Recording();
    for (const x of runs) { r.runs.push({ ...x }); r.length += x.n; }
    return r;
  }

  /** Reproductor desde el paso `from` (0 = el principio) */
  player(from = 0): InputSource {
    const runs = this.runs;
    let i = 0, k = 0, skip = from;
    while (i < runs.length && skip >= runs[i].n) { skip -= runs[i].n; i++; }
    k = skip;
    return {
      next: () => {
        if (i >= runs.length) return null;
        const r = runs[i];
        const s: StepInput = { crane: { ...r.crane }, drive: { ...r.drive }, cmds: k === 0 ? [...r.cmds] : [] };
        if (++k >= r.n) { i++; k = 0; }
        return s;
      },
    };
  }
}
