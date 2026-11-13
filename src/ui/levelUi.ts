import { CRANES, type CraneId } from '../crane/cranes';
import type { Level } from '../levels/levels';
import { ALL_LEVELS as LEVELS } from '../levels/tandemSetup';
import { stickyParams } from './settings';
import { t } from '../i18n';
import { withKeys } from './keys';

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
  private card: HTMLElement;
  private clock: HTMLElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', `
      <div class="panel clock" id="clock" hidden></div>
      <div class="overlay" id="overlay" hidden><div class="lcard" id="lcard"></div></div>`);
    this.overlay = root.querySelector('#overlay')!;
    this.card = root.querySelector('#lcard')!;
    this.clock = root.querySelector('#clock')!;
  }

  get open() { return !this.overlay.hidden; }

  private show(html: string, fail = false) {
    this.card.innerHTML = html;
    this.card.classList.toggle('fail', fail);
    this.overlay.hidden = false;
    this.overlay.scrollTop = 0;
  }

  close() { this.overlay.hidden = true; }

  /** Menú: los 13 niveles de la referencia y el de tándem (fase 10) con su tipo y sus estrellas, más las pruebas libres */
  menu() {
    const rec = loadRecords();
    this.show(`<div class="eyebrow">${tl.eyebrow}</div><h2>${tl.choose}</h2>
      <div class="levels">${LEVELS.map((L, i) => {
        const r = rec[i];
        return `<a class="lvl" href="${levelUrl(i + 1)}"><small>${i + 1} · ${L.type}</small><b>${L.name}</b>
          <span class="stars">${starText(r?.stars ?? 0)}</span><small>${r ? tl.record(fmt(r.time)) : tl.par(fmt(L.par))}</small></a>`;
      }).join('')}
      <a class="lvl free" href="${levelUrl(0)}"><small>${tl.noGoal}</small><b>${tl.free}</b><small>${tl.freeText}</small></a>
      <a class="lvl free" href="${homeUrl({ tandem: '1' })}"><small>${tl.noGoal}</small><b>${tl.freeTandem}</b><small>${tl.freeTandemText}</small></a></div>`);
  }

  /**
   * Ficha del nivel (showBrief de la referencia): tipo, viento, par, límite, texto, consejos y grúas (las que no
   * sirven, desactivadas con el motivo). onPick recarga con otra grúa; onStart empieza el turno.
   */
  brief(i: number, current: CraneId, onPick: (id: CraneId) => void, onStart: () => void) {
    const L = LEVELS[i], r = loadRecords()[i];
    const list = Object.values(CRANES).sort((a, b) => a.structMax - b.structMax);
    this.show(`<div class="eyebrow"><span class="tag">${L.type}</span>${tl.briefHead(i + 1, LEVELS.length, L.wind[0], fmt(L.par), L.time ? fmt(L.time) : null, r ? ` · ${tl.record(fmt(r.time))} ${starText(r.stars)}` : '')}</div>
      <h2>${L.name}</h2><p>${text3d(L.brief)}</p><ul>${L.tips.map((t) => `<li>${text3d(t)}</li>`).join('')}</ul>
      ${L.tandem ? tandemCranes(L) : `<div class="eyebrow">${tl.pick}</div>
      <div class="cranes">${list.map((c) => {
        const ok = L.cranes.includes(c.id as CraneId);
        const boom = c.boom.min === c.boom.max ? tl.boomFixed(c.boom.min) : tl.boomRange(c.boom.min, c.boom.max);
        const why = L.why[c.id as CraneId] || (c.structMax >= 300 ? tl.tooBig : tl.tooSmall);
        return `<button class="copt" data-c="${c.id}" aria-pressed="${c.id === current}" ${ok ? '' : 'disabled'}>
          <small>${c.size}${c.id === L.rec ? tl.recommended : ''}</small><b>${c.name}</b>
          <small>${tl.craneLine(c.structMax, boom)}</small><em class="${ok ? '' : 'why'}">${ok ? c.note : why}</em></button>`;
      }).join('')}</div>`}
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a><button class="btn primary" id="l-start">${tl.start}</button></div>`);
    this.card.querySelectorAll<HTMLButtonElement>('.copt').forEach((b) => {
      b.onclick = () => { if (b.dataset.c !== current) onPick(b.dataset.c as CraneId); };
    });
    const st = this.card.querySelector<HTMLButtonElement>('#l-start')!;
    st.onclick = () => { this.close(); onStart(); };
    st.focus({ preventScroll: true });
  }

  /** Nivel completado (checkWin de la referencia) */
  won(i: number, crane: string, res: { t: number; hard: number; bumps: number; prox: number; maxLmi: number }, record: boolean) {
    const L = LEVELS[i], n = stars(L, res), next = i + 1 < LEVELS.length;
    this.show(`<div class="eyebrow">${tl.won(i + 1, crane)}</div><h2 class="okh">${L.name}</h2>
      <div class="stars big">${starText(n)}</div>${record ? `<p class="rec">${tl.newRecord}</p>` : ''}
      <div class="stats"><span>${tl.time(fmt(L.par))}</span><b>${fmt(res.t)}</b><span>${tl.hard}</span><b>${res.hard}</b>
      <span>${tl.bumps}</span><b>${res.bumps}</b><span>${tl.prox}</span><b>${res.prox}</b><span>${tl.maxLmi}</span><b>${Math.round(res.maxLmi * 100)} %</b></div>
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a><a class="btn${next ? '' : ' primary'}" href="${levelUrl(i + 1)}">${tl.retry}</a>
      ${next ? `<a class="btn primary" id="l-next" href="${levelUrl(i + 2)}">${tl.next}</a>` : ''}</div>
      ${next ? '' : `<p>${tl.last}</p>`}`);
    this.card.querySelector<HTMLElement>('#l-next')?.focus({ preventScroll: true });
  }

  /** Nivel fallido (fail de la referencia) */
  failed(i: number, crane: string, title: string, text: string) {
    this.show(`<div class="eyebrow">${tl.failed(i + 1, crane)}</div><h2>${title}</h2><p>${withKeys(text)}</p>
      <div class="row"><a class="btn" href="${homeUrl()}">${tl.menuBtn}</a><a class="btn primary" id="l-retry" href="${location.href}">${tl.retry}</a></div>`, true);
    this.card.querySelector<HTMLElement>('#l-retry')?.focus({ preventScroll: true });
  }

  /**
   * Reloj (tiempo transcurrido, o el que queda en el contrarreloj), viento con una flecha hacia donde sopla vista desde
   * la cámara (arrow = ángulo en pantalla, 0 = hacia arriba, horario) y distancia libre a la línea eléctrica más cercana.
   */
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
    this.clock.innerHTML = `<small>${tl.clockHead(n, L.name)}</small><br><b class="${L.time && left < 30 ? 'bad' : ''}">${L.time ? tl.left(fmt(left)) : fmt(t)}</b>` +
      `<small> · ${tl.par(fmt(L.par))}</small>${extra ? `<br>${extra}` : ''}`;
  }
}
