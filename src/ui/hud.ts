import type * as THREE from 'three';
import { t } from '../i18n';
import { withKeys } from './keys';

const h = t.hud;

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
  /** null en las orugas (no tienen dirección: giran en el sitio) */
  steerDeg: number | null;
  /** Lastre: t montadas, total, avance 0…1 y objetivo (null si la grúa no monta lastre) */
  ballast: { t: number; of: number; p: number; target: number } | null;
  /** Y-guy: texto de la fase y avance 0…1 (null si no tiene) */
  yguy: { text: string; p: number } | null;
  /** Radio del lastre superlift (m) y sus límites (null si no tiene) */
  superlift: { r: number; min: number; max: number } | null;
  /** Plumín: fase del montaje, avance 0…1, ángulo absoluto (°) y largo (m) (null si la grúa no lleva) */
  jib: { text: string; p: number; deg: number; len: number } | null;
  /** Grúa torre: fase del montaje y avance 0…1 (null si no es grúa torre); con torre, Lb es la posición del carro */
  tower?: { text: string; p: number } | null;
  /** Tándem: ángulo del cable con la vertical (°) y el máximo (null sin carga con orejetas) */
  side?: { deg: number; max: number } | null;
}

/** Indicadores de montaje: verde montado, amarillo montando, gris desmontado. */
function assemblyLine(r: Readout) {
  const cls = (p: number) => (p >= 1 ? 'ok' : p > 0 ? 'warn' : 'off');
  const out: string[] = [];
  if (r.ballast) {
    const b = r.ballast, moving = b.p !== b.target;
    out.push(`<span class="lamp ${cls(b.p)}">${h.ballast(Math.round(b.t), b.of, moving ? (b.target ? h.mounting : h.unmounting) : '')}</span>`);
  }
  if (r.tower) out.push(`<span class="lamp ${cls(r.tower.p)}">${h.tower(r.tower.text)}</span>`);
  if (r.yguy) out.push(`<span class="lamp ${cls(r.yguy.p)}">${h.yguy(r.yguy.text)}</span>`);
  if (r.jib) {
    const j = r.jib;
    out.push(`<span class="lamp ${cls(j.p)}">${h.jib(j.p >= 1 ? h.jibUp(Math.round(j.deg), j.len) : j.text)}</span>`);
  }
  if (r.superlift) {
    const s = r.superlift;
    out.push(`<span class="lamp ok">${h.superlift(s.r.toFixed(1).replace('.', ','), s.min, s.max)}</span>`);
  }
  return out.length ? `<div class="lamps">${out.join('')}</div>` : '';
}

export class Hud {
  private perf: HTMLElement | null;
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

  private otherEl: HTMLElement;

  /** Columna de la izquierda (fps, grúa, niveles, calidad, ayuda): se apilan solos, con o sin el contador de fps */
  readonly left: HTMLElement;
  /** Botón "?" de la ayuda */
  readonly helpBtn: HTMLElement;

  /** perf: mostrar el contador de fps y tiempos (en desarrollo siempre; publicado, solo con ?fps=1) */
  constructor(root: HTMLElement, private title: string, current: string, cranes: { id: string; name: string }[],
    has: { tele: boolean; tower?: boolean } = { tele: true }, perf = true) {
    const opts = cranes.map((c) => `<option value="${c.id}"${c.id === current ? ' selected' : ''}>${c.name}</option>`).join('');
    root.innerHTML = `
      <div class="left" id="left">
        ${perf ? `<div class="panel perf" id="perf">${h.fps}</div>` : ''}
        <label class="panel pick">${h.crane} <select id="crane">${opts}</select></label>
      </div>
      <div class="panel data" id="data"></div>
      <div class="panel data other" id="other" hidden></div>
      <div class="msg" id="msg"></div>
      <div class="panel keys"><span id="keys-line"></span>
        <button class="help-btn" id="help-btn">?</button>
      </div>
      <div class="card" id="card" hidden>
        <h2>${h.tippedTitle}</h2>
        <p id="card-text"></p>
        <button id="card-restart">${h.restart}</button>
      </div>`;
    this.left = root.querySelector('#left')!;
    this.helpBtn = root.querySelector('#help-btn')!;
    this.card = root.querySelector('#card')!;
    root.querySelector('#card-restart')!.addEventListener('click', () => this.onRestart());
    const sel = root.querySelector('#crane') as HTMLSelectElement;
    sel.addEventListener('change', () => this.onCrane(sel.value));
    // las teclas del juego no deben mover el menú: se suelta el foco al elegir o al pulsar una tecla
    sel.addEventListener('keydown', (e) => { if (e.key !== 'Enter') { e.preventDefault(); sel.blur(); } });
    this.perf = root.querySelector<HTMLElement>('#perf'); // null sin contador (perf = false)
    this.data = root.querySelector('#data')!;
    this.msg = root.querySelector('#msg')!;
    this.otherEl = root.querySelector('#other')!;
    this.keysLine = root.querySelector('#keys-line')!;
    this.has = has;
    this.setKeys();
  }

  private keysLine: HTMLElement;
  private has: { tele: boolean; tower?: boolean };

  /** Línea de teclas de abajo y título del botón "?" con las teclas en uso (fase 14: configurables) */
  setKeys() {
    this.keysLine.innerHTML = withKeys(h.keysLine(this.has));
    const tip = withKeys(h.helpBtn);
    this.helpBtn.title = tip;
    this.helpBtn.setAttribute('aria-label', tip);
  }

  /** Nombre de la grúa que se maneja (tándem: cambia con Tab) */
  setTitle(title: string) {
    this.title = title;
  }

