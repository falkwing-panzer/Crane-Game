import type * as THREE from 'three';

// HUD en HTML simple: contador de rendimiento, lecturas de la grúa, mensajes y ayuda de teclas.

export interface Readout {
  Lb: number;
  angDeg: number;
  radius: number;
  headH: number;
  cable: number;
  load: string;
  fine: boolean;
  /** LMI (1 = 100 %) */
  lmi: number;
  /** Capacidad nominal en esta posición (t, gancho incluido) */
  rated: number;
  /** Masa en el gancho: gancho + carga enganchada (t) */
  mHook: number;
  /** Texto del modo de apoyo */
  mode: string;
  /** Tensión del cable medida en Rapier (t) */
  tension: number;
  /** El LMI cortó algún movimiento en este cuadro */
  cut: boolean;
  /** Inclinación incipiente (°) */
  tiltDeg: number;
  /** La grúa ya volcó */
  tipped: boolean;
  /** LMI puenteado (tecla P) */
  bypass: boolean;
  /** Velocidad de marcha (m/s) y dirección (°, + izquierda) */
  speed: number;
  steerDeg: number;
  /** Lastre: t montadas, total, avance 0…1 y objetivo (null si la grúa no monta lastre) */
  ballast: { t: number; of: number; p: number; target: number } | null;
  /** Y-guy: texto de la fase y avance 0…1 (null si no tiene) */
  yguy: { text: string; p: number } | null;
}

/** Indicadores de montaje: verde montado, amarillo montando, gris desmontado. */
function assemblyLine(r: Readout) {
  const cls = (p: number) => (p >= 1 ? 'ok' : p > 0 ? 'warn' : 'off');
  const out: string[] = [];
  if (r.ballast) {
    const b = r.ballast, moving = b.p !== b.target;
    out.push(`<span class="lamp ${cls(b.p)}">Lastre ${Math.round(b.t)} / ${b.of} t${moving ? (b.target ? ' · montando' : ' · desmontando') : ''}</span>`);
  }
  if (r.yguy) out.push(`<span class="lamp ${cls(r.yguy.p)}">Arriostr. Y ${r.yguy.text}</span>`);
  return out.length ? `<div class="lamps">${out.join('')}</div>` : '';
}

export class Hud {
  private perf: HTMLElement;
  private data: HTMLElement;
  private msg: HTMLElement;
  private msgT = 0;
  private card: HTMLElement;
  /** Botón Reiniciar del cartel de vuelco */
  onRestart: () => void = () => {};
  /** Menú de grúa: se eligió otra */
  onCrane: (id: string) => void = () => {};
  // Ventana de medición de 0,5 s
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private physAcc = 0;
  private renderAcc = 0;

  constructor(root: HTMLElement, private title: string, current: string, cranes: { id: string; name: string }[],
    has = { ballast: false, yguy: false }) {
    const opts = cranes.map((c) => `<option value="${c.id}"${c.id === current ? ' selected' : ''}>${c.name}</option>`).join('');
    root.innerHTML = `
      <div class="panel perf" id="perf">— fps</div>
      <label class="panel pick">Grúa <select id="crane">${opts}</select></label>
      <div class="panel data" id="data"></div>
      <div class="msg" id="msg"></div>
      <div class="panel keys">
        <b>Flechas</b> conducir · <b>A/D</b> giro · <b>W/S</b> pluma · <b>Q/E</b> telescopio · <b>R/F</b> gancho ·
        <b>O</b> estabilizadores · ${has.ballast ? '<b>B</b> lastre · ' : ''}${has.yguy ? '<b>Y</b> arriostramiento · ' : ''}<b>Espacio</b> enganchar/soltar · <b>X</b> reponer carga · <b>P</b> puentear LMI · <b>Shift</b> fino · <b>V</b> cámara
      </div>
      <div class="card" id="card" hidden>
        <h2>Grúa volcada</h2>
        <p id="card-text"></p>
        <button id="card-restart">Reiniciar</button>
      </div>`;
    this.card = root.querySelector('#card')!;
    root.querySelector('#card-restart')!.addEventListener('click', () => this.onRestart());
    const sel = root.querySelector('#crane') as HTMLSelectElement;
    sel.addEventListener('change', () => this.onCrane(sel.value));
    // las teclas del juego no deben mover el menú: se suelta el foco al elegir o al pulsar una tecla
    sel.addEventListener('keydown', (e) => { if (e.key !== 'Enter') { e.preventDefault(); sel.blur(); } });
    this.perf = root.querySelector('#perf')!;
    this.data = root.querySelector('#data')!;
    this.msg = root.querySelector('#msg')!;
  }

