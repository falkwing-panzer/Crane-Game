import { HARD_LANDING } from '../levels/rules';
import { ALL_LEVELS } from '../levels/tandemSetup';
import { LESSONS } from '../school/lessons';
import { loadRecords } from '../ui/levelUi';
import { loadSchool } from '../ui/schoolUi';
import { hasStorage, loadAchievements, loadSmooth, loadStats, saveAchievements, saveStats } from '../ui/progress';
import { newAchievements, type AchEvent } from './achievements';
import type { Session } from './session';

/** Cada cuánto se miran los logros que dependen de lo acumulado (horas, km) y se guarda (s) */
const CHECK_EVERY = 5, SAVE_EVERY = 30;
/** Un golpe de costado cuenta como mucho uno por segundo (como las reglas) */
const BUMP_CD = 1;

interface Hang { on: boolean; m: number; bumped: boolean; jib: boolean; sl: boolean }

/**
 * Estadísticas y logros de una partida (fase 22). Cuenta lo que hizo el jugador **de verdad**: no va en las
 * instantáneas, así que rebobinar o reiniciar no resta nada. Lo acumulado se guarda al terminar el turno, cada 30 s,
 * al desmontar la partida y al cerrar la pestaña (`flush`). Con un guion (`live` = false: banco, pruebas) no cuenta.
 * Los logros nuevos salen por el bus (`achievement`).
 */
export class StatsTracker {
  readonly st = loadStats();
  private have = loadAchievements();
  private hang: Hang[];
  private glassMax = 0;
  private bumpCd = 0;
  private checkT = 0;
  private saveT = 0;
  private dirty = false;
  private readonly off: (() => void)[] = [];

  constructor(private ses: Session, private live: () => boolean) {
    this.hang = ses.units.map(() => ({ on: false, m: 0, bumped: false, jib: false, sl: false }));
    const { bus } = ses;
    this.off.push(
      bus.on('strike', (e) => { if (e.v > 0.25) this.bump(); }),
      bus.on('bump', () => this.bump()),
      bus.on('land', (e) => {
        if (!this.live()) return;
        if (e.fragile) this.glassMax = Math.max(this.glassMax, e.v);
        if (e.v > HARD_LANDING) { this.st.hard++; this.dirty = true; }
      }),
      bus.on('tipping', () => {
        if (!this.live()) return;
        this.st.tips++;
        this.dirty = true;
        this.check({ kind: 'tip', bypass: ses.bypass });
      }),
      bus.on('end', (e) => {
        if (!this.live()) return;
        if (!e.fail && ses.L) {
          this.st.levels++;
          this.dirty = true;
          const L = ses.L, run = ses.run;
          this.check({
            kind: 'win', li: ses.def.li, t: run.t, par: L.par, maxLmi: run.maxLmi,
            glass: L.crates.some((c) => c.fragile), glassMax: this.glassMax, smooth: e.smooth?.score ?? null,
          });
        }
        this.flush();
      }),
      bus.on('lessonDone', () => this.check({ kind: 'tick' })),
      bus.on('restart', () => { this.glassMax = 0; }),
      bus.on('restored', () => { this.glassMax = 0; }),
    );
  }

  private bump() {
    if (!this.live() || this.bumpCd > 0) return;
    this.bumpCd = BUMP_CD;
    this.st.bumps++;
    this.dirty = true;
    for (const h of this.hang) if (h.on) h.bumped = true;
  }

  /** Un paso con el turno en marcha */
  step(dt: number) {
    if (!this.live()) return;
    const { ses, st } = this;
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    const act = ses.act;
    if (!ses.tipped(act)) st.secs[act.id] = (st.secs[act.id] ?? 0) + dt;
    for (const u of ses.units) {
      const d = Math.abs(u.S.vd) * dt;
      st.meters += d;
      if (u.phys.tied) st.tiedMeters += d;
      const h = this.hang[u.i], on = ses.hanging(u) && !ses.tipped(u);
      if (on) {
        if (!h.on) Object.assign(h, { on: true, m: 0, bumped: false, jib: false, sl: false });
        h.m = Math.max(h.m, ses.loadOnHook(u));
        h.jib ||= !!u.C.jib;
        h.sl ||= !!u.T.superlift && u.C.slR >= u.T.superlift.rMax - 0.1;
      } else if (h.on) this.liftDone(h);
    }
    this.dirty = true;
    if ((this.checkT += dt) >= CHECK_EVERY) { this.checkT = 0; this.check({ kind: 'tick' }); }
    if ((this.saveT += dt) >= SAVE_EVERY) this.flush();
  }

  private liftDone(h: Hang) {
    const st = this.st;
    h.on = false;
    st.lifts++;
    st.tons += h.m;
    st.heaviest = Math.max(st.heaviest, h.m);
    st.clean = h.bumped ? 0 : st.clean + 1;
    st.bestClean = Math.max(st.bestClean, st.clean);
    this.check({ kind: 'lift', mass: h.m, jib: h.jib, slMax: h.sl });
  }

  /** Mira los logros con lo que acaba de pasar; los nuevos se guardan y salen por el bus */
  check(ev: AchEvent) {
    const ids = newAchievements({
      st: this.st, ...(hasStorage() ? { rec: loadRecords(), smooth: loadSmooth(), school: loadSchool() } : { rec: {}, smooth: {}, school: [] }),
      nLevels: ALL_LEVELS.length, nLessons: LESSONS.length, ev,
    }, this.have);
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) this.have[id] = now;
    saveAchievements(this.have);
    for (const id of ids) this.ses.bus.emit('achievement', { id });
  }

  /** Guarda lo acumulado */
  flush() {
    this.saveT = 0;
    if (!this.dirty) return;
    this.dirty = false;
    saveStats(this.st);
  }

  dispose() {
    this.flush();
    for (const f of this.off) f();
  }
}
