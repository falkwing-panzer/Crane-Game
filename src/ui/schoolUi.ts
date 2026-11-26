import type { Lesson, SchoolState } from '../school/lessons';
import { LESSONS } from '../school/lessons';
import { stickyParams } from './settings';
import { keyLabel, activeKeys, withKeys, type Action } from './keys';
import { t } from '../i18n';

const ts = t.school;

// Escuela de operadores (fase 19): lecciones hechas (localStorage), URL de cada lección, panel del paso actual
// arriba en el centro, presentación y cartel de lección superada.

const STORE = 'gruas-escuela';

/** Lecciones terminadas (números 1…6) */
export function loadSchool(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n >= 1 && n <= LESSONS.length) : [];
  } catch { return []; }
}

/** Marca una lección como hecha */
export function markSchool(n: number) {
  const done = new Set(loadSchool());
  done.add(n);
  try { localStorage.setItem(STORE, JSON.stringify([...done].sort((a, b) => a - b))); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** URL de una lección (conserva ?fps= y ?calidad=) */
export function schoolUrl(n: number) {
  const q = new URLSearchParams([['escuela', String(n)], ...stickyParams(location.search)]).toString();
  return `${location.pathname}?${q}`;
}

/** Tarjetas de la escuela en el menú de niveles */
export function schoolMenu(): string {
  const done = new Set(loadSchool());
  return `<div class="eyebrow">${ts.menuHead}</div><p class="school-text">${ts.menuText}</p>
    <div class="levels school">${LESSONS.map((L) => `<a class="lvl${done.has(L.n) ? ' done' : ''}" href="${schoolUrl(L.n)}">` +
      `<small>${ts.lessonN(L.n)}</small><b>${ts.lessons[L.n - 1].title}</b><small>${done.has(L.n) ? ts.doneMark : ts.todo}</small></a>`).join('')}</div>`;
}

/** Teclas de un paso como chips (la tecla que tenga el jugador) */
const chips = (keys: Action[]) => keys.map((a) => `<kbd>${keyLabel(activeKeys()[a])}</kbd>`).join('');

/** Panel de la lección: título, paso actual con su texto y sus teclas, y puntos de progreso */
export class SchoolPanel {
  private el: HTMLElement;
  private shown = '';

  constructor(root: HTMLElement, private lesson: Lesson) {
    root.insertAdjacentHTML('beforeend', '<div class="panel lesson" id="lesson" hidden></div>');
    this.el = root.querySelector('#lesson')!;
  }

  /** Viento de la obra (solo en las lecciones con viento), m/s */
  wind(v: number) {
    if (!this.lesson.site.wind[0] && !this.lesson.site.wind[1]) return;
    const w = this.el.querySelector<HTMLElement>('.wind');
    const txt = ` · ${ts.wind(v.toFixed(1).replace('.', ','))}`;
    if (w && w.textContent !== txt) w.textContent = txt;
  }

  /** Teclas del paso actual (para resaltarlas en la línea de abajo) */
  keys(sch: SchoolState): Action[] { return this.lesson.steps[sch.step]?.keys ?? []; }

  /** Vuelve a pintar si cambió el paso, si se abrió o cerró, o si cambiaron las teclas */
  update(sch: SchoolState, visible: boolean, force = false) {
    const { lesson } = this, n = lesson.steps.length, tx = ts.lessons[lesson.n - 1];
    const key = `${visible}|${sch.step}|${sch.done}`;
    if (key === this.shown && !force) return;
    this.shown = key;
    this.el.hidden = !visible;
    if (!visible) return;
    const i = Math.min(sch.step, n - 1);
    const dots = lesson.steps.map((_, k) => `<i class="${k < sch.step ? 'ok' : k === sch.step ? 'now' : ''}"></i>`).join('');
    this.el.innerHTML = `<small>${ts.head(lesson.n, LESSONS.length)} · <b>${tx.title}</b><span class="wind"></span></small>` +
      `<div class="dots">${dots}<small>${ts.stepOf(i + 1, n)}</small></div>` +
      `<p>${withKeys(tx.steps[i])}</p><div class="chips">${chips(lesson.steps[i].keys)}</div>`;
  }
}

/** Presentación de la lección (antes de empezar) */
export function introHtml(lesson: Lesson): string {
  const tx = ts.lessons[lesson.n - 1];
  return `<div class="eyebrow">${ts.head(lesson.n, LESSONS.length)}</div><h2>${tx.title}</h2><p>${withKeys(tx.intro)}</p>
    <ol>${tx.steps.map((s) => `<li>${withKeys(s)}</li>`).join('')}</ol><p class="hint">${withKeys(ts.rewindTip)}</p>
    <div class="row"><a class="btn" href="${location.pathname}${menuQuery()}">${ts.menu}</a><button class="btn primary" id="s-start">${ts.start}</button></div>`;
}

/** Cartel de lección superada: siguiente lección o, al terminar la escuela, el nivel 1 */
export function passedHtml(lesson: Lesson, level1: string): string {
  const last = lesson.n >= LESSONS.length;
  return `<div class="eyebrow">${ts.head(lesson.n, LESSONS.length)}</div><h2 class="okh">${ts.passed(lesson.n)}</h2>
    ${last ? `<p>${ts.allDone}</p>` : ''}
    <div class="row"><a class="btn" href="${location.pathname}${menuQuery()}">${ts.menu}</a><a class="btn" href="${schoolUrl(lesson.n)}">${ts.repeat}</a>` +
    `<a class="btn primary" id="s-next" href="${last ? level1 : schoolUrl(lesson.n + 1)}">${last ? ts.level1 : ts.next}</a></div>`;
}

function menuQuery() {
  const q = new URLSearchParams(stickyParams(location.search)).toString();
  return q ? `?${q}` : '';
}
