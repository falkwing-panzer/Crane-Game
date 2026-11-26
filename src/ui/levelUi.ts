import { CRANES, type CraneId } from '../crane/cranes';
import type { Level } from '../levels/levels';
import { ALL_LEVELS as LEVELS } from '../levels/tandemSetup';
import { medalHtml, progressHtml, smoothHtml } from './progressView';
import { loadSmooth } from './progress';
import type { SmoothScore } from '../game/smooth';
import type { Job } from '../game/session';
import { loadJobRecords } from './progress';
import { todayUTC } from '../levels/generate';
import { stickyParams } from './settings';
import { t } from '../i18n';
import { withKeys } from './keys';
import { schoolMenu } from './schoolUi';
import { PlanView } from './planView';
import { placeCrane } from '../levels/setup';
import type { Ghost } from '../levels/liftPlan';
import type { CraneState } from '../crane/kinematics';

const tl = t.levels;

// Pantallas de los niveles (HTML simple, como el HUD): menú de niveles, ficha de briefing con la elección de
// grúa (showBrief de la referencia), cartel de nivel completado o fallido (checkWin, fail), reloj y récords
// guardados en localStorage.

const STORE = 'gruas-records';

/** Récord de un nivel: mejores estrellas y mejor tiempo (s) */
export interface Record_ { stars: number; time: number }

export function loadRecords(): Record<number, Record_> {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

/** Guarda estrellas y tiempo si mejoran el récord; devuelve si alguno mejoró. */
export function saveRecord(i: number, stars: number, time: number): boolean {
  const all = loadRecords(), old = all[i];
  const better = !old || stars > old.stars || time < old.time;
  all[i] = { stars: Math.max(stars, old?.stars ?? 0), time: Math.min(time, old?.time ?? Infinity) };
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* sin almacenamiento: no pasa nada */ }
  return better;
}

/** Estrellas (checkWin de la referencia): 3 − aterrizaje duro − (golpes + alarmas de línea) − pasarse del par */
export function stars(L: Level, r: { t: number; hard: number; bumps: number; prox: number }) {
  return Math.max(1, 3 - (r.hard > 0 ? 1 : 0) - (r.bumps + r.prox > 0 ? 1 : 0) - (r.t > L.par ? 1 : 0));
}

/** mm:ss (fmt de la referencia) */
export const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Textos de la referencia que hablan de sus dos vistas 2D (planta y lateral): en la ficha se muestran adaptados a las
 * cámaras 3D. Los datos de LEVELS no se tocan (la prueba los compara con el HTML).
 */
export const TEXT_3D: Record<string, string> = tl.text3d;
const text3d = (s: string) => withKeys(TEXT_3D[s] ?? s);

/** Tándem (fase 10): las dos grúas ya están colocadas y montadas; no se eligen */
/** Lo que el resumen necesita del turno (Run) */
export interface LiftStats { maxLmi: number; peakLabel: string; peakMass: number; peakR: number; peakCrane: string; maxR: number; maxRLabel: string; heavy: number; heavyLabel: string }

/**
 * Resumen del izaje más exigente (fase 20): LMI máximo con su carga y su radio, radio máximo con carga y carga más
 * pesada. Vacío si no se colgó nada. withLmi: también el LMI máximo (el cartel de nivel fallido no tiene la tabla).
 */
export function liftHtml(r: { maxLmi: number } & Partial<LiftStats>, tandem: boolean, withLmi = false) {
  if (!r.peakLabel) return '';
  const f = (v: number) => v.toFixed(1).replace('.', ',');
  return `<div class="eyebrow">${tl.liftHead}</div><div class="stats">` +
    (withLmi ? `<span>${tl.maxLmi}</span><b>${Math.round(r.maxLmi * 100)} %</b>` : '') +
    `<span>${tl.peakAt}</span><b>${tl.peak(r.peakLabel, f(r.peakMass ?? 0), f(r.peakR ?? 0), tandem ? r.peakCrane ?? '' : '')}</b>` +
    `<span>${tl.maxR}</span><b>${tl.maxRVal(f(r.maxR ?? 0), r.maxRLabel ?? '')}</b>` +
    `<span>${tl.heavy}</span><b>${tl.heavyVal(r.heavyLabel ?? '', f(r.heavy ?? 0))}</b></div>`;
}

