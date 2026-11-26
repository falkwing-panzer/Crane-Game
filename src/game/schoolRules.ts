import { LANDING_MIN, windArea, windForce } from '../levels/rules';
import type { Lesson, SchoolView } from '../school/lessons';
import type { Session } from './session';
import { t } from '../i18n';

const ts = t.school;

/**
 * Reglas de una lección de la escuela (fase 19). Como `LevelRules`, pero sin fallos, estrellas ni récords: el
 * viento de la obra, el aviso al apoyar la carga y los pasos de la lección. Después de cada paso de física arma lo
 * que miran los pasos (`SchoolView`) y, si se cumple el objetivo del paso actual, pasa al siguiente; al terminar el
 * último, para el turno y emite `lessonDone`. El progreso vive en `ses.sch`, que va en las instantáneas (rebobinar).
 * Si la grúa vuelca no hay cartel de lección fallida: sale el de la prueba libre, con Reiniciar, y se puede rebobinar.
 */
export class SchoolRules {
  private readonly off: (() => void)[] = [];

  constructor(private ses: Session, private lesson: Lesson) {
    const { bus } = ses;
    this.off.push(
      bus.on('land', (e) => {
        const sch = ses.sch!;
        if (e.fragile && e.v > e.fragile) {
          sch.hard = true;
          bus.emit('say', { text: ts.tooFast(e.v), s: 4 });
        } else if (e.v >= LANDING_MIN) bus.emit('say', { text: ts.landed(e.v), s: 1.4 });
      }),
    );
  }

  /** Reloj de victoria de los niveles (no hay): para la instantánea */
  get winClock() { return 0; }
  set winClock(_: number) { /* nada */ }

  dispose() { for (const f of this.off) f(); }

  /** Antes del paso: reloj y viento sobre la carga enganchada o el gancho */
  before(dt: number): boolean {
    const { ses, lesson } = this, run = ses.run;
    run.t += dt;
    for (const u of ses.units) {
      const a = u.phys.attached;
      const w = windForce(lesson.site, run.t, windArea(a ? { w: 2 * a.half.x, d: 2 * a.half.z, h: 2 * a.half.y } : null));
      run.wind = w.v;
      u.phys.wind = { x: w.x, z: w.z };
    }
    return true;
  }

  /** Lo que miran los pasos, desde la grúa y la física */
  view(): SchoolView {
    const { ses } = this, u = ses.act, { phys } = u, sch = ses.sch!;
    return {
      S: u.S, lmi: u.dyn.lmi, cut: u.cut, views: sch.views, hard: sch.hard,
      head: phys.headWorld(),
      attached: phys.attached?.label ?? null,
      loads: phys.loads.map((l) => ({ label: l.label, p: phys.footprint(l), resting: phys.isResting(l) })),
    };
  }

  /** Después del paso de física: ¿se cumplió el objetivo del paso? */
  after(): boolean {
    const { ses, lesson } = this, sch = ses.sch!;
    if (sch.done || ses.tipped()) return true;
    const v = this.view();
    // la caja de vidrio vuelve a estar en el aire: se puede intentar otra vez
    const a = ses.act.phys.attached;
    if (sch.hard && a && !ses.act.phys.isResting(a) && v.loads.find((l) => l.label === a.label)!.p.bottom > 0.3) sch.hard = false;
    const st = lesson.steps[sch.step];
    if (!st || !st.done(v, lesson)) return true;
    sch.step++;
    if (sch.step < lesson.steps.length) {
      ses.bus.emit('say', { text: ts.stepDone, s: 1.2 });
      return true;
    }
    sch.done = true;
    ses.running = false;
    ses.bus.emit('lessonDone', { n: lesson.n });
    return false;
  }
}
