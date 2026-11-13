import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createScene, resetView, type SceneCtx } from './render/scene';
import { SceneMark } from './render/dispose';
import { loadSettings, type Settings } from './ui/settings';
import { FIXED_DT } from './physics/world';
import { Input } from './ui/input';
import { nextPaint } from './ui/boot';
import { Session, sessionDef, type SessionDef } from './game/session';
import { GameStep } from './game/step';
import { Loop } from './game/loop';
import { Presenter } from './ui/presenter';
import { bindCommands } from './ui/commands';
import { autoPause } from './ui/autoPause';
import { Sound } from './ui/audio';
import { loadModels, type ModelFactory } from './render/models/load';
import { CRANES } from './crane/cranes';

/** Una partida montada: lo que hay que desmontar al cambiar de nivel o de grúa */
interface Mounted {
  ses: Session;
  game: GameStep;
  view: Presenter;
  /** Contenedor de su HUD dentro de #hud */
  el: HTMLElement;
  /** Lo que añadió a la escena */
  mark: SceneMark;
}

/**
 * Inicia Rapier. El paquete compat (pruebas en Node) trae init(); el del navegador (fase 14: .wasm aparte, con
 * vite-plugin-wasm) ya llega iniciado al importarlo y no lo tiene.
 */
export async function initPhysics() {
  const r = RAPIER as unknown as { init?: () => Promise<void> };
  if (typeof r.init === 'function') await r.init();
}

/**
 * La aplicación (fase 14): lo que dura toda la visita (renderer y escena base, teclado y mando, sonido, bucle,
 * pausa automática) y la partida montada, que se cambia sin recargar la página: se desmonta (física, objetos y
 * memoria de la GPU, HUD, oyentes) y se monta la nueva. La URL se actualiza con history, así que los enlaces y el
 * botón Atrás siguen sirviendo. Solo cambiar la calidad recarga (el antialias es del contexto WebGL).
 */
export class App {
  readonly ctx: SceneCtx;
  readonly input = new Input();
  readonly sound: Sound;
  readonly loop: Loop;
  readonly settings: Settings;
  private root: HTMLElement;
  cur: Mounted | null = null;
  /** Número de la última apertura pedida (dos clics seguidos: gana la última) */
  private seq = 0;
  /** Cambios de partida hechos (pruebas de memoria) */
  opened = 0;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.ctx = createScene(canvas, this.settings.calidad);
    this.sound = new Sound(this.settings.sonido, this.settings.volumen);
    this.loop = new Loop((dt) => this.cur?.game.tick(dt), (dt, physMs) => this.draw(dt, physMs), FIXED_DT);
    this.loop.onFrame = () => this.input.poll(); // mando (fase 11)
    autoPause(this.loop, canvas, root, (on) => this.input.block('pausa', on), () => !!this.cur?.ses.running);

    // Enlaces internos (menú, ficha, carteles, "☰ Niveles"): sin recargar
    root.addEventListener('click', (e) => {
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname !== location.pathname) return;
      e.preventDefault();
      void this.go(u.search);
    });
    addEventListener('popstate', () => { void this.open(location.search); });
  }

  private draw(dt: number, physMs: number) {
    const c = this.cur;
    if (c) c.view.draw(dt, physMs, this.input.state(), this.loop.paused);
  }

  /** Ir a otra partida (?nivel=…, ?grua=…, menú): la añade al historial y la monta */
  go(search: string) {
    const url = location.pathname + (search && search !== '?' ? search : '');
    if (url !== location.pathname + location.search) history.pushState(null, '', url);
    return this.open(location.search);
  }

  /** Monta la partida de esta URL (desmonta la anterior). La primera vez la tapa la pantalla de carga. */
  async open(search: string) {
    const my = ++this.seq;
    this.unmount();
    const note = this.opened > 0 ? this.loading() : null;
    try {
      if (note) await nextPaint();
      if (my !== this.seq) return;
      const def = sessionDef(search);
      const make = await loadModels(def.ids.map((id) => CRANES[id]));
      if (my !== this.seq) return;
      const m = this.mount(def, make);
      await this.warmUp(m);
      // mientras se compilaba se pidió otra partida: esta ya no vale
      if (my !== this.seq) { this.release(m); return; }
      this.cur = m;
      this.opened++;
      // partida lista (antes del primer cuadro): performance.getEntriesByName('gruas-partida')
      performance.mark('gruas-partida');
    } finally {
      note?.remove();
    }
  }

  /** Aviso mientras se arma la partida nueva (tapa la escena vacía) */
  private loading() {
    const el = document.createElement('div');
    el.className = 'switching';
    el.textContent = 'Cargando…';
    document.body.appendChild(el);
    return el;
  }

  /** Arma la partida (sin hacerla actual: el bucle no la toca hasta que tiene los shaders) */
  private mount(def: SessionDef, make: ModelFactory): Mounted {
    const { ctx, input, sound, settings } = this;
    resetView(ctx);
    const mark = new SceneMark(ctx.scene);
    const el = document.createElement('div');
    el.className = 'session';
    this.root.prepend(el);
    const ses = new Session(def, ctx.scene, make);
    const game = new GameStep(ses, input);
    const view = new Presenter(ctx, ses, settings, el, sound, (u) => { void this.go(new URL(u, location.href).search); });
    bindCommands(ses, input, view, settings, () => this.loop.paused);
    return { ses, game, view, el, mark };
  }

  /** Desmonta la partida actual: oyentes, física (Rapier), objetos de la escena y su memoria de GPU, HUD */
  unmount() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.release(c);
  }

  private release(c: Mounted) {
    c.view.dispose();
    c.game.dispose();
    c.ses.bus.clear();
    // la segunda grúa del tándem comparte el mundo: se suelta antes que la que lo creó
    for (const u of [...c.ses.units].reverse()) u.phys.dispose();
    c.mark.release();
    c.el.remove();
    this.input.pause(false); // la ayuda pudo quedar abierta
  }

  /**
   * Shaders precompilados (fase 14): se compilan los de todo lo que hay en la escena, también lo que está oculto
   * (plumín, torre, lastre, cabina), y se dibuja una vez con sombras (los materiales de profundidad), detrás de la
   * pantalla de carga. Así no hay tirones la primera vez que aparece algo.
   */
  async warmUp(m: Mounted) {
    const { renderer, scene, camera } = this.ctx;
    // los modelos en su pose (algunos InstancedMesh crean sus colores por instancia al actualizarse, y eso cambia el
    // shader) y la cámara y el sol ya sobre la grúa (el encuadre de sombras sigue a la grúa)
    for (const u of m.ses.units) u.crane.update(u.S, u.pose, u.C.slR);
    const act = m.ses.act;
    m.view.cam.update(0, act.S, act.pose);
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }
}
