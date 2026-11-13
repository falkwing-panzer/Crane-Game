import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';
import { padAxes, padEdges, pressedList, type PadAction, type PadAxes } from './gamepad';
import { HOLD, codeIndex, loadKeys, normCode, useKeys, type Action, type HoldAction, type KeyMap, type TapAction } from './keys';

export class Input {
  /** mandos que se mantienen: 1 mientras su tecla está pulsada */
  private k = Object.fromEntries(HOLD.map((a) => [a, 0])) as Record<HoldAction, number>;
  /** tabla de teclas (fase 14: configurable) y acción de cada tecla */
  private keys!: KeyMap;
  private idx = new Map<string, Action>();
  /**
   * Panel de teclas (fase 14): mientras está puesto, la siguiente tecla pulsada va aquí (también Esc, para cancelar)
   * y no hace nada más.
   */
  capture: ((code: string) => void) | null = null;
  /** mando (fase 11): ejes del último poll() y botones pulsados entonces */
  private pad: PadAxes | null = null;
  private padPrev: boolean[] = [];
  /** se avisó de que hay un mando conectado */
  onPad: (name: string) => void = () => {};
  private padName = '';
  onHook: () => void = () => {};
  /** X: reponer la carga (ayuda de prueba, no está en la referencia) */
  onReset: () => void = () => {};
  /** O: estabilizadores */
  onOutriggers: () => void = () => {};
  /** P: puenteo del LMI (ayuda de prueba, no está en la referencia) */
  onBypass: () => void = () => {};
  /** B: lastre */
  onBallast: () => void = () => {};
  /** Y: arriostramiento en Y */
  onYGuy: () => void = () => {};
  /** V: cambiar de cámara */
  onView: () => void = () => {};
  /** M: montaje del plumín */
  onMount: () => void = () => {};
  /** Tab: cambiar de grúa en el tándem (fase 10) */
  onSwitch: () => void = () => {};
  /** N: silenciar el sonido (fase 11) */
  onMute: () => void = () => {};
  /** H: ayuda de controles (fase 13) */
  onHelp: () => void = () => {};
  /** Esc: cerrar la ayuda (fase 13) */
  onEscape: () => void = () => {};
  /**
   * Motivos por los que las teclas y el mando no mueven la grúa (solo H y Esc): la ayuda abierta (fase 13) o el
   * juego en pausa (fase 14: pestaña oculta, ventana sin foco, gráfica perdida).
   */
  private blocks = new Set<string>();
  private get paused() { return this.blocks.size > 0; }

  constructor(keys: KeyMap = loadKeys()) {
    this.setKeys(keys);
    const tap: Record<Exclude<TapAction, 'help'>, () => void> = {
      hook: () => this.onHook(), outriggers: () => this.onOutriggers(), ballast: () => this.onBallast(), yguy: () => this.onYGuy(),
      mount: () => this.onMount(), view: () => this.onView(), switch: () => this.onSwitch(), reset: () => this.onReset(),
      bypass: () => this.onBypass(), mute: () => this.onMute(),
    };
    addEventListener('keydown', (e) => {
      const code = normCode(e.code);
      if (this.capture) {
        e.preventDefault();
        if (e.repeat) return;
        const c = this.capture;
        this.capture = null;
        c(code);
        return;
      }
      const a = this.idx.get(code);
      if (a === 'help' && !e.repeat) { this.onHelp(); return; }
      if (code === 'Escape' && !e.repeat) { this.onEscape(); return; }
      // Espacio y Tab no deben desplazar la página ni mover el foco
      const grab = code === 'Space' || code === 'Tab' || a === 'hook' || a === 'switch';
      if (this.paused) { if (grab) e.preventDefault(); return; }
      if (!a) return;
      if (a in tap) {
        e.preventDefault();
        if (!e.repeat) tap[a as keyof typeof tap]();
        return;
      }
      this.k[a as HoldAction] = 1;
      e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      const a = this.idx.get(normCode(e.code));
      if (a && a in this.k) this.k[a as HoldAction] = 0;
    });
    addEventListener('blur', () => this.release());
  }

  /** Tabla de teclas en uso */
  get keyMap(): KeyMap { return this.keys; }

  /** Cambia la tabla de teclas (no la guarda: `saveKeys`) y suelta las pulsadas */
  setKeys(k: KeyMap) {
    this.keys = k;
    this.idx = codeIndex(k);
    useKeys(k);
    this.release();
  }

  /** Suelta todas las teclas pulsadas */
  release() {
    for (const a of HOLD) this.k[a] = 0;
  }

  /** Ayuda abierta: no se aceptan teclas ni mando, y se sueltan las que estaban pulsadas */
  pause(on: boolean) { this.block('ayuda', on); }

  /** Pone o quita un motivo para no aceptar teclas ni mando; siempre suelta las pulsadas */
  block(reason: string, on: boolean) {
    if (on) this.blocks.add(reason); else this.blocks.delete(reason);
    this.release();
  }

  /**
   * Mando (fase 11): lee el primer mando conectado; llamar una vez por cuadro. Los botones de un toque llaman a los
   * mismos avisos que las teclas.
   */
  poll() {
    const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (!gp) { this.pad = null; this.padPrev = []; this.padName = ''; return; }
    if (this.paused) { this.pad = null; this.padPrev = pressedList(gp.buttons); return; }
    if (gp.id !== this.padName) { this.padName = gp.id; this.onPad(gp.id); }
    this.pad = padAxes(gp.axes, gp.buttons);
    const act: Record<PadAction, () => void> = {
      hook: () => this.onHook(), outriggers: () => this.onOutriggers(), ballast: () => this.onBallast(), view: () => this.onView(),
      mount: () => this.onMount(), yguy: () => this.onYGuy(), switch: () => this.onSwitch(),
    };
    for (const a of padEdges(this.padPrev, gp.buttons)) act[a]();
    this.padPrev = pressedList(gp.buttons);
  }

  state(): CraneInput {
    const k = this.k, p = this.pad;
    // la tecla manda; si no hay tecla, el mando (proporcional)
    const m = (key: number, pad: number | undefined) => (key !== 0 ? key : pad ?? 0);
    return {
      slew: m(k.sll - k.slr, p?.slew), luff: m(k.lu - k.ld, p?.luff), tele: m(k.to - k.ti, p?.tele), hoist: m(k.hd - k.hu, p?.hoist),
      fine: !!k.fine || !!p?.fine, sl: m(k.slo - k.sli, p?.sl), jib: m(k.jd - k.ju, p?.jib),
    };
  }

  drive(): DriveInput {
    const k = this.k, p = this.pad;
    const m = (key: number, pad: number | undefined) => (key !== 0 ? key : pad ?? 0);
    return { throttle: m(k.fw - k.bk, p?.throttle), steer: m(k.stl - k.str, p?.steer), fine: !!k.fine || !!p?.fine };
  }
}
