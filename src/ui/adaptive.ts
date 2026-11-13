/**
 * Calidad adaptativa (fase 15): si los cuadros van lentos de forma sostenida, baja la escala de resolución; cuando
 * vuelve a sobrar margen, la sube. Nunca pasa de la escala de la calidad elegida (1 = la de la calidad).
 *
 * Con la pantalla a 60 Hz el tiempo de cuadro no dice cuánto margen sobra (va sincronizado), así que para subir se
 * prueba: tras un rato bien se sube un escalón; si al poco vuelve a ir lento, se baja y se espera el doble antes de
 * probar otra vez. Sin DOM: `update(dt)` se prueba suelto.
 */
export class AdaptiveScale {
  /** Escala actual (min…1) */
  scale = 1;
  /** Tiempo de cuadro medio (filtrado, s) */
  avg = 1 / 60;
  private bad = 0;
  private good = 0;
  private cool = 0;
  private wait: number;
  private sinceRaise = Infinity;

  constructor(
    /** Escala mínima */
    readonly min = 0.5,
    /** Cuadro lento: más de esto de media (s); 1/52 ≈ por debajo de 52 fps */
    readonly slow = 1 / 52,
    /** Segundos lentos seguidos para bajar */
    readonly badFor = 1.5,
    /** Segundos bien antes de probar a subir (se dobla si la prueba falla, hasta maxWait) */
    readonly waitFor = 8,
    readonly maxWait = 120,
    readonly step = 0.85,
  ) {
    this.wait = waitFor;
  }

  /** Un cuadro de `dt` s. Devuelve la escala nueva si cambió, o null. */
  update(dt: number): number | null {
    if (!(dt > 0) || dt > 0.25) return null; // pausa, pestaña oculta o un tirón suelto (carga): no cuenta
    this.avg += (dt - this.avg) * Math.min(1, dt / 0.5);
    this.sinceRaise += dt;
    if (this.cool > 0) { this.cool -= dt; return null; }
    // lento: la media y el cuadro de ahora. Los cuadros buenos descuentan en vez de poner a cero: con la pantalla
    // sincronizada, 40 fps son cuadros de 16 y 33 ms alternados. Al volver a ir bien, la media tarda medio segundo
    // en bajar y esos cuadros ya no cuentan como lentos.
    if (this.avg > this.slow && dt > this.slow * 0.95) this.bad += dt;
    else this.bad = Math.max(0, this.bad - dt);
    if (this.avg > this.slow) {
      this.good = 0;
      if (this.bad < this.badFor || this.scale <= this.min) return null;
      this.bad = 0;
      this.cool = 1; // que el filtro vea el cambio antes de decidir otra vez
      // la última subida no aguantó: esperar más antes de volver a probar
      if (this.sinceRaise < this.waitFor) this.wait = Math.min(this.maxWait, this.wait * 2);
      return (this.scale = Math.max(this.min, this.scale * this.step));
    }
    if (this.scale >= 1 || (this.good += dt) < this.wait) return null;
    this.good = 0;
    this.cool = 1;
    this.sinceRaise = 0;
    return (this.scale = Math.min(1, this.scale / this.step));
  }
}
