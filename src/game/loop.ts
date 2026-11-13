/**
 * Bucle con paso de física fijo y render a la frecuencia de la pantalla (fase 14: sacado de main.ts).
 * Pausa con motivos (pestaña oculta, ventana sin foco, gráfica perdida): mientras haya alguno no se dan pasos y,
 * al quitarse el último, se tira el tiempo acumulado, así que al volver no hay pasos de física de golpe.
 * Sin DOM: `frame(now)` se puede llamar a mano en las pruebas.
 */
export class Loop {
  private last = -1;
  private acc = 0;
  private reasons = new Set<string>();
  private raf = 0;
  /** Al cambiar la pausa (para mostrar el aviso) */
  onPause: (reasons: string[]) => void = () => {};

  constructor(
    private tick: (dt: number) => void,
    private draw: (dt: number, physMs: number) => void,
    readonly step = 1 / 60,
    readonly maxSteps = 4,
  ) {}

  get paused() { return this.reasons.size > 0; }
  /**
   * Fracción del paso que ya pasó desde el último paso de física (0…1): el dibujo mezcla los dos últimos pasos con
   * ella (fase 15). En pausa, 1 (el último paso tal cual).
   */
  get alpha() { return this.paused ? 1 : Math.min(1, this.acc / this.step); }
  /** Pasos dados en el último cuadro */
  steps = 0;
  get why() { return [...this.reasons]; }

  /** Pone o quita un motivo de pausa */
  pause(reason: string, on: boolean) {
    if (on === this.reasons.has(reason)) return;
    const was = this.paused;
    if (on) this.reasons.add(reason); else this.reasons.delete(reason);
    if (was && !this.paused) { this.acc = 0; this.last = -1; } // al volver: sin pasos acumulados
    this.onPause(this.why);
  }

  /** Al empezar cada cuadro, antes de los pasos (leer el mando) */
  onFrame: () => void = () => {};

  /** Un cuadro: pasos fijos pendientes (como mucho maxSteps) y dibujo. Devuelve los pasos dados. */
  frame(now: number): number {
    this.onFrame();
    const dt = this.last < 0 ? 0 : Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    let n = 0;
    const t0 = performance.now();
    if (this.paused) this.acc = 0;
    else {
      this.acc += dt;
      while (this.acc >= this.step && n < this.maxSteps) {
        this.tick(this.step);
        this.acc -= this.step;
        n++;
      }
      if (n === this.maxSteps) this.acc = 0; // si la máquina no da abasto, se ralentiza en vez de acumular
    }
    this.steps = n;
    this.draw(dt, performance.now() - t0);
    return n;
  }

  start() {
    const f = (now: number) => { this.raf = requestAnimationFrame(f); this.frame(now); };
    this.raf = requestAnimationFrame(f);
  }

  stop() { cancelAnimationFrame(this.raf); }
}
