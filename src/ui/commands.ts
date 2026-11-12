import { toggleOutriggers } from '../crane/ops';
import { outriggersLocked, toggleBallast, toggleMount, toggleYGuy } from '../crane/assembly';
import type { Session } from '../game/session';
import type { Presenter } from './presenter';
import type { Input } from './input';
import { saveSettings, type Settings } from './settings';

/**
 * Entrada (fase 14: sacada de main.ts): qué hace cada tecla o botón de un toque. Las acciones sobre la grúa solo
 * cuentan con el turno en marcha, la grúa de pie y el juego sin pausa; los avisos salen por el bus.
 */
export function bindCommands(ses: Session, input: Input, view: Presenter, settings: Settings, paused: () => boolean) {
  const { bus, L, multi } = ses;
  const say = (text: string, s?: number) => bus.emit('say', { text, s });
  const live = () => ses.live() && !paused();
  const { help, hud, cam, sound } = view;

  help.onToggle = (open) => input.pause(open);
  input.onHelp = () => help.toggle();
  input.onEscape = () => help.toggle(false);

  input.onHook = () => { if (live()) say(ses.act.phys.toggleHook()); };
  // X y P son ayudas de prueba: solo en la prueba libre
  input.onReset = () => { if (live()) say(L ? 'En los niveles no se puede reponer la carga (X): solo en la prueba libre' : ses.act.phys.resetLoads()); };
  input.onOutriggers = () => {
    const { T, C, S, phys } = ses.act;
    if (live()) say(toggleOutriggers(T, C, S, { loadHanging: ses.hanging(), padsBlocked: phys.padsBlocked(S), locked: outriggersLocked(S) }), 1.8);
  };
  input.onBallast = () => {
    const { T, S, phys } = ses.act;
    if (live()) say(toggleBallast(T, S, { loadHanging: ses.hanging(), tailBlocked: phys.tailBlocked(S, S.slew, 1) }), 1.8);
  };
  input.onYGuy = () => { if (live()) say(toggleYGuy(ses.act.T, ses.act.S, { loadHanging: ses.hanging() }), 2.2); };
  input.onMount = () => {
    if (!live()) return;
    const { T, S, phys, pose, jibOk } = ses.act;
    if (phys.tied) { say('Suelta primero el gancho del frente (Espacio)', 2); return; }
    if (T.jibDef && !jibOk) { say(multi ? 'En el tándem no se monta el plumín' : 'En este trabajo no hace falta el plumín', 2); return; }
    say(toggleMount(T, S, { loadAttached: !!phys.attached, groundBlocked: phys.jibGroundBlocked(S, pose) }), 2.4);
  };
  input.onMute = () => {
    settings.sonido = sound.toggle();
    saveSettings(settings);
    say(settings.sonido ? 'Sonido activado (N)' : 'Sonido apagado (N)', 1.5);
  };
  input.onPad = (id) => say(`Mando conectado: ${id.replace(/\s*\(.*$/, '')}`, 2.5);
  input.onView = () => say(cam.cycle(ses.act.S, ses.act.pose), 1.5);
  input.onBypass = () => {
    if (L) { say('El puenteo del LMI (P) solo está en la prueba libre', 2); return; }
    ses.bypass = !ses.bypass;
    say(ses.bypass ? 'LMI PUENTEADO: sin cortes, la grúa puede volcar' : 'LMI activo de nuevo', 2.5);
  };
  input.onSwitch = () => {
    if (!multi || !ses.running) return;
    const u = ses.switchUnit();
    view.follow(u);
    say(`Manejas la ${u.T.name}${ses.tipped() ? ' (volcada)' : ''} · la otra se queda quieta`, 2);
  };
  hud.onRestart = () => ses.restart();
}
