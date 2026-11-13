import { toggleOutriggers } from '../crane/ops';
import { outriggersLocked, toggleBallast, toggleMount, toggleYGuy } from '../crane/assembly';
import type { Cmd } from './record';
import type { Session } from './session';
import { t } from '../i18n';

const m = t.msg;

/**
 * Acciones de un toque sobre la simulación (fase 15: antes en ui/commands.ts, se aplicaban al pulsar). Se aplican al
 * empezar un paso (`GameStep`), así quedan en la grabación de ese paso. Solo con la grúa de pie; los avisos, por el bus.
 */
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
    if (L) { say(m.noBypass, 2); return; }
    ses.bypass = !ses.bypass;
    say(ses.bypass ? m.bypassOn : m.bypassOff, 2.5);
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
    case 'ballast': say(toggleBallast(T, S, { loadHanging: ses.hanging(), tailBlocked: phys.tailBlocked(S, S.slew, 1) }), 1.8); break;
    case 'yguy': say(toggleYGuy(T, S, { loadHanging: ses.hanging() }), 2.2); break;
    case 'mount':
      if (phys.tied) { say(m.untieFirst, 2); return; }
      if (T.jibDef && !jibOk) { say(multi ? m.noJibTandem : m.noJib, 2); return; }
      say(toggleMount(T, S, { loadAttached: !!phys.attached, groundBlocked: phys.jibGroundBlocked(S, pose) }), 2.4);
      break;
  }
}
