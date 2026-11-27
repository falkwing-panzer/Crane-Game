import { CRANES } from '../crane/cranes';
import { ACHIEVEMENTS } from '../game/achievements';
import { medalFor, type SmoothScore } from '../game/smooth';
import { loadAchievements, loadStats } from './progress';
import { t } from '../i18n';

// Suavidad en el cartel de nivel completado, medalla en el menú, pantalla de estadísticas y logros, aviso de logro
// (fase 22).

const tp = t.progress;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');
const n0 = (v: number) => Math.round(v).toLocaleString('es');
const MEDAL_ICON = { oro: '🥇', plata: '🥈', bronce: '🥉' } as const;

/** Medalla de una nota (vacío si no hay) */
export function medalHtml(score: number | undefined) {
  const m = score === undefined ? null : medalFor(score);
  return m ? `<span class="medal ${m}" title="${tp.smoothHead}: ${score}">${MEDAL_ICON[m]}</span>` : '';
}

/** Bloque de suavidad del cartel de nivel completado */
export function smoothHtml(sm: SmoothScore | null | undefined, best: boolean) {
  if (sm === undefined) return '';
  if (!sm) return `<div class="eyebrow">${tp.smoothHead}</div><p class="dim">${tp.smoothNone}</p>`;
  const medal = sm.medal ? tp.medal[sm.medal] : tp.noMedal;
  return `<div class="eyebrow">${tp.smoothHead}</div>
    <div class="smooth"><b>${sm.medal ? MEDAL_ICON[sm.medal] + ' ' : ''}${tp.smoothScore(sm.score, medal)}</b>${best ? `<small class="rec">${tp.smoothBest}</small>` : ''}</div>
    <div class="stats"><span>${tp.swing}</span><b>${f1(sm.swing)}° (máx ${f1(sm.swingMax)}°)</b>
    <span>${tp.jerk}</span><b>+${Math.round(sm.jerk)} %</b><span>${tp.acc}</span><b>${f1(sm.acc)} m/s²</b></div>`;
}

const hm = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};

/** Pantalla de estadísticas y logros */
export function progressHtml() {
  const st = loadStats(), have = loadAchievements();
  const km = st.meters >= 1000 ? `${f1(st.meters / 1000)} km` : `${n0(st.meters)} m`;
  const hours = Object.entries(st.secs).filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1])
    .map(([id, s]) => `<span>${CRANES[id as keyof typeof CRANES]?.name ?? id}</span><b>${hm(s)}</b>`).join('');
  const rows: [string, string][] = [
    [tp.tons, `${n0(st.tons)} t`], [tp.lifts, n0(st.lifts)], [tp.clean, `${st.clean} (${st.bestClean})`],
    [tp.heaviest, `${f1(st.heaviest)} t`], [tp.meters, km], [tp.levels, n0(st.levels)],
    [tp.bumps, n0(st.bumps)], [tp.hard, n0(st.hard)], [tp.tips, n0(st.tips)],
  ];
  const got = ACHIEVEMENTS.filter((a) => have[a.id]).length;
  const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
  return `<div class="eyebrow">${t.levels.eyebrow}</div><h2>${tp.title}</h2>
    <div class="eyebrow">${tp.statsHead}</div>
    <div class="stats">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
    <div class="eyebrow">${tp.hours}</div><div class="stats">${hours || `<span>${tp.none}</span><b></b>`}</div>
    <div class="eyebrow">${tp.achHead(got, ACHIEVEMENTS.length)}</div>
    ${groups.map((g) => `<div class="ach-group"><small>${tp.groups[g]}</small><div class="achs">${ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
      const [title, text] = tp.ach[a.id];
      return `<div class="ach${have[a.id] ? ' got' : ''}" data-a="${a.id}"><b>${have[a.id] ? '🏆' : '·'} ${title}</b><small>${text}</small></div>`;
    }).join('')}</div></div>`).join('')}
    <div class="row"><button class="btn primary" id="p-back">${tp.back}</button></div>`;
}

/** Aviso de logro conseguido: arriba en el centro, unos segundos; si llegan varios, uno detrás de otro */
export class AchievementToast {
  private el: HTMLElement;
  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', '<div class="ach-toast" hidden></div>');
    this.el = root.lastElementChild as HTMLElement;
  }

  push(id: string) {
    const a = tp.ach[id];
    if (!a) return;
    this.queue.push(`<b>🏆 ${tp.toast(a[0])}</b><small>${a[1]}</small>`);
    if (!this.timer) this.next();
  }

  private next() {
    const html = this.queue.shift();
    if (html === undefined) { this.el.hidden = true; this.timer = null; return; }
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.timer = setTimeout(() => this.next(), 4000);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.el.remove();
  }
}
