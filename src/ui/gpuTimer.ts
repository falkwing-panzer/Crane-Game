/**
 * Tiempo de GPU real de cada dibujo (fase 15) con EXT_disjoint_timer_query_webgl2, si el navegador lo da (Chrome lo
 * suele dar; Firefox y Safari, no). Las consultas tardan unos cuadros en tener resultado: `poll()` recoge las que ya
 * están. Si la GPU avisa de un salto (disjoint), esas medidas se tiran.
 */
interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  private ext: TimerExt | null;
  private pending: WebGLQuery[] = [];
  private open: WebGLQuery | null = null;
  /** ms de GPU de los dibujos medidos (se vacía con `take`) */
  private samples: number[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get ok() { return !!this.ext; }

  begin() {
    if (!this.ext || this.open || this.pending.length > 8) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = q;
  }

  end() {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  /** Recoge los resultados listos */
  poll() {
    const { gl, ext } = this;
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.samples.push(ns / 1e6);
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  /** Las medidas desde la última vez */
  take(): number[] {
    const s = this.samples;
    this.samples = [];
    return s;
  }
}
