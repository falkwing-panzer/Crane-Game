import { bodyHalf, type CraneSpec } from '../crane/cranes';
import { KIND_COL, type Level } from '../levels/levels';
import { levelBoxes, levelSize } from '../levels/setup';
import { PLAN_MARGIN, crateNeedH, liftPlan, planConfigs, toWorld, usefulContour, type CratePlan, type Ghost, type Grade, type Plan } from '../levels/liftPlan';
import { capText } from './chartPanel';
import { t } from '../i18n';

// Plan de izaje (fase 20): planta de la obra en la ficha del nivel con una grúa "fantasma" que se arrastra y se gira.
// Cada carga se pinta según su peor punto (recogida o destino): verde con margen, ámbar justo, rojo no se puede. El
// contorno es el radio útil de la carga elegida alrededor del eje de giro. Solo interfaz: no toca la partida.

const tp = t.plan;
const D = Math.PI / 180;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');
export const GRADE_COL: Record<Grade, string> = { ok: '#4cc38a', tight: '#f5c542', no: '#ff6b5a' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class PlanView {
  private cv: HTMLCanvasElement;
  private g2: CanvasRenderingContext2D;
  private table: HTMLElement;
  private site: HTMLElement;
  private plan!: Plan;
  private sel = 0;
  private rings = new Map<number, { ok: { slew: number; R: number }[]; max: { slew: number; R: number }[] }>();
  private configs;
  private scale = 1;
  private raf = 0;

  /** host = contenedor dentro de la ficha; g = pose del fantasma (se cambia en su sitio: la ficha la recuerda) */
  constructor(host: HTMLElement, private T: CraneSpec, private L: Level, private g: Ghost, private start: Ghost) {
    host.innerHTML = `<p class="plan-intro">${tp.intro}</p>
      <div class="plan-tools"><button type="button" class="btn small" data-r="-15">↺ ${tp.rotate}</button>
      <button type="button" class="btn small" data-r="15">${tp.rotate} ↻</button><button type="button" class="btn small" data-reset>${tp.reset}</button>
      <span class="plan-site"></span></div>
      <canvas class="plan-cv"></canvas><div class="plan-table"></div>
      <small class="plan-legend">${tp.legend(Math.round(PLAN_MARGIN * 100))} ${tp.note}</small>`;
    this.cv = host.querySelector('canvas')!;
    this.g2 = this.cv.getContext('2d')!;
    this.table = host.querySelector('.plan-table')!;
    this.site = host.querySelector('.plan-site')!;
    this.configs = planConfigs(T, L);
    host.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => b.addEventListener('click', () => { this.rotate(Number(b.dataset.r) * D); b.blur(); }));
    host.querySelector<HTMLButtonElement>('[data-reset]')!.addEventListener('click', (e) => {
      Object.assign(this.g, this.start);
      this.changed();
      (e.currentTarget as HTMLElement).blur();
    });
    this.table.addEventListener('click', (e) => {
      const r = (e.target as Element).closest<HTMLElement>('[data-k]');
      if (r) { this.sel = Number(r.dataset.k); this.render(); }
    });
    this.bindPointer();
    this.resize();
    this.changed();
  }

  /** Tamaño del lienzo según el ancho de la ficha (y la nitidez de la pantalla) */
  private resize() {
    const [W, Dp] = levelSize(this.L);
    const w = Math.max(320, Math.min(this.cv.parentElement!.clientWidth || 800, 812));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scale = w / W;
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${Math.round(Dp * this.scale)}px`;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(Dp * this.scale * dpr);
    this.g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rotate(a: number) { this.g.h += a; this.changed(); }

  /** Arrastrar mueve el fantasma; un clic sin moverse elige la carga más cercana; la rueda gira */
  private bindPointer() {
    const cv = this.cv;
    let drag: { x: number; y: number; gx: number; gz: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) / this.scale, z: (e.clientY - r.top) / this.scale };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      drag = { x: p.x, y: p.z, gx: this.g.x, gz: this.g.z, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pos(e);
      if (!drag.moved && Math.hypot(p.x - drag.x, p.z - drag.y) * this.scale < 4) return;
      drag.moved = true;
      this.g.x = drag.gx + p.x - drag.x;
      this.g.z = drag.gz + p.z - drag.y;
      this.later();
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const p = pos(e);
        let best = -1, bd = Infinity;
        this.L.crates.forEach((c, k) => {
          const d = Math.max(Math.abs(p.x - c.x) - c.w / 2, Math.abs(p.z - c.z) - c.d / 2);
          if (d < bd) { bd = d; best = k; }
        });
        if (best >= 0 && bd < 3) { this.sel = best; this.render(); }
      }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.rotate(Math.sign(e.deltaY) * 5 * D); }, { passive: false });
  }

  /** Recalcula en el próximo cuadro (al arrastrar llegan muchos eventos por cuadro) */
  private later() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.changed(); });
  }

  private changed() {
    this.plan = liftPlan(this.T, this.L, this.g, this.configs);
    this.render();
  }

  /** Contorno del radio útil de una carga (con margen y al 100 %), en el marco del chasis: no depende del fantasma */
  private ring(k: number) {
    let r = this.rings.get(k);
    if (!r) {
      const need = this.L.crates[k].m + this.T.hookM;
      const h = crateNeedH(this.L, k);
      r = { ok: usefulContour(this.T, this.configs, need, PLAN_MARGIN, 36, h), max: usefulContour(this.T, this.configs, need, 1, 36, h) };
      this.rings.set(k, r);
    }
    return r;
  }

  private render() {
    this.draw();
    const { plan, T } = this;
    this.site.innerHTML = `${tp.site}: <b style="color:${plan.site ? GRADE_COL.no : GRADE_COL.ok}">${plan.site ?? (T.out ? tp.siteOk : tp.siteOkCrawler)}</b>`;
    const cell = (p: CratePlan['pick'] | null) => p
      ? `<td style="color:${GRADE_COL[p.grade]}">${tp.cell(f1(p.R), p.lift ? capText(p.lift.cap) : null)}</td>` : '<td>—</td>';
    const [c0, c1, c2, c3] = tp.cols;
    this.table.innerHTML = `<table><thead><tr><th></th><th>${c0}</th><th>${c1}</th><th>${c2}</th><th>${c3}</th></tr></thead><tbody>` +
      plan.crates.map((c, k) => `<tr data-k="${k}" class="${k === this.sel ? 'on' : ''}"><td><i class="dot" style="background:${GRADE_COL[c.grade]}"></i></td>` +
        `<td>${esc(c.crate.label)} <small>${tp[c.grade]}</small></td><td>${f1(c.need)}</td>${cell(c.pick)}${cell(c.place)}</tr>`).join('') +
      '</tbody></table>';
  }

  private draw() {
    const { g2: c, scale: s, L, T, g, plan } = this;
    const [W, Dp] = levelSize(L);
    c.clearRect(0, 0, W * s, Dp * s);
    c.fillStyle = '#2b2f33';
    c.fillRect(0, 0, W * s, Dp * s);
    // cuadrícula de 10 m
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 10; x < W; x += 10) { c.moveTo(x * s, 0); c.lineTo(x * s, Dp * s); }
    for (let z = 10; z < Dp; z += 10) { c.moveTo(0, z * s); c.lineTo(W * s, z * s); }
    c.stroke();
    // terreno blando
    for (const z of L.soft ?? []) {
      c.fillStyle = z.kind === 'water' ? 'rgba(60,120,170,0.55)' : 'rgba(110,85,55,0.6)';
      c.fillRect((z.x - z.w / 2) * s, (z.z - z.d / 2) * s, z.w * s, z.d * s);
    }
    // edificios y cajas, con su altura
    c.font = `${Math.max(9, Math.round(s * 1.1))}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const b of levelBoxes(L)) {
      c.fillStyle = b.color ?? KIND_COL[b.kind];
      c.fillRect((b.x - b.w / 2) * s, (b.z - b.d / 2) * s, b.w * s, b.d * s);
      if (b.w * s > 26 && b.d * s > 12) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText(`${f1(b.h)} m`, b.x * s, b.z * s); }
    }
    // líneas eléctricas con su franja de seguridad
    for (const l of L.lines ?? []) {
      c.strokeStyle = 'rgba(255,107,90,0.25)';
      c.lineWidth = l.clear * 2 * s;
      c.beginPath(); c.moveTo(l.a[0] * s, l.a[1] * s); c.lineTo(l.b[0] * s, l.b[1] * s); c.stroke();
      c.strokeStyle = '#ff6b5a';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(l.a[0] * s, l.a[1] * s); c.lineTo(l.b[0] * s, l.b[1] * s); c.stroke();
    }
    // zonas de destino
    c.setLineDash([5, 4]);
    for (const z of L.zones) {
      c.strokeStyle = '#f0bb27';
      c.lineWidth = 1.5;
      c.strokeRect((z.x - z.w / 2) * s, (z.z - z.d / 2) * s, z.w * s, z.d * s);
    }
    c.setLineDash([]);
    for (const z of L.zones) { c.fillStyle = '#f0bb27'; c.fillText(z.label, z.x * s, (z.z - z.d / 2) * s - 7); }
    // radio útil de la carga elegida
    const [px, pz] = toWorld(g, T.piv, 0);
    const ring = this.ring(this.sel);
    const poly = (pts: { slew: number; R: number }[], fill: string, line: string) => {
      c.beginPath();
      pts.forEach((p, i) => {
        const lx = T.piv + p.R * Math.cos(p.slew), lz = -p.R * Math.sin(p.slew);
        const [x, z] = toWorld(g, lx, lz);
        if (i) c.lineTo(x * s, z * s); else c.moveTo(x * s, z * s);
      });
      c.closePath();
      c.fillStyle = fill; c.fill();
      c.strokeStyle = line; c.lineWidth = 1.5; c.stroke();
    };
    poly(ring.max, 'rgba(245,197,66,0.06)', 'rgba(245,197,66,0.7)');
    poly(ring.ok, 'rgba(76,195,138,0.1)', 'rgba(76,195,138,0.9)');
    // líneas del eje de giro a la recogida y al destino de cada carga
    plan.crates.forEach((cp, k) => {
      for (const p of [cp.pick, cp.place]) {
        if (!p) continue;
        c.strokeStyle = GRADE_COL[p.grade];
        c.globalAlpha = k === this.sel ? 0.95 : 0.35;
        c.lineWidth = k === this.sel ? 2 : 1;
        c.beginPath(); c.moveTo(px * s, pz * s); c.lineTo(p.x * s, p.z * s); c.stroke();
      }
    });
    c.globalAlpha = 1;
    // cargas
    L.crates.forEach((cr, k) => {
      const cp = plan.crates[k];
      c.fillStyle = cr.color;
      c.fillRect((cr.x - cr.w / 2) * s, (cr.z - cr.d / 2) * s, cr.w * s, cr.d * s);
      c.strokeStyle = GRADE_COL[cp.grade];
      c.lineWidth = k === this.sel ? 3 : 2;
      c.strokeRect((cr.x - cr.w / 2) * s - 1, (cr.z - cr.d / 2) * s - 1, cr.w * s + 2, cr.d * s + 2);
      c.fillStyle = '#fff';
      c.fillText(`${cr.label} · ${f1(cr.m)} t`, cr.x * s, (cr.z + cr.d / 2) * s + 8);
    });
    // el fantasma: chasis (u orugas), zapatas y eje de giro
    const bad = !!plan.site;
    const rect = (x0: number, x1: number, z0: number, z1: number) => {
      c.beginPath();
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([lx, lz], i) => {
        const [x, z] = toWorld(g, lx, lz);
        if (i) c.lineTo(x * s, z * s); else c.moveTo(x * s, z * s);
      });
      c.closePath();
    };
    c.fillStyle = bad ? 'rgba(255,107,90,0.45)' : 'rgba(240,187,39,0.45)';
    c.strokeStyle = bad ? '#ff6b5a' : '#f0bb27';
    c.lineWidth = 2;
    const r = T.crawler ? T.track! : { xf: T.len[1], xr: T.len[0], hw: bodyHalf(T) };
    rect(r.xr, r.xf, -r.hw, r.hw); c.fill(); c.stroke();
    if (T.out) {
      c.lineWidth = 1.5;
      for (const lx of [T.out.xf, T.out.xr]) {
        rect(lx - 0.15, lx + 0.15, -T.out.hw, T.out.hw); c.stroke();
        for (const lz of [-T.out.hw, T.out.hw]) { rect(lx - 0.6, lx + 0.6, lz - 0.6, lz + 0.6); c.fill(); c.stroke(); }
      }
    }
    // frente: una flecha
    const [fx, fz] = toWorld(g, r.xf + 1.5, 0), [bx, bz] = toWorld(g, r.xf - 0.5, 0);
    c.beginPath(); c.moveTo(bx * s, bz * s); c.lineTo(fx * s, fz * s); c.stroke();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(px * s, pz * s, 3, 0, Math.PI * 2); c.fill();
  }

  dispose() { if (this.raf) cancelAnimationFrame(this.raf); }
}