function tandemCranes(L: Level) {
  const td = L.tandem!;
  const card = (id: CraneId, role: string, what: string) => {
    const c = CRANES[id];
    return `<div class="copt" aria-pressed="true"><small>${role}</small><b>${c.name}</b><small>${tl.maxT(c.structMax)}</small><em>${what}</em></div>`;
  };
  return `<div class="eyebrow">${withKeys(tl.tandemHead)}</div><div class="cranes">
    ${card(td.main.id, tl.main, tl.mainText)}
    ${card(td.tail.id, tl.tail, tl.tailText)}</div>`;
}

/** Cabecera de la ficha de un trabajo con obra propia */
function jobHead(job: Job, L: Level, r?: { stars: number; time: number }) {
  return `${job.head} · viento ${L.wind[0]} m/s · par ${fmt(L.par)}${r ? ` · ${tl.record(fmt(r.time))} ${starText(r.stars)}` : ''}`;
}

function jobBrief(_job: Job, L: Level) {
  return L.brief || t.daily.brief(L.crates.length, CRANES[L.rec].name);
}

const starText = (n: number) => `${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span>`;

/** URL de un nivel (1…13) con una grúa, o de la prueba libre (nivel 0); conserva ?fps= */
export function levelUrl(n: number, crane?: string) {
  const u = new URL(location.href);
  const keep = stickyParams(u.search);
  u.search = '';
  if (n > 0) u.searchParams.set('nivel', String(n));
  else u.searchParams.set('libre', '1');
  if (crane) u.searchParams.set('grua', crane);
  for (const [k, v] of keep) u.searchParams.set(k, v);
  return u.toString();
}

/** URL del menú de niveles (o con extra, p. ej. tandem=1), conservando ?fps= */
export function homeUrl(extra: Record<string, string> = {}) {
  const q = new URLSearchParams([...Object.entries(extra), ...stickyParams(location.search)]).toString();
  return location.pathname + (q ? `?${q}` : '');
}

