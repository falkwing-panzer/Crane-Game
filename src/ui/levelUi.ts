import { CRANES, type CraneId } from '../crane/cranes';
import { LEVELS, type Level } from '../levels/levels';

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

const starText = (n: number) => `${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span>`;

/** URL de un nivel (1…13) con una grúa, o de la prueba libre (nivel 0) */
export function levelUrl(n: number, crane?: string) {
  const u = new URL(location.href);
  u.search = '';
  if (n > 0) u.searchParams.set('nivel', String(n));
  else u.searchParams.set('libre', '1');
  if (crane) u.searchParams.set('grua', crane);
  return u.toString();
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

  /** Menú: los 13 niveles con su tipo y sus estrellas, más la prueba libre */
  menu() {
    const rec = loadRecords();
    this.show(`<div class="eyebrow">Simulador de grúas</div><h2>Elige un trabajo</h2>
      <div class="levels">${LEVELS.map((L, i) => {
        const r = rec[i];
        return `<a class="lvl" href="${levelUrl(i + 1)}"><small>${i + 1} · ${L.type}</small><b>${L.name}</b>
          <span class="stars">${starText(r?.stars ?? 0)}</span><small>${r ? `récord ${fmt(r.time)}` : `par ${fmt(L.par)}`}</small></a>`;
      }).join('')}
      <a class="lvl free" href="${levelUrl(0)}"><small>Sin objetivo</small><b>Prueba libre</b><small>todas las grúas, obstáculos de prueba</small></a></div>`);
  }

  /**
   * Ficha del nivel (showBrief de la referencia): tipo, viento, par, límite, texto, consejos y grúas (las que no
   * sirven, desactivadas con el motivo). onPick recarga con otra grúa; onStart empieza el turno.
   */
  brief(i: number, current: CraneId, onPick: (id: CraneId) => void, onStart: () => void) {
    const L = LEVELS[i], r = loadRecords()[i];
    const list = Object.values(CRANES).sort((a, b) => a.structMax - b.structMax);
    this.show(`<div class="eyebrow"><span class="tag">${L.type}</span>Nivel ${i + 1} de ${LEVELS.length} · viento ${L.wind[0]} m/s · par ${fmt(L.par)}${L.time ? ` · límite ${fmt(L.time)}` : ''}${r ? ` · récord ${fmt(r.time)} ${starText(r.stars)}` : ''}</div>
      <h2>${L.name}</h2><p>${L.brief}</p><ul>${L.tips.map((t) => `<li>${t}</li>`).join('')}</ul>
      <div class="eyebrow">Elige la grúa</div>
      <div class="cranes">${list.map((c) => {
        const ok = L.cranes.includes(c.id as CraneId);
        const boom = c.boom.min === c.boom.max ? `${c.boom.min} m fija` : `${c.boom.min}–${c.boom.max} m`;
        const why = L.why[c.id as CraneId] || (c.structMax >= 300 ? 'Demasiado grande para esta obra' : 'Capacidad o alcance insuficientes');
        return `<button class="copt" data-c="${c.id}" aria-pressed="${c.id === current}" ${ok ? '' : 'disabled'}>
          <small>${c.size}${c.id === L.rec ? ' · recomendada' : ''}</small><b>${c.name}</b>
          <small>${c.structMax} t máx · pluma ${boom}</small><em class="${ok ? '' : 'why'}">${ok ? c.note : why}</em></button>`;
      }).join('')}</div>
      <div class="row"><a class="btn" href="${location.pathname}">Niveles</a><button class="btn primary" id="l-start">Empezar turno</button></div>`);
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
    this.show(`<div class="eyebrow">Nivel ${i + 1} completado · ${crane}</div><h2 class="okh">${L.name}</h2>
      <div class="stars big">${starText(n)}</div>${record ? '<p class="rec">¡Nuevo récord!</p>' : ''}
      <div class="stats"><span>Tiempo (par ${fmt(L.par)})</span><b>${fmt(res.t)}</b><span>Aterrizajes duros</span><b>${res.hard}</b>
      <span>Golpes</span><b>${res.bumps}</b><span>Alarmas de línea</span><b>${res.prox}</b><span>LMI máximo</span><b>${Math.round(res.maxLmi * 100)} %</b></div>
      <div class="row"><a class="btn" href="${location.pathname}">Niveles</a><a class="btn${next ? '' : ' primary'}" href="${levelUrl(i + 1)}">Repetir</a>
      ${next ? `<a class="btn primary" id="l-next" href="${levelUrl(i + 2)}">Siguiente nivel</a>` : ''}</div>
      ${next ? '' : '<p>Era el último trabajo. Vuelve por las tres estrellas en cada nivel o prueba otras grúas.</p>'}`);
    this.card.querySelector<HTMLElement>('#l-next')?.focus({ preventScroll: true });
  }

  /** Nivel fallido (fail de la referencia) */
  failed(i: number, crane: string, title: string, text: string) {
    this.show(`<div class="eyebrow">Nivel ${i + 1} fallido · ${crane}</div><h2>${title}</h2><p>${text}</p>
      <div class="row"><a class="btn" href="${location.pathname}">Niveles</a><a class="btn primary" id="l-retry" href="${location.href}">Repetir</a></div>`, true);
    this.card.querySelector<HTMLElement>('#l-retry')?.focus({ preventScroll: true });
  }

  /** Reloj: tiempo transcurrido, o el que queda en el contrarreloj */
  setClock(L: Level | null, t: number, n = 0) {
    this.clock.hidden = !L;
    if (!L) return;
    const left = L.time ? Math.max(0, L.time - t) : 0;
    this.clock.innerHTML = `<small>Nivel ${n} · ${L.name}</small><br><b class="${L.time && left < 30 ? 'bad' : ''}">${L.time ? `${fmt(left)} restantes` : fmt(t)}</b>` +
      `<small> · par ${fmt(L.par)}</small>`;
  }
}
