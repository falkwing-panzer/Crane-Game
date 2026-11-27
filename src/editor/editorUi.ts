import { CRANES, bodyHalf, type CraneId } from '../crane/cranes';
import { t } from '../i18n';
import { BOX_KINDS, CRATE_KINDS, EDITOR_CRANES, ENVS, sanitizeLevel } from '../levels/custom';
import { KIND_COL } from '../levels/levels';
import { cached, pack } from '../share/codec';
import type { LevelUi } from '../ui/levelUi';
import { homeUrl } from '../ui/levelUi';
import { TOOLS, addAt, check, hitTest, loadSaved, moveSel, newDoc, removeSel, saveSite, selObj, type Doc, type Sel, type Tool } from './doc';

// Fase 28: editor de obras en el navegador (?editor=1, o ?editor=código para editar una obra). Planta en un lienzo 2D
// (como el plan de izaje) con herramientas, panel de lo seleccionado y de la obra, y botones para comprobar, probar,
// copiar el enlace y guardar en el navegador.

const te = t.editor;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Campos que se editan de cada tipo (número o texto) */
const FIELDS: Record<string, string[]> = {
  boxes: ['x', 'z', 'w', 'd', 'h', 'kind'], crates: ['label', 'x', 'z', 'w', 'd', 'h', 'm', 'kind', 'color'],
  zones: ['label', 'x', 'z', 'w', 'd', 'y', 'stack'], soft: ['x', 'z', 'w', 'd'], start: ['x', 'z', 'h'], rigger: ['x', 'z', 'y'],
  lines: ['y', 'clear', 'kv'], workers: ['speed', 'wait'],
};

