import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT, HOOK_HALF_H } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, sessionDef, type Unit } from '../game/session';
import { GameStep } from '../game/step';
import type { Cmd, StepInput } from '../game/record';
import { allModels } from '../render/models/allModels';
import { LESSONS, RING_R } from './lessons';
import { t } from '../i18n';
import { StatsTracker } from '../game/stats';
import { smoothScore } from '../game/smooth';
import { ACTIONS, withKeys } from '../ui/keys';
import type { CraneInput } from '../crane/kinematics';

// Escuela (fase 19): cada lección se puede terminar entera. Un "alumno" de guion juega cada lección en la simulación
// de verdad (Rapier, LMI, viento) mirando el estado como lo vería el jugador, sin tocar nada por dentro.

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

const D2R = Math.PI / 180;
const clamp = (v: number, a = 1) => Math.max(-a, Math.min(a, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Mando proporcional hacia el objetivo, quieto dentro de la tolerancia */
const toward = (err: number, k: number, tol: number) => (Math.abs(err) < tol ? 0 : clamp(err * k));

type Policy = (u: Unit, ses: Session, step: number) => { crane?: Partial<CraneInput>; throttle?: number; steer?: number; cmds?: Cmd[] };

/** Juega una lección con la política dada; devuelve los segundos que tardó (o lanza si no termina) */
function play(n: number, policy: Policy, maxS = 240) {
  const ses = new Session(sessionDef(`?escuela=${n}`), new THREE.Scene(), allModels);
  const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
  const msgs: string[] = [];
  ses.bus.on('say', (e) => msgs.push(e.text));
  let done = false;
  ses.bus.on('lessonDone', () => { done = true; });
  ses.running = true;
  // estadísticas (fase 22): el contador del juego no cuenta con un guion; este sí, para probarlo con un izaje de verdad
  const stats = new StatsTracker(ses, () => true);
  const steps: number[] = [];
  game.source = {
    next(): StepInput {
      const p = policy(ses.act, ses, ses.sch!.step);
      return { crane: { ...IDLE, ...p.crane }, drive: { ...IDLE_DRIVE, throttle: p.throttle ?? 0, steer: p.steer ?? 0 }, cmds: p.cmds ?? [] };
    },
  };
  let i = 0;
  for (; i < maxS / FIXED_DT && !done; i++) {
    const s0 = ses.sch!.step;
    game.tick(FIXED_DT);
    stats.step(FIXED_DT);
    if (ses.sch!.step !== s0) steps.push(+(i * FIXED_DT).toFixed(1));
    if (ses.tipped()) throw new Error(`lección ${n}: la grúa volcó en el paso ${ses.sch!.step}`);
  }
  if (!done) throw new Error(`lección ${n}: no terminó; paso ${ses.sch!.step}, mensajes: ${msgs.slice(-6).join(' | ')}`);
  return { s: i * FIXED_DT, steps, ses, msgs, stats, game };
}

/** Conducir hasta (x, z) y parar allí */
function driveTo(u: Unit, x: number, z: number) {
  const { S } = u, dx = x - S.x, dz = z - S.z, d = Math.hypot(dx, dz);
  const err = wrap(Math.atan2(-dz, dx) - S.h);
  const vWant = d < 0.6 ? 0 : Math.min(3, 0.5 * d);
  return { throttle: clamp((vWant - S.vd) * 1.5), steer: d < 2 ? 0 : clamp(err * 3) };
}

/** Pluma hacia giro, ángulo y largo dados (grados, m) */
function boomTo(u: Unit, slew: number, ang: number, Lb: number, fine = false): Partial<CraneInput> {
  const { S } = u;
  return {
    slew: toward(wrap(slew * D2R - S.slew), 3, 0.004),
    luff: toward(ang * D2R - S.ang, 3, 0.004),
    tele: toward(Lb - S.Lb, 1, 0.02),
    fine,
  };
}

const hook = (u: Unit) => u.phys.hookBody.translation();
const hookV = (u: Unit) => { const v = u.phys.hookBody.linvel(); return Math.hypot(v.x, v.z); };
const loadOf = (u: Unit, label: string) => u.phys.loads.find((l) => l.label === label)!;
const bottomOf = (u: Unit, label: string) => u.phys.footprint(loadOf(u, label)).bottom;

/** Bajar el gancho hasta la carga y engancharla (Espacio cuando está a tiro y quieto) */
function hookOn(u: Unit, label: string, every: { n: number }) {
  const L = loadOf(u, label), top = L.body.translation().y + L.half.y;
  const gap = hook(u).y - HOOK_HALF_H - top;
  every.n++;
  if (gap > 0.4) return { crane: { hoist: clamp(gap) } };
  return { cmds: hookV(u) < 0.3 && every.n % 20 === 0 ? (['hook'] as Cmd[]) : [] };
}

/** Bajar la carga despacio hasta apoyarla (con el gancho quieto) */
function lower(u: Unit, label: string, fine: boolean) {
  const b = bottomOf(u, label);
  if (hookV(u) > 0.15) return { crane: { fine } };
  // cerca del suelo, mando parcial (como dar toques cortos)
  return { crane: { hoist: b > 1.2 ? 1 : 0.35, fine } };
}

describe('escuela de operadores (fase 19)', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('textos: una entrada por lección y por paso, con teclas que existen', () => {
    expect(t.school.lessons.length).toBe(LESSONS.length);
    LESSONS.forEach((L, i) => {
      const tx = t.school.lessons[i];
      expect(tx.steps.length).toBe(L.steps.length);
      for (const s of [tx.intro, ...tx.steps]) {
        for (const m of s.matchAll(/\{(\w+)\}/g)) expect(ACTIONS).toContain(m[1]);
        expect(withKeys(s)).not.toMatch(/\{\w+\}/);
      }
      for (const st of L.steps) for (const k of st.keys) expect(ACTIONS).toContain(k);
    });
    // los textos siguen a las teclas cambiadas por el jugador
    const k = { ...Object.fromEntries(ACTIONS.map((a) => [a, ''])), view: 'KeyC' } as never;
    expect(withKeys(t.school.lessons[0].steps[0], k)).toMatch(/^Pulsa C /);
  });

  it('la obra: cargas debajo de la cabeza, aros al alcance y zonas fuera de los estabilizadores', () => {
    for (const L of LESSONS) {
      const ses = new Session(sessionDef(`?escuela=${L.n}`), new THREE.Scene(), allModels);
      expect(ses.L).toBeNull();
      expect(ses.site).toBe(L.site);
      expect(ses.act.id).toBe('medium');
      expect(ses.running).toBe(false);
      const u = ses.act, h = u.phys.headWorld();
      for (const c of L.site.crates) expect(Math.hypot(c.x - h.x, c.z - h.z)).toBeLessThan(0.05);
      // la carga no toca la grúa ni las zapatas
      expect(u.phys.loads.every(() => u.phys.padsBlocked(u.S) === null && !u.phys.carrierBlocked(u.S.x, u.S.z, u.S.h))).toBe(true);
      for (const r of L.rings) expect(r.r).toBe(RING_R);
    }
  }, 60_000);

  it('lección 1: cámara y conducción', () => {
    const r = play(1, (u, ses, st) => {
      if (st === 0) { ses.sch!.views++; return {}; }
      return st === 1 ? driveTo(u, 34, 28) : driveTo(u, 64, 15);
    });
    expect(r.steps.length).toBe(3);
  }, 60_000);

  it('lección 2: estabilizadores', () => {
    const r = play(2, (u, _, st) => {
      const { S } = u, want = st === 1 ? 0 : 1;
      return { cmds: S.outT !== want && (S.out === 0 || S.out === 1) ? ['outriggers'] : [] };
    });
    expect(r.steps.length).toBe(3);
  }, 60_000);

  it('lección 3: la cabeza pasa por los cuatro aros', () => {
    const T = [[0, 55, 11], [90, 55, 11], [90, 55, 20], [180, 40, 15]];
    const r = play(3, (u, _, st) => ({ crane: boomTo(u, T[st][0], T[st][1], T[st][2]) }));
    expect(r.steps.length).toBe(4);
  }, 60_000);

  it('lección 4: enganchar, izar, llevar a la zona y soltar', () => {
    const c = { n: 0 };
    const r = play(4, (u, _, st) => {
      if (st === 0) return hookOn(u, 'PALÉ', c);
      if (st === 1) return { crane: { hoist: -1 } };
      if (st === 2) {
        const b = boomTo(u, 180, 40, 13);
        if (b.slew || hookV(u) > 0.15) return { crane: b };
        return lower(u, 'PALÉ', false);
      }
      return { cmds: ++c.n % 20 === 0 ? ['hook'] : [] };
    });
    expect(r.steps.length).toBe(4);
    // fase 22: un izaje del palé de 2 t, sin golpes, y su nota de suavidad
    expect(r.stats.st).toMatchObject({ lifts: 1, tons: 2, clean: 1, bumps: 0 });
    expect(r.game.stats.st.lifts).toBe(0); // el del juego, con el guion, no cuenta
    const sm = smoothScore(r.ses.run)!;
    expect(sm.score).toBeGreaterThan(50);
    expect(sm.swing).toBeGreaterThan(0.2);
  }, 60_000);

  it('lección 5: el LMI avisa al 90 % y corta al 100 %; después se deja más cerca', () => {
    const c = { n: 0 };
    let maxLmi = 0;
    const r = play(5, (u, _, st) => {
      maxLmi = Math.max(maxLmi, u.dyn.lmi);
      if (st === 0) return u.phys.attached ? { crane: { hoist: -1 } } : hookOn(u, 'BLOQUE', c);
      if (st === 1 || st === 2) return { crane: { tele: 1 } };
      if (st === 3) {
        const b = boomTo(u, 180, 60, 18);
        if (b.slew || b.luff || hookV(u) > 0.15) return { crane: b };
        return lower(u, 'BLOQUE', false);
      }
      return { cmds: ++c.n % 20 === 0 ? ['hook'] : [] };
    });
    expect(r.steps.length).toBe(5);
    expect(maxLmi).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('lección 6: con viento, la caja de vidrio se apoya a menos de 0,5 m/s', () => {
    const c = { n: 0 };
    const r = play(6, (u, _, st) => {
      if (st === 0) return u.phys.attached ? { crane: { hoist: -1 } } : hookOn(u, 'VIDRIO', c);
      if (st === 1) return { crane: boomTo(u, 180, 55, 14, true) };
      if (st === 2) {
        const b = boomTo(u, 180, 55, 14, true);
        if (b.slew || hookV(u) > 0.1) return { crane: b };
        return lower(u, 'VIDRIO', true);
      }
      return { cmds: ++c.n % 20 === 0 ? ['hook'] : [] };
    }, 300);
    expect(r.steps.length).toBe(4);
    expect(r.msgs.some((m) => m.startsWith('Demasiado'))).toBe(false);
  }, 60_000);

  it('el progreso va en las instantáneas: rebobinar devuelve el paso anterior', () => {
    const ses = new Session(sessionDef('?escuela=2'), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    ses.running = true;
    for (let i = 0; i < 60; i++) game.tick(FIXED_DT);
    const snap = game.snapshot();
    game.push('outriggers');
    for (let i = 0; i < 600 && ses.sch!.step === 0; i++) game.tick(FIXED_DT);
    expect(ses.sch!.step).toBe(1);
    game.restore(snap);
    expect(ses.sch!.step).toBe(0);
    expect(ses.act.S.outT).toBe(0);
  }, 60_000);

  it('en la escuela no se puede puentear el LMI', () => {
    const ses = new Session(sessionDef('?escuela=5'), new THREE.Scene(), allModels);
    const game = new GameStep(ses, { state: () => IDLE, drive: () => IDLE_DRIVE });
    ses.running = true;
    game.push('bypass');
    game.tick(FIXED_DT);
    expect(ses.bypass).toBe(false);
  });
});