  /** Cartel de vuelco (null = ocultar) */
  showTipped(text: string | null) {
    this.card.hidden = text === null;
    if (text !== null) {
      this.card.querySelector('#card-text')!.textContent = text;
      (this.card.querySelector('#card-restart') as HTMLButtonElement).focus();
    }
  }

  say(text: string, seconds = 2.5) {
    this.msg.textContent = text;
    this.msg.classList.add('on');
    this.msgT = seconds;
  }

  /** Como say(), pero no reinicia el mensaje si ya se está mostrando (para avisos que se repiten cada paso). */
  sayOnce(text: string, seconds = 1.9) {
    if (this.msg.textContent === text && this.msgT > 0.5) return;
    this.say(text, seconds);
  }

  /** dt real del cuadro (s), tiempos de física y render (ms CPU) */
  frame(dt: number, physMs: number, renderMs: number, info: THREE.WebGLInfo) {
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    this.physAcc += physMs;
    this.renderAcc += renderMs;
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.msg.classList.remove('on');
    if (this.acc < 0.5) return;
    const n = this.frames;
    const fps = n / this.acc;
    this.perf.innerHTML =
      `<b class="${fps < 50 ? 'bad' : fps < 58 ? 'warn' : ''}">${fps.toFixed(0)} fps</b>` +
      ` · ${(1000 * this.acc / n).toFixed(1)} ms (peor ${(1000 * this.worst).toFixed(1)})<br>` +
      `física ${(this.physAcc / n).toFixed(2)} ms · render CPU ${(this.renderAcc / n).toFixed(2)} ms<br>` +
      `draw calls ${info.render.calls} · triángulos ${info.render.triangles}`;
    this.frames = 0; this.acc = 0; this.worst = 0; this.physAcc = 0; this.renderAcc = 0;
  }

  readout(r: Readout) {
    const f = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
    const lmiCls = r.lmi >= 1 ? 'bad' : r.lmi >= 0.9 ? 'warn' : 'ok';
    this.data.innerHTML =
      `<div class="title">${this.title}${r.fine ? ' · <span class="warn">fino</span>' : ''}</div>` +
      `Pluma <b>${f(r.Lb)} m</b> · <b>${f(r.angDeg)}°</b><br>` +
      `Radio <b>${f(r.radius)} m</b> · punta <b>${f(r.headH)} m</b><br>` +
      `Cable <b>${f(r.cable)} m</b><br>` +
      `Gancho: <b>${r.load}</b><br>` +
      `Marcha <b>${f(Math.abs(r.speed) * 3.6)} km/h</b>${r.speed < -0.05 ? ' atrás' : ''} · dirección <b>${f(r.steerDeg, 0)}°</b>` +
      `<div class="lmi ${lmiCls}"><span>LMI</span><b>${Math.round(r.lmi * 100)} %</b>` +
      `<i><u style="width:${Math.min(100, (r.lmi / 1.25) * 100).toFixed(1)}%"></u><s></s></i></div>` +
      (r.bypass && !r.tipped ? `<div class="cut">LMI PUENTEADO (P)</div>` : '') +
      (r.tipped ? `<div class="cut">GRÚA VOLCADA</div>`
        : r.cut ? `<div class="cut">CORTE LMI · solo movimientos que lo reducen</div>`
        : r.lmi >= 1 ? `<div class="bad">LMI por encima del 100 %</div>`
        : r.lmi >= 0.9 ? `<div class="warn">Aviso LMI: cerca del límite</div>` : '') +
      (!r.tipped && r.tiltDeg > 0.05 ? `<div class="bad">¡La grúa se levanta! ${f(r.tiltDeg)}°</div>` : '') +
      `Capacidad <b class="${r.mHook > r.rated ? 'bad' : ''}">${f(r.mHook)} / ${f(r.rated)} t</b><br>` +
      `Tensión cable <b>${f(r.tension, 2)} t</b><br>` +
      assemblyLine(r) +
      `<small>Apoyo: ${r.mode} · masa y capacidad con gancho</small>`;
  }
}
