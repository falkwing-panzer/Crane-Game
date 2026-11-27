import { CRANES, type CraneId } from '../crane/cranes';
import { t } from '../i18n';
import type { LevelUi } from '../ui/levelUi';
import { homeUrl } from '../ui/levelUi';
import {
  buy, cranesFor, exportCareer, finish, importCareer, loadCareer, maintain, maintenanceOf, newCareer, offerLevel, priceOf,
  rentOf, saveCareer, sell, settle, usable, type Career, type Outcome, type Settle,
} from './career';
import { careerLic } from './job';

// Pantalla de la carrera (fase 25, ?carrera=1) y cuentas al terminar un contrato. Los contratos se juegan como
// cualquier nivel (?contrato=k): ficha, turno, cartel; al final se cobran y se pasa al día siguiente.

const tc = t.career;
const eur = (v: number) => tc.eur(v);

/** Pinta la pantalla de la carrera en la tarjeta de LevelUi */
export function showCareer(lui: LevelUi, go: (url: string) => void) {
  const c = loadCareer() ?? (() => { const n = newCareer(); saveCareer(n); return n; })();
  const lic = careerLic();
  const rerender = () => showCareer(lui, go);
  const fleet = c.fleet.map((f) => `<div class="copt" aria-pressed="true"><small>${CRANES[f.id].size}</small><b>${CRANES[f.id].name}</b>
      <small>${tc.wear(f.wear)}</small><span class="row">${f.wear ? `<button class="btn" data-m="${f.id}">${tc.maintain(eur(maintenanceOf(f)))}</button>` : ''}
      ${c.fleet.length > 1 ? `<button class="btn" data-s="${f.id}">${tc.sell(eur(Math.round(priceOf(f.id) * 0.6 * (1 - f.wear / 200) / 50) * 50))}</button>` : ''}</span></div>`).join('');
  const shop = usable(lic).filter((id) => !c.fleet.some((f) => f.id === id)).sort((a, b) => priceOf(a) - priceOf(b))
    .map((id) => `<div class="copt"><small>${CRANES[id].size} · ${tc.rentDay(eur(rentOf(id)))}</small><b>${CRANES[id].name}</b>
      <button class="btn" data-b="${id}"${c.money < priceOf(id) ? ' disabled' : ''}>${tc.buy(eur(priceOf(id)))}</button></div>`).join('');
  const offers = c.offers.map((o, k) => {
    const L = offerLevel(o);
    if (!L) return '';
    const ids = cranesFor(L, lic);
    return `<div class="lvl offer"><small>${L.type} · ${tc.pay(o.pay)}</small><b>${L.name}</b>
      <small>${tc.cranes(ids.map((id) => CRANES[id].name + (c.fleet.some((f) => f.id === id) ? ' ✓' : '')).join(', '))}</small>
      <a class="btn primary" href="${location.pathname}?contrato=${k}${ids.length ? `&grua=${bestCrane(c, ids)}` : ''}">${tc.accept}</a></div>`;
  }).join('');
  const last = c.last ? `<div class="eyebrow">${tc.result}</div>${settleHtml(c.last)}` : '';
  lui.show(`<div class="eyebrow">${tc.title}</div><h2>${tc.money(eur(c.money))}</h2><p>${tc.day(c.day, c.done, c.failed)}</p>${last}
    <div class="eyebrow">${tc.offers}</div><div class="levels">${offers}</div>
    <div class="eyebrow">${tc.fleet}</div><div class="cranes">${fleet}</div>
    <div class="eyebrow">${tc.shop}</div><div class="cranes">${shop}</div>
    <div class="row"><a class="btn" href="${homeUrl()}">${t.levels.menuBtn}</a><button class="btn" id="c-exp">${tc.export}</button>
      <label class="btn">${tc.import}<input type="file" id="c-imp" accept=".json,application/json" hidden></label>
      <button class="btn" id="c-new">${tc.reset}</button></div>`);
  const card = lui.card;
  card.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => (b.onclick = () => { if (buy(c, b.dataset.b as CraneId)) saveCareer(c); rerender(); }));
  card.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => (b.onclick = () => { if (sell(c, b.dataset.s as CraneId)) saveCareer(c); rerender(); }));
  card.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { if (maintain(c, b.dataset.m as CraneId)) saveCareer(c); rerender(); }));
  card.querySelector<HTMLButtonElement>('#c-exp')!.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportCareer(c)], { type: 'application/json' }));
    a.download = `carrera-dia-${c.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  card.querySelector<HTMLInputElement>('#c-imp')!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const n = importCareer(await f.text());
    if (n) { saveCareer(n); rerender(); } else alert(tc.badFile);
  };
  card.querySelector<HTMLButtonElement>('#c-new')!.onclick = () => {
    if (!confirm(tc.resetAsk)) return;
    saveCareer(newCareer());
    rerender();
  };
  void go;
}

/** La grúa con la que conviene aceptar: una propia si sirve; si no, la más barata de alquilar */
function bestCrane(c: Career, ids: CraneId[]) {
  return ids.find((id) => c.fleet.some((f) => f.id === id)) ?? [...ids].sort((a, b) => rentOf(a) - rentOf(b))[0];
}

/** Cuentas de un contrato como tabla */
export function settleHtml(s: Settle) {
  const row = (k: string, v: number) => `<span>${k}</span><b class="${v < 0 ? 'bad' : ''}">${eur(v)}</b>`;
  return `<div class="stats">${row(tc.payLine, s.pay)}${s.rent ? row(tc.rentLine, -s.rent) : ''}${s.repair ? row(tc.repairLine, -s.repair) : ''}
    ${s.fines.map((f) => row(tc.fine(f.what), -f.eur)).join('')}${row(tc.total, s.total)}</div>`;
}

/** Al terminar un contrato: cobra, pasa el día y devuelve el bloque para el cartel (o '' si no es un contrato) */
export function settleContract(offer: number, crane: CraneId, out: Outcome): string {
  const c = loadCareer(), o = c?.offers[offer];
  if (!c || !o) return '';
  const s = settle(o, crane, c.fleet.some((f) => f.id === crane), out);
  finish(c, s, careerLic());
  saveCareer(c);
  return `<div class="eyebrow">${tc.result}</div>${settleHtml(s)}<div class="row"><a class="btn primary" href="${location.pathname}?carrera=1">${tc.back}</a></div>`;
}
