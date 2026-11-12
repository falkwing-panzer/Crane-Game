import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';
import { Physics } from '../physics/world';
import { afterUnit, controlUnit, IDLE, IDLE_DRIVE } from './control';
import { LevelRules } from './rules';
import type { Session } from './session';

/** De dónde salen los mandos de la grúa que se maneja (teclado y mando: `Input`) */
export interface Controls {
  state(): CraneInput;
  drive(): DriveInput;
}

/**
 * Un paso fijo de la partida: reglas del nivel, mandos de cada grúa, física, eventos de las cargas (al bus) y
 * estabilidad. No sabe nada del HUD, el sonido ni el render.
 */
export class GameStep {
  readonly rules: LevelRules | null;

  constructor(private ses: Session, private controls: Controls) {
    this.rules = ses.L ? new LevelRules(ses, ses.L) : null;
  }

  tick(dt: number) {
    const { ses, rules } = this;
    if (!ses.running) return; // ficha, menú o cartel abiertos: todo quieto
    if (rules && !rules.before(dt)) return;
    const { units, act, bus } = ses;
    for (const u of units) {
      const mine = u === act;
      controlUnit(ses, u, dt, mine ? this.controls.state() : IDLE, mine ? this.controls.drive() : IDLE_DRIVE);
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

  dispose() { this.rules?.dispose(); }
}
