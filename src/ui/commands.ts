import type { Session } from '../game/session';
import type { GameStep } from '../game/step';
import type { Cmd } from '../game/record';
import type { Presenter } from './presenter';
import type { Input } from './input';
import { saveSettings, type Settings } from './settings';
import { saveGame } from './savegame';
import { t } from '../i18n';

const m = t.msg;

/**
 * Entrada (fase 14: sacada de main.ts): qué hace cada tecla o botón de un toque. Fase 15: las acciones que cambian la
 * simulación (Espacio, O, B, Y, M, X, P, Tab) no se aplican al pulsar: entran en el paso siguiente (`GameStep.push`),
 * así quedan grabadas. La cámara, el sonido, la ayuda, rebobinar y guardar no son de la simulación.
 */
export function bindCommands(ses: Session, game: GameStep, input: Input, view: Presenter, settings: Settings, paused: () => boolean) {
  const { bus, L } = ses;
  const say = (text: string, s?: number) => bus.emit('say', { text, s });
  const { help, hud, cam, sound } = view;
  const push = (c: Cmd) => () => { if (!paused()) game.push(c); };

  help.onToggle = (open) => input.pause(open);
  input.onHelp = () => help.toggle();
  input.onEscape = () => help.toggle(false);

  input.onHook = push('hook');
  input.onReset = push('reset');
  input.onOutriggers = push('outriggers');
  input.onBallast = push('ballast');
  input.onYGuy = push('yguy');
  input.onMount = push('mount');
  input.onBypass = push('bypass');
  input.onSwitch = push('switch');
  input.onMute = () => {
    settings.sonido = sound.toggle();
    saveSettings(settings);
    say(settings.sonido ? m.soundOn : m.soundOff, 1.5);
  };
  input.onPad = (id) => say(m.pad(id.replace(/\s*\(.*$/, '')), 2.5);
  input.onView = () => say(cam.cycle(ses.act.S, ses.act.pose), 1.5);
  // rebobinar 10 s (fase 15): solo en la prueba libre; no cuenta para nada
  input.onRewind = () => {
    if (paused() || !ses.running) return;
    if (L) { say(m.noRewind, 2); return; }
    const s = game.rewind();
    if (s > 0) say(m.rewound(s), 1.5);
  };
  hud.onRestart = () => game.restart();
  // guardar a mitad de un nivel (fase 15)
  view.lui.onSave = () => {
    if (!L || !ses.running || ses.run.done) return;
    say(saveGame(ses, game) ? m.saved : m.saveFailed, 3);
  };
}
