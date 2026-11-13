import './style.css';
import { bootError, bootStage, nextPaint } from './ui/boot';
import { t } from './i18n';

/**
 * Arranque. Este archivo es pequeño a propósito (fase 14): sale enseguida, muestra las etapas de la carga y trae el
 * resto del juego con import() — three.js, los modelos y Rapier, cuyo .wasm baja en paralelo como archivo aparte.
 *
 * Piezas (fase 14): `App` (app.ts) dura toda la visita y monta o cambia la partida sin recargar; la partida
 * (`Session`) tiene las grúas y emite eventos por su bus; `GameStep` da los pasos fijos (mandos, física, reglas del
 * nivel); `Presenter` dibuja, muestra el HUD y suena; `bindCommands` conecta las teclas; `Loop` reparte el tiempo y
 * se pausa solo (`autoPause`).
 */
async function start() {
  bootStage(t.boot.engine, 0.3);
  const { App, initPhysics } = await import('./app');
  bootStage(t.boot.physics, 0.55);
  await nextPaint();
  await initPhysics();
  bootStage(t.boot.scene, 0.8);
  await nextPaint();
  const app = new App(document.getElementById('c') as HTMLCanvasElement, document.getElementById('hud')!);
  await app.open(location.search);
  app.loop.start();

  // Acceso para depurar desde la consola del navegador
  // advance(s): avanza la simulación s segundos sin depender de requestAnimationFrame (pruebas con la pestaña oculta)
  // S, C, T, phys, crane, dyn, pose y cut son los de la grúa que se maneja; units, todas.
  if (import.meta.env.DEV) {
    const FIXED_DT = 1 / 60;
    const cur = () => app.cur!;
    Object.assign(window, {
      __gruas: {
        app, ctx: app.ctx, input: app.input, loop: app.loop, sound: app.sound,
        get ses() { return cur().ses; }, get game() { return cur().game; }, get view() { return cur().view; },
        get hud() { return cur().view.hud; }, get cam() { return cur().view.cam; }, get lui() { return cur().view.lui; },
        get L() { return cur().ses.L; }, get run() { return cur().ses.run; }, get units() { return cur().ses.units; },
        get bus() { return cur().ses.bus; },
        get S() { return cur().ses.act.S; }, get C() { return cur().ses.act.C; }, get T() { return cur().ses.act.T; },
        get phys() { return cur().ses.act.phys; }, get crane() { return cur().ses.act.crane; }, get act() { return cur().ses.act; },
        /** empieza el turno sin pulsar el botón de la ficha */
        start() { cur().view.lui.close(); cur().ses.running = true; },
        get running() { return cur().ses.running; },
        get dyn() { return cur().ses.act.dyn; }, get pose() { return cur().ses.act.pose; }, get cut() { return cur().ses.act.cut; },
        advance(s: number) {
          const c = cur();
          for (let i = 0; i < Math.round(s / FIXED_DT); i++) c.game.tick(FIXED_DT);
          c.view.draw(FIXED_DT, 0, app.input.state(), app.loop.paused);
        },
        /** ir a otra partida sin recargar (como un enlace del juego) */
        go: (search: string) => app.go(search),
      },
    });
  }
}

start().catch((err) => {
  console.error(err);
  if (!bootError(err)) document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:40%;left:20px;color:#b00">${String(err)}</pre>`);
});
