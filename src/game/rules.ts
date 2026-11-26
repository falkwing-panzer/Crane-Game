import { FIXED_DT } from '../physics/world';
import { apply } from '../crane/pose';
import { boomFoot, headPos } from '../crane/kinematics';
import { allPlaced } from '../levels/setup';
import { OVER_T, ROLL_MAX, SIDE_LOAD, SIDE_MAX, SIDE_T, SIDE_WARN, rollOf } from '../levels/tandemSetup';
import { HARD_LANDING, LANDING_MIN, LINE_WARN, lineMargin, windArea, windForce } from '../levels/rules';
import type { Level } from '../levels/levels';
import { saveRecord, stars } from '../ui/levelUi';
import type { Failure } from './events';
import { smoothScore } from './smooth';
import { saveJobRecord, saveSmooth } from '../ui/progress';
import { EXCL_T, overWorker } from '../levels/people';
import { axleLoad } from '../crane/axles';
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
    // fase 24: las cargas de los camiones que llegan más tarde esperan fuera, sin chocar con nada
    // (los que ya están en su muelle al empezar cuentan como entrados)
    (L.trucks ?? []).forEach((tk, i) => {
      if (tk.at > 0) ses.units[0].phys.loads[tk.crate].body.setEnabled(false);
      else ses.run.tDone |= 1 << i;
    });
  }

  /** Reloj de la comprobación de victoria (instantáneas, fase 15) */
  get winClock() { return this.winCheck; }
  set winClock(v: number) { this.winCheck = v; }

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
    // suavidad (fase 22): medalla aparte, en su propia clave; las estrellas y los récords no cambian
    const sm = smoothScore(run), job = ses.def.job;
    // trabajos con obra propia (reto diario, contratos): récord aparte; la suavidad se guarda solo en los niveles
    const smoothBest = !job && !!sm && saveSmooth(ses.def.li, sm.score);
    const record = job ? saveJobRecord(job.key, n, run.t) : saveRecord(ses.def.li, n, run.t);
    ses.bus.emit('end', { fail: null, stars: n, record, smooth: sm, smoothBest });
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
    if (L.trucks) this.trucks(dt);
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
    if (!this.people()) return false;
    if (!this.bridges()) return false;
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
   * Fase 23: trabajadores (zona de exclusión: aviso y alarma al entrar, fallo si la carga sigue encima de alguien más de
   * EXCL_T s), lista de chequeo (cada izaje que despega sin ella resta; en el modo experto, falla) y cesta de personal
   * (LMI ≤ 50 %, balanceo ≤ 5°, ≤ 0,6 m/s y viento ≤ 9 m/s; más de 1 s fuera, falla). Devuelve false si falló.
   */
  private people(): boolean {
    const { ses, L } = this, run = ses.run, dt = FIXED_DT;
    const u = ses.act, a = u.phys.attached;
    if (L.workers?.length) {
      let over = -1;
      if (a) {
        const c = a.body.translation();
        over = overWorker({ x: c.x, z: c.z, r: Math.hypot(a.half.x, a.half.z), bottom: c.y - a.half.y }, L.workers, run.t);
      }
      if (over >= 0) {
        if (!run.inExcl) {
          run.inExcl = true;
          run.excl++;
          ses.bus.emit('prox', {});
          ses.bus.emit('say', { text: tr.excl, s: 2.5 });
        }
        run.exclT += dt;
        if (run.exclT > EXCL_T) { this.finish({ title: tr.exclTitle, text: tr.exclFail }); return false; }
      } else { run.inExcl = false; run.exclT = 0; }
    }
    const hanging = ses.hanging(u);
    if (L.checklist) {
      if (hanging && !run.lifted) {
        if (!run.checked) {
          if (ses.expert) { this.finish({ title: tr.checkTitle, text: tr.checkFail }); return false; }
          run.skips++;
          ses.bus.emit('say', { text: tr.checkSkip, s: 3 });
        }
      } else if (!hanging && run.lifted && !a) run.checked = 0; // soltada: el próximo izaje pide otra lista
    }
    run.lifted = hanging ? 1 : 0;
    if (a?.kind === 'basket' && hanging) {
      // velocidad de subida o bajada (el balanceo tiene su propio límite)
      const sp = Math.abs(a.body.linvel().y);
      const why = u.dyn.lmi > 0.5 ? tr.bkLmi(Math.round(u.dyn.lmi * 100)) : u.sideAng > 5 * Math.PI / 180 ? tr.bkSwing(deg(u.sideAng))
        : sp > 0.6 ? tr.bkSpeed(sp) : run.wind > 9 ? tr.bkWind(run.wind) : null;
      if (why) {
        if (run.bkT === 0) ses.bus.emit('say', { text: why, s: 2 });
        run.bkT += dt;
        if (run.bkT > 1) { this.finish({ title: tr.bkTitle, text: why }); return false; }
      } else run.bkT = 0;
    }
    return true;
  }

  /** Fase 24: con la grúa sobre un puente, la carga por eje no pasa de su límite */
  private bridges(): boolean {
    const { ses, L } = this;
    if (!L.bridges) return true;
    for (const u of ses.units) {
      const q = axleLoad(u.T, u.C);
      if (q === null) continue;
      for (const b of L.bridges) {
        if (Math.abs(u.S.x - b.x) <= b.w / 2 && Math.abs(u.S.z - b.z) <= b.d / 2 && q > b.maxAxle) {
          this.finish({ title: tr.bridgeTitle, text: tr.bridge(u.T.name, q, b.maxAxle) });
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Fase 24: cada camión entra a su hora si su muelle está libre (ninguna carga sobre la caja); su carga, que espera
   * fuera de la obra, pasa a la caja del camión. Mientras espera, el retraso cuenta.
   */
  private trucks(dt: number) {
    const { ses, L } = this, run = ses.run, phys = ses.units[0].phys;
    L.trucks!.forEach((tk, i) => {
      if (run.tDone & (1 << i) || run.t < tk.at) return;
      const bay = L.bays![tk.bay];
      const busy = phys.loads.some((l) => {
        const p = l.body.translation();
        return Math.abs(p.x - bay.x) < 4.5 && Math.abs(p.z - bay.z) < 1.6 && p.y < bay.y + 3.5;
      });
      if (busy) { run.late += dt; return; }
      const l = phys.loads[tk.crate];
      l.body.setTranslation({ x: bay.x, y: bay.y + l.half.y + 0.02, z: bay.z }, true);
      l.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      l.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      l.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      l.body.setEnabled(true);
      run.tDone |= 1 << i;
      if (tk.at > 0) ses.bus.emit('say', { text: tr.truckIn(i + 1, tk.bay + 1), s: 3 });
    });
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