export class LevelUi {
  private overlay: HTMLElement;
  /** Tarjeta del cartel abierto (la escuela le busca sus botones) */
  readonly card: HTMLElement;
  private clock: HTMLElement;
  private clockText: HTMLElement;
  private saveBtn: HTMLButtonElement;
  /** Botón Guardar (fase 15): guardar a mitad del nivel */
  onSave: () => void = () => {};
  /** Plan de izaje (fase 20): el fantasma de cada nivel y grúa, para que siga donde se dejó al volver a abrirlo */
  private ghosts = new Map<string, Ghost>();
  private planView: PlanView | null = null;
  /** Trabajo con obra propia (reto diario, contratos): su nivel, su cabecera y su récord */
  job: Job | null = null;
  /** El nivel i, o el del trabajo */
  private lvl(i: number) { return this.job?.L ?? LEVELS[i]; }
  private rec(i: number) { return this.job ? loadJobRecords()[this.job.key] : loadRecords()[i]; }
  /** URL del mismo trabajo con otra grúa (o sin grúa) */
  url(i: number, crane?: string) {
    if (!this.job) return levelUrl(i + 1, crane);
    return location.pathname + this.job.url + (crane ? `&grua=${crane}` : '');
  }

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `
      <div class="panel clock" id="clock" hidden><div class="clock-text"></div><button class="save-btn" id="l-save">${tl.save}</button></div>
      <div class="overlay" id="overlay" hidden><div class="lcard" id="lcard"></div></div>`);
    this.overlay = root.querySelector('#overlay')!;
    this.card = root.querySelector('#lcard')!;
    this.clock = root.querySelector('#clock')!;
    this.clockText = this.clock.querySelector('.clock-text')!;
    const sv = this.saveBtn = this.clock.querySelector<HTMLButtonElement>('#l-save')!;
    sv.addEventListener('click', () => { this.onSave(); sv.blur(); });
  }

  get open() { return !this.overlay.hidden; }

  /** Muestra un cartel (también los de la escuela, fase 19) */
  show(html: string, fail = false) {
    this.card.innerHTML = html;
    this.card.classList.toggle('fail', fail);
    this.overlay.hidden = false;
    this.overlay.scrollTop = 0;
  }

  close() { this.overlay.hidden = true; }

  /** Menú: los 13 niveles de la referencia y el de tándem (fase 10) con su tipo y sus estrellas, más las pruebas libres */
  menu() {
    const rec = loadRecords(), sm = loadSmooth(), today = todayUTC(), dr = loadJobRecords()[`reto-${today}`];
    this.show(`<div class="eyebrow">${tl.eyebrow}</div>${schoolMenu()}<h2>${tl.choose}</h2>
      <div class="levels"><a class="lvl daily" href="${location.pathname}?reto=${today}"><small>${t.daily.head(today)}</small><b>${t.daily.menu}</b>
        <span class="stars">${starText(dr?.stars ?? 0)}</span><small>${t.daily.today(dr ? fmt(dr.time) : null)}</small></a></div>
      <div class="levels">${LEVELS.map((L, i) => {
        const r = rec[i];
        return `<a class="lvl" href="${levelUrl(i + 1)}"><small>${i + 1} · ${L.type}</small><b>${L.name}</b>
          <span class="stars">${starText(r?.stars ?? 0)}${medalHtml(sm[i])}</span><small>${r ? tl.record(fmt(r.time)) : tl.par(fmt(L.par))}</small></a>`;
      }).join('')}
      <a class="lvl free" href="${levelUrl(0)}"><small>${tl.noGoal}</small><b>${tl.free}</b><small>${tl.freeText}</small></a>
      <a class="lvl free" href="${homeUrl({ tandem: '1' })}"><small>${tl.noGoal}</small><b>${tl.freeTandem}</b><small>${tl.freeTandemText}</small></a></div>
      <div class="row"><button class="btn" id="l-progress">${t.progress.menuBtn}</button></div>`);
    this.card.querySelector<HTMLButtonElement>('#l-progress')!.onclick = () => this.progress();
  }

  /** Estadísticas y logros (fase 22); Volver, al menú */
  progress() {
    this.show(progressHtml());
    const b = this.card.querySelector<HTMLButtonElement>('#p-back')!;
    b.onclick = () => this.menu();
    b.focus({ preventScroll: true });
  }

  /**
   * Ficha del nivel (showBrief de la referencia): tipo, viento, par, límite, texto, consejos y grúas (las que no
   * sirven, desactivadas con el motivo). onPick recarga con otra grúa; onStart empieza el turno.
   */
  brief(i: number, current: CraneId, onPick: (id: CraneId) => void, onStart: () => void, cont?: { t: number; crane: string; go: () => void }) {
    const L = this.lvl(i), r = this.rec(i), job = this.job;
    const list = Object.values(CRANES).sort((a, b) => a.structMax - b.structMax);
    this.show(`<div class="eyebrow"><span class="tag">${L.type}</span>${job ? jobHead(job, L, r) : tl.briefHead(i + 1, LEVELS.length, L.wind[0], fmt(L.par), L.time ? fmt(L.time) : null, r ? ` · ${tl.record(fmt(r.time))} ${starText(r.stars)}` : '')}</div>
      <h2>${L.name}</h2><p>${job ? jobBrief(job, L) : text3d(L.brief)}</p>${job?.rival ? `<p class="rec">${t.daily.rival(fmt(job.rival))}</p><p class="dim">${t.daily.rivalNote}</p>` : ''}
      <ul>${(job ? [t.daily.tip1, t.daily.tip2] : L.tips).map((t) => `<li>${text3d(t)}</li>`).join('')}</ul>
      ${L.tandem ? tandemCranes(L) : `<div class="eyebrow">${tl.pick}</div>
      <div class="cranes">${list.map((c) => {
        const ok = L.cranes.includes(c.id as CraneId);
        const boom = c.boom.min === c.boom.max ? tl.boomFixed(c.boom.min) : tl.boomRange(c.boom.min, c.boom.max);
        const why = L.why[c.id as CraneId] || (c.structMax >= 300 ? tl.tooBig : tl.tooSmall);
        return `<button class="copt" data-c="${c.id}" aria-pressed="${c.id === current}" ${ok ? '' : 'disabled'}>
          <small>${c.size}${c.id === L.rec ? tl.recommended : ''}</small><b>${c.name}</b>
          <small>${tl.craneLine(c.structMax, boom)}</small><em class="${ok ? '' : 'why'}">${ok ? c.note : why}</em></button>`;
      }).join('')}</div>`}
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a>${L.tandem ? '' : `<button class="btn" id="l-plan">${t.plan.open}</button>`}${cont ? `<button class="btn" id="l-cont">${tl.cont(fmt(cont.t), cont.crane)}</button>` : ''}<button class="btn primary" id="l-start">${tl.start}</button></div>`);
    const cb = this.card.querySelector<HTMLButtonElement>('#l-cont');
    if (cb && cont) cb.onclick = () => { this.close(); cont.go(); };
    this.card.querySelectorAll<HTMLButtonElement>('.copt').forEach((b) => {
      b.onclick = () => { if (b.dataset.c !== current) onPick(b.dataset.c as CraneId); };
    });
    const st = this.card.querySelector<HTMLButtonElement>('#l-start')!;
    st.onclick = () => { this.close(); onStart(); };
    st.focus({ preventScroll: true });
    const pb = this.card.querySelector<HTMLButtonElement>('#l-plan');
    if (pb) pb.onclick = () => this.plan(i, current, () => this.brief(i, current, onPick, onStart, cont), () => { this.close(); onStart(); });
  }

  /**
   * Plan de izaje (fase 20): la planta con la grúa fantasma, en la misma tarjeta que la ficha. back = volver a la
   * ficha; start = empezar el turno.
   */
  plan(i: number, crane: CraneId, back: () => void, start: () => void) {
    const L = this.lvl(i), T = CRANES[crane];
    const S = { x: 0, z: 0, h: 0 } as CraneState;
    placeCrane(T, S, L);
    const home: Ghost = { x: S.x, z: S.z, h: S.h };
    const key = `${i}|${crane}`;
    let g = this.ghosts.get(key);
    if (!g) this.ghosts.set(key, g = { ...home });
    this.show(`<div class="eyebrow"><span class="tag">${L.type}</span>${this.job ? this.job.head : tl.clockHead(i + 1, L.name)}</div>
      <h2>${t.plan.title(L.name, T.name)}</h2><div class="plan"></div>
      <div class="row"><button class="btn" id="p-back">${t.plan.back}</button><button class="btn primary" id="p-start">${tl.start}</button></div>`);
    this.planView?.dispose();
    this.planView = new PlanView(this.card.querySelector('.plan')!, T, L, g, home);
    const close = () => { this.planView?.dispose(); this.planView = null; };
    this.card.querySelector<HTMLButtonElement>('#p-back')!.onclick = () => { close(); back(); };
    const ps = this.card.querySelector<HTMLButtonElement>('#p-start')!;
    ps.onclick = () => { close(); start(); };
  }

  /** Nivel completado (checkWin de la referencia) */
  won(i: number, crane: string, res: { t: number; hard: number; bumps: number; prox: number; maxLmi: number } & Partial<LiftStats>, record: boolean,
    smooth?: SmoothScore | null, smoothBest = false) {
    const L = this.lvl(i), n = stars(L, res), job = this.job, next = !job && i + 1 < LEVELS.length;
    this.show(`<div class="eyebrow">${job ? `${job.head} · ${crane}` : tl.won(i + 1, crane)}</div><h2 class="okh">${L.name}</h2>
      <div class="stars big">${starText(n)}</div>${record ? `<p class="rec">${tl.newRecord}</p>` : ''}
      <div class="stats"><span>${tl.time(fmt(L.par))}</span><b>${fmt(res.t)}</b><span>${tl.hard}</span><b>${res.hard}</b>
      <span>${tl.bumps}</span><b>${res.bumps}</b><span>${tl.prox}</span><b>${res.prox}</b><span>${tl.maxLmi}</span><b>${Math.round(res.maxLmi * 100)} %</b></div>${smoothHtml(smooth, smoothBest)}${liftHtml(res, !!L.tandem)}
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a>${job?.date ? `<button class="btn" id="l-share">${t.daily.share}</button>` : ''}<a class="btn${next ? '' : ' primary'}" href="${this.url(i)}">${tl.retry}</a>
      ${next ? `<a class="btn primary" id="l-next" href="${levelUrl(i + 2)}">${tl.next}</a>` : ''}</div>
      ${next || job ? '' : `<p>${tl.last}</p>`}`);
    const sh = this.card.querySelector<HTMLButtonElement>('#l-share');
    if (sh && job?.date) sh.onclick = () => {
      const u = new URL(location.pathname, location.href);
      u.search = `?reto=${job.date}&t=${Math.ceil(res.t)}`;
      void navigator.clipboard?.writeText(u.toString()).then(() => { sh.textContent = t.daily.copied; }, () => { sh.textContent = u.toString(); });
    };
    this.card.querySelector<HTMLElement>('#l-next')?.focus({ preventScroll: true });
  }

  /** Nivel fallido (fail de la referencia) */
  failed(i: number, crane: string, title: string, text: string, res?: { maxLmi: number } & Partial<LiftStats>, onReplay?: () => void) {
    this.show(`<div class="eyebrow">${this.job ? `${this.job.head} · ${crane}` : tl.failed(i + 1, crane)}</div><h2>${title}</h2><p>${withKeys(text)}</p>${res ? liftHtml(res, !!this.lvl(i).tandem, true) : ''}
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a>${onReplay ? `<button class="btn" id="l-replay">${t.replay.again}</button>` : ''}<a class="btn primary" id="l-retry" href="${this.job ? this.url(i) : location.href}">${tl.retry}</a></div>`, true);
    const rb = this.card.querySelector<HTMLButtonElement>('#l-replay');
    if (rb && onReplay) rb.onclick = () => onReplay();
    this.card.querySelector<HTMLElement>('#l-retry')?.focus({ preventScroll: true });
  }

  /**
   * Reloj (tiempo transcurrido, o el que queda en el contrarreloj), viento con una flecha hacia donde sopla vista desde
   * la cámara (arrow = ángulo en pantalla, 0 = hacia arriba, horario) y distancia libre a la línea eléctrica más cercana.
   */
  /** Guardar solo con el turno en marcha */
  showSave(on: boolean) {
    if (this.saveBtn.hidden === on) this.saveBtn.hidden = !on;
  }

  setClock(L: Level | null, t: number, n = 0, info?: { wind: number; arrow: number; lineD: number }) {
    this.clock.hidden = !L;
    if (!L) return;
    const left = L.time ? Math.max(0, L.time - t) : 0;
    const f = (v: number) => v.toFixed(1).replace('.', ',');
    let extra = '';
    if (info && (L.wind[0] || L.wind[1])) {
      extra += `<span class="${info.wind > 7 ? 'warn' : ''}">${tl.wind(f(info.wind))} ` +
        `<i class="arrow" style="transform:rotate(${info.arrow.toFixed(0)}deg)">↑</i></span>`;
    }
    if (info && L.lines?.length && Number.isFinite(info.lineD)) {
      extra += `${extra ? ' · ' : ''}<span class="${info.lineD < 0 ? 'bad' : info.lineD < 2 ? 'bad blink' : ''}">${tl.line(f(Math.max(0, info.lineD)))}</span>`;
    }
    this.clockText.innerHTML = `<small>${this.job ? `${this.job.head} · ${L.name}` : tl.clockHead(n, L.name)}</small><br><b class="${L.time && left < 30 ? 'bad' : ''}">${L.time ? tl.left(fmt(left)) : fmt(t)}</b>` +
      `<small> · ${tl.par(fmt(L.par))}</small>${extra ? `<br>${extra}` : ''}`;
  }
}
