import { FIXED_DT } from '../physics/world';
import { apply } from '../crane/pose';
import { boomFoot, headPos } from '../crane/kinematics';
import { allPlaced } from '../levels/setup';
import { OVER_T, ROLL_MAX, SIDE_LOAD, SIDE_MAX, SIDE_T, SIDE_WARN, rollOf } from '../levels/tandemSetup';
import { HARD_LANDING, LANDING_MIN, LINE_WARN, lineMargin, windArea, windForce } from '../levels/rules';
import type { Level } from '../levels/levels';
import { saveRecord, stars } from '../ui/levelUi';
import type { Failure } from './events';
import type { Session } from './session';

import { t } from '../i18n';

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const tr = t.rules;

/**
 * Reglas de un nivel (fases 9 y 10): tiempo, victoria, viento, aterrizajes, vidrio roto, golpes, líneas eléctricas,
 * vuelco y los fallos del tándem. Escuchan el bus de la partida y emiten mensajes y el fin del nivel; no tocan el HUD
 * ni el sonido.
 */
export class LevelRules {
  private winCheck = 0;
  private readonly off: (() => void)[] = [];

  constructor(private ses: Session, private L: Level) {
    const { bus } = ses;
    const run = ses.run;
    this.off.push(
      bus.on('land', (e) => {
        if (run.done || e.v < LANDING_MIN) return;
        if (e.fragile && e.v > e.fragile) {
          this.finish({ title: tr.glassTitle, text: tr.glass(e.v, e.fragile) });
          return;
        }
        if (e.v > HARD_LANDING) { run.hard++; bus.emit('say', { text: tr.hard(e.v), s: 2 }); }
        else bus.emit('say', { text: tr.landed(e.v), s: 1.4 });
      }),
      bus.on('strike', (e) => { if (!run.done && e.v > 0.25) this.bump(tr.strike); }),
      bus.on('bump', (e) => this.bump(e.text)),
      // en un nivel, el vuelco es nivel fallido (Repetir vuelve a la ficha)
      bus.on('tipped', (e) => this.finish({ title: tr.tippedTitle, text: e.text })),
    );
  }

  /** Quita los oyentes */
  dispose() { for (const f of this.off) f(); }

  /** Termina el turno: fallo o victoria (con estrellas y récord) */
  finish(fail: Failure) {
    const { ses, L } = this, run = ses.run;
    if (run.done) return;
    run.done = true;
    ses.running = false;
    if (fail) { ses.bus.emit('end', { fail }); return; }
    const n = stars(L, run);
    ses.bus.emit('end', { fail: null, stars: n, record: saveRecord(ses.def.li, n, run.t) });
  }

  /** Golpe (strike de la referencia): cuenta para las estrellas, uno por segundo como mucho */
  private bump(text: string) {
    const run = this.ses.run;
    if (run.done || run.bumpCd > 0) return;
    run.bumps++;
    run.bumpCd = 1;
    this.ses.bus.emit('say', { text, s: 2 });
  }

  /** Antes del paso: reloj, victoria (checkWin) y viento. Devuelve false si el nivel terminó. */
  before(dt: number): boolean {
    const { ses, L } = this, run = ses.run, units = ses.units;
    const { phys } = units[0];
    run.t += dt;
    if (L.time && run.t > L.time) {
      this.finish({ title: tr.timeTitle, text: tr.time });
      return false;
    }
    // checkWin: cada 0,25 s, sin nada enganchado, todas las cargas sueltas y quietas en una zona
    if ((this.winCheck += dt) >= 0.25 && !ses.tipped(units[0])) {
      this.winCheck = 0;
      if (units.every((u) => !u.phys.attached) && allPlaced(phys.loads.map((l) => phys.placed(l)), L.zones)) { this.finish(null); return false; }
    }
    run.bumpCd = Math.max(0, run.bumpCd - dt);
    // viento sobre la carga enganchada o el gancho (step de la referencia); tándem: lo pone una sola grúa
    for (const u of units) {
      const a = u.phys.attached;
      const w = windForce(L, run.t, windArea(a ? { w: 2 * a.half.x, d: 2 * a.half.z, h: 2 * a.half.y } : null));
      run.wind = w.v;
      u.phys.wind = { x: w.x, z: w.z };
    }
    return true;
  }

  /**
   * Después del paso de física (con los aterrizajes y golpes ya emitidos): tándem y distancia a las líneas eléctricas
   * (los niveles con líneas tienen una sola grúa). Devuelve false si el nivel terminó.
   */
  after(): boolean {
    const { ses, L } = this, run = ses.run;
    if (run.done) return false;
    if (L.tandem && !this.tandem()) return false;
    if (!L.lines?.length || ses.tipped(ses.units[0])) return true;
    const { T, S, phys, pose } = ses.units[0];
    const hk = phys.hookBody.translation(), a = phys.attached;
    let load;
    if (a) {
      const c = a.body.translation();
      load = { bottom: { x: c.x, y: c.y - a.half.y, z: c.z }, top: { x: c.x, y: c.y + a.half.y, z: c.z }, r: Math.hypot(a.half.x, a.half.z) };
    }
    run.lineD = lineMargin(L.lines, {
      foot: apply(pose, boomFoot(T, S)), head: apply(pose, headPos(T, S)), tip: phys.headWorld(),
      hook: { x: hk.x, y: hk.y, z: hk.z }, load,
    });
    if (run.lineD < LINE_WARN) {
      if (!run.inProx) {
        run.prox++;
        run.inProx = true;
        ses.bus.emit('prox', {});
        ses.bus.emit('say', { text: tr.prox, s: 2.5 });
      }
    } else run.inProx = false;
    if (run.lineD < 0) {
      this.finish({ title: tr.lineTitle, text: tr.line });
      return false;
    }
    return true;
  }

  /**
   * Fallos del nivel de tándem (fase 10, no están en la referencia): una grúa con el LMI por encima del 100 % más de
   * 0,5 s; un cable que lleva carga a más de 6° de la vertical más de 1 s (tiro lateral sobre la pluma); la columna
   * ladeada más de 10° sobre su eje largo; un gancho contra su cabeza (doble bloqueo). Devuelve false si falló.
   */
  private tandem(): boolean {
    const { ses } = this;
    const dt = FIXED_DT;
    for (const u of ses.units) {
      if (ses.tipped(u)) continue;
      const { T, phys } = u;
      u.over = u.dyn.lmi > 1 ? u.over + dt : 0;
      if (u.over > OVER_T) {
        this.finish({ title: tr.overTitle, text: tr.over(T.name, Math.round(u.dyn.lmi * 100)) });
        return false;
      }
      const share = phys.slingShare();
      if (share !== null && share > SIDE_LOAD) {
        if (u.sideAng > SIDE_WARN) ses.bus.emit('say', { text: tr.sideWarn(deg(u.sideAng)), once: true, unit: u.i });
        u.side = u.sideAng > SIDE_MAX ? u.side + dt : 0;
        if (u.side > SIDE_T) {
          this.finish({ title: tr.sideTitle, text: tr.side(T.name, deg(u.sideAng)) });
          return false;
        }
      } else u.side = 0;
      if (phys.attached && phys.twoBlocked()) {
        this.finish({ title: tr.twoBlockTitle, text: tr.twoBlock(T.name) });
        return false;
      }
    }
    const col = ses.units[0].phys.loads[0];
    if (col && rollOf(col.body.rotation()) > ROLL_MAX) {
      this.finish({ title: tr.rollTitle, text: tr.roll(deg(rollOf(col.body.rotation()))) });
      return false;
    }
    return true;
  }
}
