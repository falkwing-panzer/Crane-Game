import type * as THREE from 'three';
import type { App } from '../app';
import type { InputSource } from '../game/record';
import { GpuTimer } from './gpuTimer';

/**
 * Banco de pruebas de rendimiento (fase 15, ?bench=1): recorre las partidas más pesadas con un guion fijo (girando la
 * superestructura) y saca un informe: fps medio, peor cuadro, draw calls, triángulos, ms de física por paso, ms de
 * render en la CPU y ms de GPU reales (EXT_disjoint_timer_query_webgl2, si el navegador lo da). Se ve en pantalla,
 * en la consola y en `window.__benchReport`. La calidad adaptativa está apagada (se mide la calidad elegida).
 */

export interface BenchCase { name: string; search: string }

export const BENCH_CASES: BenchCase[] = [
  { name: 'Nivel 14 · tándem', search: '?nivel=14' },
  { name: 'Nivel 11 · AT 650-8', search: '?nivel=11&grua=at650' },
  { name: 'Nivel 9', search: '?nivel=9' },
  { name: 'LR 3000 · libre', search: '?grua=lr' },
  { name: 'AT 650-8 · libre', search: '?grua=at650' },
  { name: 'SK 60 · libre', search: '?grua=sk' },
];

export interface BenchRow {
  name: string; fps: number; frameMs: number; worstMs: number; p95Ms: number; calls: number; tris: number;
  physMs: number; cpuMs: number; gpuMs: number | null;
  /** Fase 16: GPU del pase de sombras y del resto de la escena, y CPU del HUD (DOM) por cuadro */
  shadowMs: number | null; sceneMs: number | null; hudMs: number;
}

/** Guion: girar la superestructura despacio todo el rato (se mueve la escena, sin riesgo de vuelco) */
const SLEW: InputSource = {
  next: () => ({ crane: { slew: 0.5, luff: 0, tele: 0, hoist: 0, fine: false, sl: 0, jib: 0 }, drive: { throttle: 0, steer: 0, fine: false }, cmds: [] }),
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBench(app: App, cases = BENCH_CASES, warm = 1.5, secs = 6): Promise<BenchRow[]> {
  const { renderer } = app.ctx;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const gpu = new GpuTimer(gl);
  const render = renderer.render.bind(renderer);
  const sm = renderer.shadowMap as THREE.WebGLShadowMap;
  const shadowRender = sm.render;
  let cpu = 0, hud = 0;
  renderer.render = (s, c) => {
    const t0 = performance.now();
    gpu.begin('escena');
    render(s, c);
    gpu.end();
    cpu += performance.now() - t0;
  };
  // el pase de sombras va dentro de render(): se mide aparte (fase 16)
  sm.render = function (...a: Parameters<typeof shadowRender>) {
    gpu.push('sombras');
    shadowRender.apply(this, a);
    gpu.pop();
  };
  const rows: BenchRow[] = [];
  const note = document.createElement('div');
  note.className = 'panel bench-note';
  document.getElementById('hud')!.appendChild(note);
  try {
    for (const [k, c] of cases.entries()) {
      note.textContent = `Banco de pruebas ${k + 1}/${cases.length}: ${c.name}…`;
      await app.go(c.search);
      const m = app.cur!;
      m.view.lui.close();
      m.ses.running = true;
      m.game.source = SLEW;
      // calentar (sombras, caché de la GPU) y después medir
      let phase: 'warm' | 'run' = 'warm', t = 0;
      const dts: number[] = [];
      let phys = 0, steps = 0, calls = 0, tris = 0;
      await new Promise<void>((done) => {
        app.probe = (dt, physMs, n) => {
          gpu.poll();
          t += dt;
          if (phase === 'warm') {
            if (t >= warm) { phase = 'run'; t = 0; cpu = 0; hud = 0; gpu.take(); }
            return;
          }
          hud += m.view.hudMs;
          dts.push(dt);
          phys += physMs;
          steps += n;
          calls = Math.max(calls, renderer.info.render.calls);
          tris = Math.max(tris, renderer.info.render.triangles);
          if (t >= secs) { app.probe = null; done(); }
        };
      });
      await wait(200);
      gpu.poll();
      const g = gpu.take();
      const sorted = [...dts].sort((a, b) => a - b);
      const sum = dts.reduce((a, b) => a + b, 0);
      rows.push({
        name: c.name, fps: dts.length / sum, frameMs: (1000 * sum) / dts.length, worstMs: 1000 * sorted[sorted.length - 1],
        p95Ms: 1000 * sorted[Math.floor(sorted.length * 0.95)], calls, tris, physMs: steps ? phys / steps : 0,
        cpuMs: cpu / dts.length, gpuMs: 'escena' in g ? g.escena + (g.sombras ?? 0) : null,
        shadowMs: g.sombras ?? null, sceneMs: g.escena ?? null, hudMs: hud / dts.length,
      });
      m.game.source = null;
    }
  } finally {
    renderer.render = render;
    sm.render = shadowRender;
    app.probe = null;
    note.remove();
  }
  show(rows, gpu.ok, gl);
  return rows;
}

function gpuName(gl: WebGL2RenderingContext) {
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

/** Informe en pantalla y en la consola */
function show(rows: BenchRow[], gpuOk: boolean, gl: WebGL2RenderingContext) {
  const f = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
  const info = {
    fecha: new Date().toISOString(), gpu: gpuName(gl), pantalla: `${innerWidth}×${innerHeight} @${devicePixelRatio}`,
    lienzo: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`, url: location.search,
  };
  const report = { ...info, filas: rows };
  Object.assign(window, { __benchReport: report });
  console.table(rows);
  console.log('Banco de pruebas', JSON.stringify(report));
  const el = document.createElement('div');
  el.className = 'overlay bench';
  el.innerHTML = `<div class="lcard"><div class="eyebrow">Banco de pruebas · ${info.gpu}</div>
    <h2>Informe de rendimiento</h2><p>Pantalla ${info.pantalla} · lienzo ${info.lienzo}${gpuOk ? '' : ' · este navegador no da el tiempo de GPU'}</p>
    <table class="bench-table"><tr><th>Partida</th><th>fps</th><th>ms/cuadro</th><th>peor</th><th>p95</th><th>draw calls</th><th>triángulos</th>
    <th>física ms/paso</th><th>render CPU ms</th><th>HUD CPU ms</th><th>GPU ms</th><th>sombras</th><th>escena</th></tr>
    ${rows.map((r) => `<tr><td>${r.name}</td><td>${f(r.fps, 0)}</td><td>${f(r.frameMs)}</td><td>${f(r.worstMs)}</td><td>${f(r.p95Ms)}</td>
      <td>${r.calls}</td><td>${r.tris.toLocaleString('es')}</td><td>${f(r.physMs, 2)}</td><td>${f(r.cpuMs, 2)}</td><td>${f(r.hudMs, 2)}</td>
      <td>${r.gpuMs === null ? '—' : f(r.gpuMs, 2)}</td><td>${r.shadowMs === null ? '—' : f(r.shadowMs, 2)}</td>
      <td>${r.sceneMs === null ? '—' : f(r.sceneMs, 2)}</td></tr>`).join('')}</table>
    <div class="row"><button class="btn" id="bench-copy">Copiar JSON</button><a class="btn primary" href="${location.pathname}">Menú</a></div></div>`;
  document.getElementById('hud')!.appendChild(el);
  el.querySelector('#bench-copy')!.addEventListener('click', () => { void navigator.clipboard?.writeText(JSON.stringify(report, null, 1)); });
}