export function showEditor(lui: LevelUi, go: (url: string) => void, initial: string | null) {
  const loaded = initial && initial !== '1' ? sanitizeLevel(cached(initial)) : null;
  const doc: Doc = loaded ? structuredClone(loaded) : newDoc();
  let tool: Tool = 'select', sel: Sel | null = null;

  lui.show(`<div class="eyebrow">${te.title}</div>
    <div class="ed">
      <div class="ed-left">
        <div class="ed-tools">${TOOLS.map((k) => `<button class="btn${k === 'select' ? ' on' : ''}" data-tool="${k}">${te.tools[k]}</button>`).join('')}</div>
        <canvas class="ed-cv" width="560" height="380"></canvas>
        <small class="dim">${te.toolsHelp}</small>
        <div class="ed-props"></div>
      </div>
      <div class="ed-right"></div>
    </div>
    <div class="ed-out"></div>
    <div class="row"><a class="btn" href="${homeUrl()}">${t.levels.menuBtn}</a><button class="btn" id="e-new">${te.fresh}</button>
      <select class="btn" id="e-open"><option value="">${te.open}</option>${loadSaved().map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select>
      <button class="btn" id="e-save">${te.save}</button><button class="btn" id="e-check">${te.check}</button>
      <button class="btn" id="e-copy">${te.copy}</button><button class="btn primary" id="e-play">${te.play}</button></div>`);
  const card = lui.card;
  card.classList.add('wide');
  const cv = card.querySelector<HTMLCanvasElement>('.ed-cv')!, g = cv.getContext('2d')!;
  const props = card.querySelector<HTMLElement>('.ed-props')!, right = card.querySelector<HTMLElement>('.ed-right')!;
  const out = card.querySelector<HTMLElement>('.ed-out')!;

  const size = () => [doc.size?.[0] ?? 84, doc.size?.[1] ?? 56] as const;
  const scale = () => { const [W, D] = size(); return Math.min((cv.width - 20) / W, (cv.height - 20) / D); };
  const toWorld = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(), k = scale();
    const px = ((e.clientX - r.left) * cv.width) / r.width, pz = ((e.clientY - r.top) * cv.height) / r.height;
    return { x: (px - 10) / k, z: (pz - 10) / k };
  };

  function draw() {
    const [W, D] = size(), k = scale(), P = (v: number) => 10 + v * k;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = doc.ground; g.fillRect(P(0), P(0), W * k, D * k);
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.strokeRect(P(0), P(0), W * k, D * k);
    const rect = (o: { x: number; z: number; w: number; d: number }, fill: string, stroke?: string) => {
      g.fillStyle = fill; g.fillRect(P(o.x - o.w / 2), P(o.z - o.d / 2), o.w * k, o.d * k);
      if (stroke) { g.strokeStyle = stroke; g.strokeRect(P(o.x - o.w / 2), P(o.z - o.d / 2), o.w * k, o.d * k); }
    };
    for (const s of doc.soft ?? []) rect(s, s.kind === 'water' ? 'rgba(60,120,180,0.6)' : 'rgba(110,80,45,0.7)');
    for (const b of doc.boxes) rect(b, b.color ?? KIND_COL[b.kind], 'rgba(0,0,0,0.4)');
    g.setLineDash([5, 4]);
    for (const z of doc.zones) rect(z, 'rgba(90,200,120,0.15)', '#5ac878');
    g.setLineDash([]);
    g.font = '11px system-ui'; g.textAlign = 'center';
    for (const z of doc.zones) { g.fillStyle = '#8fe0a5'; g.fillText(`${z.label}${z.y ? ` +${z.y}` : ''}`, P(z.x), P(z.z - z.d / 2) - 3); }
    for (const c of doc.crates) { rect(c, c.color, '#f2f4f6'); g.fillStyle = '#f2f4f6'; g.fillText(`${c.label} ${c.m} t`, P(c.x), P(c.z + c.d / 2) + 11); }
    for (const l of doc.lines ?? []) {
      g.strokeStyle = 'rgba(255,90,70,0.35)'; g.lineWidth = Math.max(2, 2 * l.clear * k);
      g.beginPath(); g.moveTo(P(l.a[0]), P(l.a[1])); g.lineTo(P(l.b[0]), P(l.b[1])); g.stroke();
      g.strokeStyle = '#ff5a46'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
    }
    for (const w of doc.workers ?? []) {
      g.strokeStyle = '#f5c542'; g.setLineDash([3, 3]); g.beginPath();
      w.pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke(); g.setLineDash([]);
    }
    for (const [x, z] of doc.lamps ?? []) { g.fillStyle = '#ffe2a0'; g.beginPath(); g.arc(P(x), P(z), 4, 0, 7); g.fill(); }
    if (doc.rigger) { g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(P(doc.rigger.x), P(doc.rigger.z), 5, 0, 7); g.fill(); }
    // grúa: el chasis de la recomendada, con su rumbo
    const T = CRANES[doc.rec], s0 = doc.start, h = -s0.h;
    const [L0, L1] = T.crawler ? [T.track!.xr, T.track!.xf] : T.len, hw = T.crawler ? T.track!.hw + 0.5 : bodyHalf(T);
    g.save(); g.translate(P(s0.x), P(s0.z)); g.rotate(-h);
    g.fillStyle = CRANES[doc.rec].color; g.fillRect(L0 * k, -hw * k, (L1 - L0) * k, 2 * hw * k);
    g.fillStyle = '#1b1d20'; g.beginPath(); g.moveTo(L1 * k, 0); g.lineTo((L1 - 1.5) * k, -0.8 * k); g.lineTo((L1 - 1.5) * k, 0.8 * k); g.fill();
    g.restore();
    if (sel) {
      const o = sel.list === 'start' ? { x: s0.x, z: s0.z, w: 6, d: 6 } : sel.list === 'rigger' ? { x: doc.rigger!.x, z: doc.rigger!.z, w: 3, d: 3 }
        : sel.list === 'lamps' ? { x: doc.lamps![sel.i][0], z: doc.lamps![sel.i][1], w: 3, d: 3 }
        : sel.list === 'lines' ? (() => { const l = doc.lines![sel.i]; return { x: (l.a[0] + l.b[0]) / 2, z: (l.a[1] + l.b[1]) / 2, w: Math.abs(l.b[0] - l.a[0]) + 2, d: Math.abs(l.b[1] - l.a[1]) + 2 }; })()
        : sel.list === 'workers' ? (() => { const xs = doc.workers![sel.i].pts.map((p) => p[0]), zs = doc.workers![sel.i].pts.map((p) => p[1]); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs) + 2, d: Math.max(...zs) - Math.min(...zs) + 2 }; })()
        : (doc[sel.list] as { x: number; z: number; w: number; d: number }[])[sel.i];
      if (o) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(P(o.x - o.w / 2) - 2, P(o.z - o.d / 2) - 2, o.w * k + 4, o.d * k + 4); g.lineWidth = 1; }
    }
  }

  function showProps() {
    const o = sel ? selObj(doc, sel) : null;
    if (!sel || (!o && sel.list !== 'lamps')) { props.innerHTML = `<div class="eyebrow">${te.props}</div><small class="dim">${te.none}</small>`; return; }
    const fields = sel.list === 'lamps' ? [] : FIELDS[sel.list] ?? [];
    const input = (f: string) => {
      const v = (o as Record<string, unknown>)[f];
      if (f === 'kind' && sel!.list === 'boxes') return `<select data-f="kind">${BOX_KINDS.map((k) => `<option${k === v ? ' selected' : ''}>${k}</option>`).join('')}</select>`;
      if (f === 'kind') return `<select data-f="kind">${CRATE_KINDS.map((k) => `<option${k === v ? ' selected' : ''}>${k}</option>`).join('')}</select>`;
      if (f === 'color') return `<input data-f="color" type="color" value="${esc(String(v ?? '#9a6a3a'))}">`;
      if (f === 'label' || f === 'kv') return `<input data-f="${f}" value="${esc(String(v ?? ''))}" maxlength="16">`;
      return `<input data-f="${f}" type="number" step="0.1" value="${v ?? ''}">`;
    };
    props.innerHTML = `<div class="eyebrow">${te.props}: ${te.tools[sel.list === 'start' ? 'crane' : sel.list === 'soft' ? 'mud' : sel.list === 'boxes' ? 'box' : sel.list.replace(/s$/, '')] ?? sel.list}</div>
      <div class="ed-fields">${fields.map((f) => `<label>${te.fields[f] ?? f} ${input(f)}</label>`).join('')}</div>
      ${sel.list === 'start' ? '' : `<button class="btn" id="e-del">${te.del}</button>`}`;
    props.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((el) => {
      el.onchange = () => {
        const f = el.dataset.f!, tgt = selObj(doc, sel!) as Record<string, unknown>;
        if (!tgt) return;
        if (el instanceof HTMLInputElement && el.type === 'number') {
          if (el.value === '' && f === 'stack') delete tgt.stack; else tgt[f] = Number(el.value);
        } else tgt[f] = el.value;
        draw();
      };
    });
    props.querySelector<HTMLButtonElement>('#e-del')?.addEventListener('click', () => { removeSel(doc, sel!); sel = null; showProps(); draw(); });
  }

  function showSite() {
    const ev = doc.events ?? [];
    const gust = ev.find((e) => e.kind === 'gust'), every = ev.filter((e) => e.kind === 'gust').length > 1 ? ev.filter((e) => e.kind === 'gust')[1].t - gust!.t : '';
    const fog = ev.some((e) => e.kind === 'fog'), storm = ev.find((e) => e.kind === 'storm');
    right.innerHTML = `<div class="eyebrow">${te.site}</div>
      <label>${te.name} <input id="s-name" maxlength="40" value="${esc(doc.name)}"></label>
      <label>${te.brief} <textarea id="s-brief" maxlength="400" rows="3">${esc(doc.brief)}</textarea></label>
      <label>${te.size} <span class="row3"><input id="s-w" type="number" value="${size()[0]}"><input id="s-d" type="number" value="${size()[1]}"></span></label>
      <label>${te.wind} <span class="row3"><input id="s-wb" type="number" step="0.5" value="${doc.wind[0]}"><input id="s-wg" type="number" step="0.5" value="${doc.wind[1]}"><input id="s-wd" type="number" value="${doc.wind[2]}"></span></label>
      <label>${te.par} <input id="s-par" type="number" value="${doc.par}"></label>
      <label>${te.time} <input id="s-time" type="number" value="${doc.time ?? ''}"></label>
      <div class="eyebrow">${te.cranes}</div>
      <div class="ed-cranes">${EDITOR_CRANES.map((id) => `<label><input type="checkbox" data-c="${id}"${doc.cranes.includes(id) ? ' checked' : ''}> ${CRANES[id].name}</label>`).join('')}</div>
      <label>${te.rec} <select id="s-rec">${doc.cranes.map((id) => `<option value="${id}"${id === doc.rec ? ' selected' : ''}>${CRANES[id].name}</option>`).join('')}</select></label>
      <label>${te.env} <select id="s-env">${ENVS.map((e) => `<option value="${e}"${e === doc.env ? ' selected' : ''}>${te.envs[e]}</option>`).join('')}</select></label>
      <label>${te.light} <select id="s-light">${['dia', 'atardecer', 'noche'].map((l) => `<option value="${l}"${(doc.light ?? 'dia') === l ? ' selected' : ''}>${te.lights[l]}</option>`).join('')}</select></label>
      <div class="eyebrow">${te.weather}</div>
      <label>${te.gusts} <span class="row3"><input id="s-ge" type="number" value="${every}"><input id="s-gv" type="number" step="0.5" value="${gust?.kind === 'gust' ? gust.v : 6}"></span></label>
      <label><input type="checkbox" id="s-fog"${fog ? ' checked' : ''}> ${te.fog}</label>
      <label>${te.storm} <input id="s-storm" type="number" value="${storm?.t ?? ''}"></label>
      <label><input type="checkbox" id="s-ridge"${doc.ridge ? ' checked' : ''}> ${te.ridge}</label>
      <label><input type="checkbox" id="s-check"${doc.checklist ? ' checked' : ''}> ${te.checklist}</label>`;
    const val = (id: string) => (right.querySelector(`#${id}`) as HTMLInputElement).value;
    const numOr = (id: string, d: number) => (val(id) === '' ? d : Number(val(id)));
    right.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      el.onchange = () => {
        doc.name = val('s-name') || doc.name;
        doc.brief = (right.querySelector('#s-brief') as HTMLTextAreaElement).value;
        doc.size = [Math.max(30, Math.min(240, numOr('s-w', 84))), Math.max(30, Math.min(240, numOr('s-d', 56)))];
        doc.wind = [numOr('s-wb', 0), numOr('s-wg', 0), numOr('s-wd', 0)];
        doc.par = numOr('s-par', 400);
        if (val('s-time') === '') delete doc.time; else doc.time = Number(val('s-time'));
        const cr = [...right.querySelectorAll<HTMLInputElement>('[data-c]')].filter((c) => c.checked).map((c) => c.dataset.c as CraneId);
        if (cr.length) doc.cranes = cr;
        doc.rec = doc.cranes.includes(val('s-rec') as CraneId) ? (val('s-rec') as CraneId) : doc.cranes[0];
        doc.env = val('s-env');
        const lt = val('s-light');
        if (lt === 'dia') delete doc.light; else doc.light = lt as 'atardecer' | 'noche';
        const evs: NonNullable<Doc['events']> = [];
        const ge = numOr('s-ge', 0), gv = numOr('s-gv', 6);
        if (ge >= 30) for (let k = 1; k * ge < 3600 && evs.length < 10; k++) evs.push({ kind: 'gust', t: k * ge, v: gv, dur: Math.min(60, ge / 2) });
        if ((right.querySelector('#s-fog') as HTMLInputElement).checked) evs.push({ kind: 'fog', t: 0, dur: 3600, dist: 90 });
        if (val('s-storm') !== '') evs.push({ kind: 'storm', t: Number(val('s-storm')), dur: 90 });
        if (evs.length) doc.events = evs; else delete doc.events;
        doc.ridge = (right.querySelector('#s-ridge') as HTMLInputElement).checked || undefined;
        doc.checklist = (right.querySelector('#s-check') as HTMLInputElement).checked || undefined;
        if (el.dataset.c || el.id === 's-rec') showSite();
        draw();
      };
    });
  }

  // lienzo: herramienta o seleccionar y arrastrar
  let drag: { x: number; z: number } | null = null;
  cv.onpointerdown = (e) => {
    const p = toWorld(e);
    if (tool === 'select') {
      sel = hitTest(doc, p.x, p.z);
      drag = sel ? p : null;
      if (sel) cv.setPointerCapture(e.pointerId);
    } else sel = addAt(doc, tool, p.x, p.z);
    showProps(); draw();
  };
  cv.onpointermove = (e) => {
    if (!drag || !sel) return;
    const p = toWorld(e);
    moveSel(doc, sel, p.x - drag.x, p.z - drag.z);
    drag = p;
    draw();
  };
  cv.onpointerup = () => { if (drag) { drag = null; showProps(); } };
  cv.tabIndex = 0;
  cv.onkeydown = (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { removeSel(doc, sel); sel = null; showProps(); draw(); e.preventDefault(); } };
  card.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => (b.onclick = () => {
    tool = b.dataset.tool as Tool;
    card.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
  }));

  const code = async () => {
    const L = sanitizeLevel(doc);
    if (!L) { out.innerHTML = `<p class="bad">${te.invalid}</p>`; return null; }
    return pack(L);
  };
  card.querySelector<HTMLButtonElement>('#e-check')!.onclick = () => {
    const r = check(doc);
    out.innerHTML = r ? `<ul>${r.map((x) => `<li class="${x.ok ? '' : 'bad'}">${x.ok ? te.checkOk(CRANES[x.id].name) : te.checkNo(CRANES[x.id].name, x.why === 'site' ? te.noSite : te.noReach(x.label ?? ''))}</li>`).join('')}</ul>` : `<p class="bad">${te.invalid}</p>`;
  };
  card.querySelector<HTMLButtonElement>('#e-play')!.onclick = async () => { const c = await code(); if (c) go(`${location.pathname}?obra=${c}`); };
  card.querySelector<HTMLButtonElement>('#e-copy')!.onclick = async () => {
    const c = await code();
    if (!c) return;
    const u = `${location.origin}${location.pathname}?obra=${c}`;
    out.innerHTML = `<p class="dim">${te.linkLen(u.length)}</p>`;
    void navigator.clipboard?.writeText(u).then(() => { out.innerHTML += `<p>${te.copied}</p>`; }, () => { out.innerHTML += `<p><code>${esc(u)}</code></p>`; });
  };
  card.querySelector<HTMLButtonElement>('#e-save')!.onclick = async () => { const c = await code(); if (c) { saveSite(doc.name, c); out.innerHTML = `<p>${te.saved}</p>`; } };
  card.querySelector<HTMLButtonElement>('#e-new')!.onclick = () => go(`${location.pathname}?editor=1`);
  card.querySelector<HTMLSelectElement>('#e-open')!.onchange = (e) => {
    const s = loadSaved()[Number((e.target as HTMLSelectElement).value)];
    if (s) go(`${location.pathname}?editor=${s.code}`);
  };

  showSite(); showProps(); draw();
}
