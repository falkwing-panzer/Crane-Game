import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';
import { Physics, type PhysSnap } from '../physics/world';
import { afterUnit, controlUnit, IDLE, IDLE_DRIVE } from './control';
import { LevelRules } from './rules';
import { runCommand } from './commands';
import { Recording, type Cmd, type InputSource, type StepInput } from './record';
import { Interp } from './interp';
import type { Run, Session } from './session';
import type { CraneConfig } from '../crane/stability';
import type { CraneState } from '../crane/kinematics';
import type { Dyn } from '../crane/ops';
import type { Pose } from '../crane/pose';
import { t } from '../i18n';

/** De dónde salen los mandos de la grúa que se maneja (teclado y mando: `Input`) */
export interface Controls {
  state(): CraneInput;
  drive(): DriveInput;
}

/** Pasos entre instantáneas para rebobinar (1 s) y cuántas se guardan (10 s hacia atrás) */
const REWIND_EVERY = 60;
const REWIND_KEEP = 11;
/** Segundos que se rebobinan */
export const REWIND_S = 10;

/** Estado de una grúa en la instantánea (lo que no está en la física) */
interface UnitSnap {
  S: CraneState; C: CraneConfig; pose: Pose; dyn: Dyn; cut: boolean; cutMsg: boolean; tipClock: number; tipText: string;
  over: number; side: number; sideAng: number;
}

/** Instantánea de la partida (fase 15): física, grúas, turno, reglas y número de paso */
export interface GameSnap {
  step: number;
  phys: PhysSnap;
  units: UnitSnap[];
  act: number;
  bypass: boolean;
  running: boolean;
  run: Run;
  winClock: number;
}

/**
 * Un paso fijo de la partida: acciones de un toque, reglas del nivel, mandos de cada grúa, física, eventos de las
 * cargas (al bus) y estabilidad. No sabe nada del HUD, el sonido ni el render.
 *
 * Fase 15: las entradas de cada paso salen del jugador (o de `source`: una grabación o un guion) y se graban
 * (`rec`); con las mismas entradas la partida sale igual paso a paso. Instantáneas (`snapshot`/`restore`): reiniciar
 * al instante, rebobinar 10 s (prueba libre) y guardar a mitad de un nivel. Después de cada paso guarda lo que se
 * dibuja para la interpolación (`interp`).
 */
export class GameStep {
  readonly rules: LevelRules | null;
  /** Pasos dados con el turno en marcha (los de la grabación) */
  steps = 0;
  /** Entradas de cada paso desde el principio del turno */
  readonly rec = new Recording();
  /** Si no es null, las entradas salen de aquí (repetición, guion); al acabarse vuelve el jugador */
  source: InputSource | null = null;
  readonly interp = new Interp();
  private queue: Cmd[] = [];
  /** Estado inicial (reiniciar) y anillo de instantáneas para rebobinar */
  private start: GameSnap | null = null;
  private ring: GameSnap[] = [];

  constructor(private ses: Session, private controls: Controls) {
    this.rules = ses.L ? new LevelRules(ses, ses.L) : null;
    this.interp.reset(ses.units);
  }

  /** Acción de un toque: entra en el paso siguiente (si el turno no corre, se pierde) */
  push(cmd: Cmd) { this.queue.push(cmd); }

  tick(dt: number) {
    this.inner(dt);
    this.interp.capture(this.ses.units);
  }

  private inner(dt: number) {
    const { ses } = this;
    if (!ses.running) { this.queue.length = 0; return; } // ficha, menú o cartel abiertos: todo quieto
    let inp = this.source?.next() ?? null;
    if (!inp) {
      this.source = null;
      inp = { crane: this.controls.state(), drive: this.controls.drive(), cmds: this.queue.splice(0) };
    } else this.queue.length = 0;
    // estado de partida para reiniciar y rebobinar (antes del primer paso, y cada segundo)
    if (!this.start) this.start = this.snapshot();
    if (!ses.L && this.steps % REWIND_EVERY === 0 && this.ring[this.ring.length - 1]?.step !== this.steps) {
      this.ring.push(this.steps === 0 ? this.start : this.snapshot());
      if (this.ring.length > REWIND_KEEP) this.ring.shift();
    }
    this.rec.push(inp);
    this.steps++;
    for (const c of inp.cmds) runCommand(ses, c);
    this.advance(dt, inp);
  }

