import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { createScene } from './render/scene';
import { loadSettings } from './ui/settings';
import { FIXED_DT } from './physics/world';
import { Input } from './ui/input';
import { bootError, bootStage, nextPaint } from './ui/boot';
import { Session, sessionDef } from './game/session';
import { GameStep } from './game/step';
import { Loop } from './game/loop';
import { Presenter } from './ui/presenter';
import { bindCommands } from './ui/commands';
import { autoPause } from './ui/autoPause';

/**
 * Arranque (fase 14): arma las piezas y las conecta. La partida (`Session`) tiene las grúas y emite eventos por su
 * bus; `GameStep` da los pasos fijos (mandos, física, reglas del nivel); `Presenter` dibuja, muestra el HUD y suena;
 * `bindCommands` conecta las teclas; `Loop` reparte el tiempo y se pausa solo (`autoPause`).
 */
async function start() {
  // el JS ya bajó: quedan la física (wasm), la escena y el primer cuadro
  bootStage('iniciando la física', 0.55);
  await nextPaint();
  await RAPIER.init();
  bootStage('armando la escena', 0.8);
  await nextPaint();

  const settings = loadSettings();
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const root = document.getElementById('hud')!;
  const ctx = createScene(canvas, settings.calidad);
  const ses = new Session(sessionDef(location.search), ctx.scene);
  const input = new Input();
  const game = new GameStep(ses, input);
  const view = new Presenter(ctx, ses, settings, root);
  const loop = new Loop((dt) => game.tick(dt), (dt, physMs) => view.draw(dt, physMs, input.state(), loop.paused), FIXED_DT);
  loop.onFrame = () => input.poll(); // mando (fase 11)
  bindCommands(ses, input, view, settings, () => loop.paused);
  autoPause(loop, canvas, root, (on) => input.block('pausa', on), () => ses.running);
  loop.start();

  // Acceso para depurar desde la consola del navegador
  // advance(s): avanza la simulación s segundos sin depender de requestAnimationFrame (pruebas con la pestaña oculta)
  // S, C, T, phys, crane, dyn, pose y cut son los de la grúa que se maneja; units, todas.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __gruas: {
        ctx, input, ses, game, loop, view, hud: view.hud, cam: view.cam, L: ses.L, lui: view.lui, run: ses.run, units: ses.units, sound: view.sound,
        bus: ses.bus,
        get S() { return ses.act.S; }, get C() { return ses.act.C; }, get T() { return ses.act.T; }, get phys() { return ses.act.phys; },
        get crane() { return ses.act.crane; }, get act() { return ses.act; },
        /** empieza el turno sin pulsar el botón de la ficha */
        start() { view.lui.close(); ses.running = true; },
        get running() { return ses.running; },
        get dyn() { return ses.act.dyn; }, get pose() { return ses.act.pose; }, get cut() { return ses.act.cut; },
        advance(s: number) {
          for (let i = 0; i < Math.round(s / FIXED_DT); i++) game.tick(FIXED_DT);
          view.draw(FIXED_DT, 0, input.state(), loop.paused);
        },
      },
    });
  }
}

start().catch((err) => {
  console.error(err);
  if (!bootError(err)) document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:40%;left:20px;color:#b00">${String(err)}</pre>`);
});