  /** Tándem: resumen de la otra grúa (null = ocultar) */
  other(o: { name: string; lmi: number; tension: number; share: number | null; tiltDeg: number; tipped: boolean; sideDeg?: number | null } | null) {
    this.otherEl.hidden = !o;
    if (!o) return;
    const f = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
    const cls = o.lmi >= 1 ? 'bad' : o.lmi >= 0.9 ? 'warn' : 'ok';
    this.otherEl.innerHTML = `<div class="title">${withKeys(h.otherTitle(o.name))}</div>` +
      (o.tipped ? `<div class="cut">${h.tippedBadge}</div>` :
        `<div class="lmi ${cls}"><span>LMI</span><b>${Math.round(o.lmi * 100)} %</b>` +
        `<i><u style="width:${Math.min(100, (o.lmi / 1.25) * 100).toFixed(1)}%"></u><s></s></i></div>` +
        (o.tiltDeg > 0.05 ? `<div class="bad">${h.lifting(f(o.tiltDeg))}</div>` : '') +
        `${h.tension} <b>${f(o.tension)} t</b>` + (o.share !== null ? ` · ${h.carries} <b>${f(o.share)} t</b>` : '') +
        (o.sideDeg != null ? `<br>${h.sideAngle(f(o.sideDeg), o.sideDeg > 6 ? 'bad' : o.sideDeg > 4 ? 'warn' : '')}` : ''));
  }

  /** Cartel de vuelco (null = ocultar) */
  showTipped(text: string | null) {
    this.card.hidden = text === null;
    if (text !== null) {
      this.card.querySelector('#card-text')!.textContent = withKeys(text);
      (this.card.querySelector('#card-restart') as HTMLButtonElement).focus();
    }
  }

  say(text: string, seconds = 2.5) {
    text = withKeys(text);
    this.msg.textContent = text;
    this.msg.classList.add('on');
    this.msgT = seconds;
  }

  /** Como say(), pero no reinicia el mensaje si ya se está mostrando (para avisos que se repiten cada paso). */
  sayOnce(text: string, seconds = 1.9) {
    if (this.msg.textContent === withKeys(text) && this.msgT > 0.5) return;
    this.say(text, seconds);
  }

  /** Escala de resolución de la calidad adaptativa (fase 15; 1 = la de la calidad elegida) */
  private scale = 1;
  setScale(s: number) { this.scale = s; }

  /** dt real del cuadro (s), tiempos de física y render (ms CPU) */
  frame(dt: number, physMs: number, renderMs: number, info: THREE.WebGLInfo) {
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    this.physAcc += physMs;
    this.renderAcc += renderMs;
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.msg.classList.remove('on');
    if (this.acc < 0.5) return;
    if (!this.perf) { this.frames = 0; this.acc = 0; this.worst = 0; this.physAcc = 0; this.renderAcc = 0; return; }
    const n = this.frames;
    const fps = n / this.acc;
    this.perf.innerHTML =
      h.perf(`<b class="${fps < 50 ? 'bad' : fps < 58 ? 'warn' : ''}">${fps.toFixed(0)} fps</b>`, (1000 * this.acc / n).toFixed(1),
        (1000 * this.worst).toFixed(1), (this.physAcc / n).toFixed(2), (this.renderAcc / n).toFixed(2), info.render.calls, info.render.triangles)
      + (this.scale < 0.999 ? h.scale(Math.round(this.scale * 100)) : '');
    this.frames = 0; this.acc = 0; this.worst = 0; this.physAcc = 0; this.renderAcc = 0;
  }

  readout(r: Readout) {
    const f = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
    const lmiCls = r.lmi >= 1 ? 'bad' : r.lmi >= 0.9 ? 'warn' : 'ok';
    this.data.innerHTML =
      `<div class="title">${this.title}${r.fine ? ` · <span class="warn">${h.fine}</span>` : ''}</div>` +
      (r.tower ? h.trolley(f(r.Lb), f(r.angDeg)) : h.boom(f(r.Lb), f(r.angDeg))) + '<br>' +
      h.radius(f(r.radius), f(r.headH)) + '<br>' +
      h.cable(f(r.cable)) + '<br>' +
      h.hook(r.load) + '<br>' +
      h.speed(f(Math.abs(r.speed) * 3.6), r.speed < -0.05) +
      (r.steerDeg === null ? '' : h.steer(f(r.steerDeg, 0))) +
      `<div class="lmi ${lmiCls}"><span>LMI</span><b>${Math.round(r.lmi * 100)} %</b>` +
      `<i><u style="width:${Math.min(100, (r.lmi / 1.25) * 100).toFixed(1)}%"></u><s></s></i></div>` +
      (r.bypass && !r.tipped ? `<div class="cut">${withKeys(h.bypass)}</div>` : '') +
      (r.tipped ? `<div class="cut">${h.tippedBadge}</div>`
        : r.cut ? `<div class="cut">${h.cut}</div>`
        : r.lmi >= 1 ? `<div class="bad">${h.over}</div>`
        : r.lmi >= 0.9 ? `<div class="warn">${h.near}</div>` : '') +
      (!r.tipped && r.tiltDeg > 0.05 ? `<div class="bad">${h.craneLifting(f(r.tiltDeg))}</div>` : '') +
      `${h.capacity} <b class="${r.mHook > r.rated ? 'bad' : ''}">${f(r.mHook)} / ${f(r.rated)} t</b><br>` +
      `${h.tension} <b>${f(r.tension, 2)} t</b><br>` +
      (r.side ? h.sideAngleMax(f(r.side.deg), r.side.deg > r.side.max ? 'bad' : r.side.deg > (r.side.max * 2) / 3 ? 'warn' : '', r.side.max) + '<br>' : '') +
      assemblyLine(r) +
      `<small>${h.support(r.mode)}</small>`;
  }
}
