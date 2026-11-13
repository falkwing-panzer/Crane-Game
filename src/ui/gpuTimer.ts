/**
 * Tiempo de GPU real de cada dibujo (fase 15) con EXT_disjoint_timer_query_webgl2, si el navegador lo da (Chrome lo
 * suele dar; Firefox y Safari, no). Las consultas tardan unos cuadros en tener resultado: `poll()` recoge las que ya
 * están. Si la GPU avisa de un salto (disjoint), esas medidas se tiran.
 *
 * Fase 16: cada consulta lleva una etiqueta (pase de sombras, escena…). Las consultas no se pueden anidar, así que un
 * pase dentro de otro se mide cerrando la consulta de fuera, abriendo la suya y volviendo a abrir la de fuera al
 * terminar (`push`/`pop`): el tiempo de la de fuera es la suma de sus trozos.
 */
interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  private ext: TimerExt | null;
  private pending: { q: WebGLQuery; label: string }[] = [];
  /** Etiquetas abiertas (la última es la que mide ahora) */
  private stack: string[] = [];
  private open: WebGLQuery | null = null;
  /** ms de GPU por etiqueta y por cuadro (se vacía con `take`) */
  private sums = new Map<string, number>();
  /** Cuadros medidos (uno por cada `begin` de la etiqueta de fuera) */
  private frames = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get ok() { return !!this.ext; }

  private start(label: string) {
    if (!this.ext || this.open || this.pending.length > 32) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = q;
    this.pending.push({ q, label });
  }

  private stop() {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.open = null;
  }

  /** Empieza a medir un cuadro (etiqueta de fuera) */
  begin(label = 'total') {
    this.stack = [label];
    this.frames++;
    this.start(label);
  }

  /** Termina el cuadro */
  end() {
    this.stop();
    this.stack = [];
  }

  /** Un pase dentro del cuadro: corta la medida de fuera y mide este aparte */
  push(label: string) {
    if (!this.stack.length) return;
    this.stop();
    this.stack.push(label);
    this.start(label);
  }

  /** Fin del pase: vuelve a medir la etiqueta de fuera */
  pop() {
    if (this.stack.length < 2) return;
    this.stop();
    this.stack.pop();
    this.start(this.stack[this.stack.length - 1]);
  }

  /** Recoge los resultados listos */
  poll() {
    const { gl, ext } = this;
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const { q, label } = this.pending[0];
      if (q === this.open || !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.sums.set(label, (this.sums.get(label) ?? 0) + ns / 1e6);
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  /** ms medios por cuadro de cada etiqueta desde la última vez (vacío sin medidas) */
  take(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.frames) for (const [k, v] of this.sums) out[k] = v / this.frames;
    this.sums.clear();
    this.frames = 0;
    return out;
  }
}
