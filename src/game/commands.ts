import { toggleOutriggers } from '../crane/ops';
import { outriggersLocked, toggleBallast, toggleMount, toggleYGuy } from '../crane/assembly';
import type { Cmd } from './record';
import { inZone } from '../levels/setup';
import type { Session } from './session';
import { t } from '../i18n';

const m = t.msg;

/**
 * Acciones de un toque sobre la simulación (fase 15: antes en ui/commands.ts, se aplicaban al pulsar). Se aplican al
 * empezar un paso (`GameStep`), así quedan en la grabación de ese paso. Solo con la grúa de pie; los avisos, por el bus.
 */
/** Todo el lastre (cargas 'ballast') está quieto dentro de su zona */
export function ballastDelivered(ses: Session) {
  const L = ses.L!, z = L.zones.find((q) => q.label === L.ballastZone);
  const phys = ses.units[0].phys;
  return !!z && phys.loads.filter((l) => l.kind === 'ballast').every((l) => { const p = phys.placed(l); return !!p && inZone(p, z); });
}

export function runCommand(ses: Session, cmd: Cmd) {
  const { bus, L, multi } = ses;
  const say = (text: string, s?: number) => bus.emit('say', { text, s });
  if (cmd === 'switch') {
    if (!multi) return;
    const u = ses.switchUnit();
    bus.emit('switch', { unit: u.i });
    say(m.switched(u.T.name, ses.tipped()), 2);
    return;
  }
  if (cmd === 'bypass') {
    if (L || ses.lesson) { say(m.noBypass, 2); return; }
    ses.bypass = !ses.bypass;
    say(ses.bypass ? m.bypassOn : m.bypassOff, 2.5);
    return;
  }
  if (cmd === 'checklist') {
    // fase 23: la lista de chequeo hecha (la confirma el panel): vale para el próximo izaje
    if (ses.L?.checklist) { ses.run.checked = 1; say(m.checkDone, 2); }
    return;
  }
  if (!ses.live()) return;
  const { T, S, C, phys, pose, jibOk } = ses.act;
  switch (cmd) {
    case 'hook': say(phys.toggleHook()); break;
    // X es una ayuda de prueba: solo en la prueba libre
    case 'reset': say(L ? m.noReset : phys.resetLoads()); break;
    case 'outriggers':
      say(toggleOutriggers(T, C, S, { loadHanging: ses.hanging(), padsBlocked: phys.padsBlocked(S), locked: outriggersLocked(S) }), 1.8);
      break;
    case 'ballast':
      // fase 24: el lastre tiene que estar entregado en su zona (lo descarga la grúa auxiliar)
      if (L?.ballastZone && !S.cwT && !ballastDelivered(ses)) { say(m.ballastMissing, 3); return; }
      say(toggleBallast(T, S, { loadHanging: ses.hanging(), tailBlocked: phys.tailBlocked(S, S.slew, 1) }), 1.8); break;
    case 'yguy': say(toggleYGuy(T, S, { loadHanging: ses.hanging() }), 2.2); break;
    case 'mount':
      if (phys.tied) { say(m.untieFirst, 2); return; }
      if (T.jibDef && !jibOk) { say(multi ? m.noJibTandem : m.noJib, 2); return; }
      say(toggleMount(T, S, { loadAttached: !!phys.attached, groundBlocked: phys.jibGroundBlocked(S, pose) }), 2.4);
      break;
  }
}
