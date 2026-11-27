import type * as THREE from 'three';
import { inZone } from '../levels/setup';
import { workerMargin } from '../levels/people';
import { sessionSignal, type Signal } from '../game/signals';
import type { Session } from '../game/session';
import { RiggerView, WorkersView } from '../render/people';
import { ChecklistPanel, RadioPanel } from './safetyUi';

/**
 * Fase 23 en la partida: trabajadores, señalero (dibujo, señal y radio) y lista de chequeo, para los niveles que los
 * tienen. Solo interfaz: lee la sesión y no toca la simulación (la lista confirmada entra como acción del paso).
 */
export class SafetyView {
  private workers: WorkersView | null = null;
  private rigger: RiggerView | null = null;
  readonly radio: RadioPanel | null = null;
  readonly checklist: ChecklistPanel | null = null;
  /** Última señal (pruebas) */
  signal: Signal | null = null;

  constructor(scene: THREE.Scene, root: HTMLElement, private ses: Session) {
    const L = ses.L;
    if (!L) return;
    if (L.workers?.length) this.workers = new WorkersView(scene, L.workers);
    if (L.rigger) {
      this.rigger = new RiggerView(scene, L.rigger);
      this.radio = new RadioPanel(root);
    }
    if (L.checklist) this.checklist = new ChecklistPanel(root);
  }

  /** Cada cuadro (con el último paso de la simulación) */
  update(voice: boolean) {
    const { ses } = this, L = ses.L!, run = ses.run, u = ses.act, { phys, T, S } = u;
    if (!L) return;
    this.workers?.update(run.t, run.inExcl);
    const a = phys.attached;
    // carga que habría que enganchar: la más cercana que no esté colocada
    const loads = phys.loads.filter((l) => { const p = phys.placed(l); return !p || !L.zones.some((z) => inZone(p, z)); });
    const hk = phys.hookBody.translation();
    const next = a ?? [...loads].sort((p, q) => {
      const P = p.body.translation(), Q = q.body.translation();
      return Math.hypot(P.x - hk.x, P.z - hk.z) - Math.hypot(Q.x - hk.x, Q.z - hk.z);
    })[0] ?? null;
    if (this.checklist) {
      this.checklist.update({
        level: !!T.crawler || S.out >= 1, wind: run.wind, done: !!run.checked,
        clear: !next || workerMargin(posOf(next), L.workers ?? [], run.t) > 3,
        load: next ? { label: next.label, m: next.mass } : null,
      });
    }
    if (!this.rigger || !this.radio) return;
    const sig = sessionSignal(ses);
    if (!sig) { this.radio.update(null); this.rigger.update('para', S.x, S.z, run.t); return; }
    this.signal = sig;
    this.radio.voice = voice;
    this.radio.update(sig);
    this.rigger.update(sig, hk.x, hk.z, performance.now() / 1000);
  }

  dispose() {
    this.workers?.dispose();
    this.rigger?.dispose();
    this.radio?.dispose();
    this.checklist?.dispose();
  }
}

function posOf(l: { body: { translation(): { x: number; z: number } }; half: { x: number; z: number } }) {
  const p = l.body.translation();
  return { x: p.x, z: p.z, r: Math.hypot(l.half.x, l.half.z) };
}