  private advance(dt: number, inp: StepInput) {
    const { ses, rules } = this;
    if (rules && !rules.before(dt)) return;
    const { units, act, bus } = ses;
    for (const u of units) {
      const mine = u === act;
      controlUnit(ses, u, dt, mine ? inp.crane : IDLE, mine ? inp.drive : IDLE_DRIVE);
    }
    if (ses.multi) Physics.stepCrew(units.map((u) => ({ phys: u.phys, S: u.S, pose: u.pose, slR: u.C.slR })));
    else act.phys.step(act.S, act.pose, act.C.slR);
    // aterrizajes y golpes de la carga (tándem: los registra cada grúa que la lleva)
    for (const u of units) {
      for (const e of u.phys.events.splice(0)) {
        if (e.kind === 'land') bus.emit('land', { unit: u.i, v: e.v, fragile: e.load.fragile });
        else bus.emit('strike', { unit: u.i, v: e.v });
      }
    }
    if (rules && !rules.after()) return;
    if (!ses.running) return;
    for (const u of units) afterUnit(ses, u, dt);
  }

  /** Instantánea de la partida entre dos pasos */
  snapshot(): GameSnap {
    const { ses } = this;
    return {
      step: this.steps,
      phys: ses.units[0].phys.snapshot(),
      units: ses.units.map((u) => structuredClone({
        S: u.S, C: { ...u.C, jib: null }, pose: u.pose, dyn: u.dyn, cut: u.cut, cutMsg: u.cutMsg, tipClock: u.tipClock,
        tipText: u.tipText, over: u.over, side: u.side, sideAng: u.sideAng,
      })).map((x, i) => ({ ...x, C: { ...x.C, jib: ses.units[i].C.jib } })),
      act: ses.units.indexOf(ses.act),
      bypass: ses.bypass,
      running: ses.running,
      run: { ...ses.run },
      winClock: this.rules?.winClock ?? 0,
    };
  }

  /** Vuelve a una instantánea (de esta partida o de una guardada de la misma partida) */
  restore(s: GameSnap) {
    const { ses } = this;
    ses.units[0].phys.restore(s.phys);
    ses.units.forEach((u, i) => {
      const x = structuredClone({ ...s.units[i], C: { ...s.units[i].C, jib: null } });
      Object.assign(u.S, x.S);
      Object.assign(u.C, x.C, { jib: s.units[i].C.jib });
      u.pose = x.pose;
      u.dyn = x.dyn;
      u.cut = x.cut;
      u.cutMsg = x.cutMsg;
      // volcada con el cartel ya mostrado: que vuelva a salir
      u.tipClock = u.phys.tipped && x.tipClock < 0 ? 0 : x.tipClock;
      u.tipText = x.tipText;
      u.over = x.over;
      u.side = x.side;
      u.sideAng = x.sideAng;
    });
    ses.act = ses.units[s.act];
    ses.bypass = s.bypass;
    ses.running = s.running;
    ses.run = { ...s.run };
    if (this.rules) this.rules.winClock = s.winClock;
    this.steps = s.step;
    this.rec.truncate(s.step);
    this.ring = this.ring.filter((r) => r.step <= s.step);
    this.queue.length = 0;
    this.source = null;
    this.interp.reset(ses.units);
  }

  /** Reiniciar: el estado del principio del turno, al instante (sin reconstruir la física) */
  restart() {
    const { ses } = this;
    if (this.start) {
      const st = this.start;
      this.restore(st);
      this.rec.clear();
      this.ring = [];
      this.start = null;
      ses.bus.emit('restart', {});
      ses.bus.emit('say', { text: t.msg.restarted, s: 1.5 });
    } else {
      ses.restart();
      this.interp.reset(ses.units);
    }
  }

  /** Rebobinar (prueba libre): vuelve unos 10 s atrás. Devuelve los segundos rebobinados (0 = no se pudo). */
  rewind(): number {
    const { ses } = this;
    if (ses.L || !ses.running || !this.ring.length) return 0;
    const target = this.steps - REWIND_S * REWIND_EVERY;
    // la más nueva que queda al menos 10 s atrás; si no hay, la más vieja
    const s = [...this.ring].reverse().find((r) => r.step <= target) ?? this.ring[0];
    const back = (this.steps - s.step) / REWIND_EVERY;
    this.restore(s);
    ses.bus.emit('restored', {});
    return back;
  }

  dispose() { this.rules?.dispose(); }
}
