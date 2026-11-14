import * as THREE from 'three';
import { isCrawler, type CraneSpec, type WheeledSpec } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';
import { apply, type Pose } from '../crane/pose';
import { layout } from './models/layout';
import { Particles, Rain } from './particles';

/**
 * Efectos (fase 16, solo dibujo; apagados en calidad baja): polvo de las ruedas o las orugas al conducir, polvo de
 * las zapatas al apoyarlas, humo del escape al acelerar o al trabajar la grúa y lluvia (prueba libre). Cada sistema
 * es una draw call, compartida por todas las grúas de la partida.
 */
export interface EffectUnit {
  T: CraneSpec;
  S: CraneState;
  pose: Pose;
  /** mandos de la grúa en uso, 0…1 (motor acelerado) */
  work: number;
}

/** Velocidad desde la que las ruedas levantan polvo (m/s) */
export const DUST_SPEED = 0.8;

interface Track { vd: number; out: number; acc: number; dust: number; smoke: number }

const rnd = (a: number) => (Math.random() * 2 - 1) * a;

export class Effects {
  readonly dust = new Particles(700, { color: '#b9ab8c', alpha: 0.45, grow: 3.2, lift: 0.15, drag: 1.6 });
  readonly smoke = new Particles(300, { color: '#4a4846', alpha: 0.4, grow: 4, lift: 1.1, drag: 0.9 });
  private rain: Rain | null = null;
  private state = new Map<CraneSpec, Track>();
  /** Escape de cada grúa de ruedas (marco del chasis) */
  private pipes = new Map<CraneSpec, { x: number; y: number; z: number }>();
  private time = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.dust.points, this.smoke.points);
  }

  /** Lluvia encendida o apagada */
  setRain(on: boolean) {
    if (on && !this.rain) { this.rain = new Rain(); this.scene.add(this.rain.lines); }
    if (!on && this.rain) {
      this.scene.remove(this.rain.lines);
      this.rain.lines.geometry.dispose();
      (this.rain.lines.material as THREE.Material).dispose();
      this.rain = null;
    }
  }

  get raining() { return !!this.rain; }

  private pipe(T: WheeledSpec) {
    let p = this.pipes.get(T);
    if (!p) {
      // el escape de carrier.ts: horizontal bajo la cubierta, saliendo por detrás a la izquierda
      const L = layout(T);
      p = { x: T.len[0] - 0.1, y: T.deckLo + 0.05, z: -L.hf + 0.35 };
      this.pipes.set(T, p);
    }
    return p;
  }

  update(dt: number, units: EffectUnit[], camera: THREE.PerspectiveCamera, viewH: number) {
    this.time += dt;
    if (dt > 0) for (const u of units) this.emit(dt, u);
    this.dust.setView(viewH, camera.fov);
    this.smoke.setView(viewH, camera.fov);
    this.dust.update(dt);
    this.smoke.update(dt);
    this.rain?.update(this.time, camera);
  }

  private emit(dt: number, { T, S, pose, work }: EffectUnit) {
    let st = this.state.get(T);
    if (!st) this.state.set(T, (st = { vd: S.vd, out: S.out, acc: 0, dust: 0, smoke: 0 }));
    const acc = (Math.abs(S.vd) - Math.abs(st.vd)) / dt;
    st.acc += (acc - st.acc) * (1 - Math.exp(-6 * dt));
    const speed = Math.abs(S.vd), fwd = Math.sign(S.vd) || 1;
    // avance en el mundo (rumbo h: (cos h, 0, −sin h))
    const hx = Math.cos(S.h), hz = -Math.sin(S.h);

    // polvo de las ruedas o las orugas (en el suelo, detrás de cada rueda o de la punta trasera de cada oruga)
    if (speed > DUST_SPEED) {
      st.dust += dt * Math.min(40, 14 * speed);
      const pts: [number, number][] = [];
      if (isCrawler(T)) {
        const tr = T.track!, x = fwd > 0 ? tr.xr : tr.xf;
        for (const s of [-1, 1]) pts.push([x, s * tr.hw]);
      } else for (const ax of (T as WheeledSpec).axles) for (const s of [-1, 1]) pts.push([ax, s * (T.tire?.hw ?? T.half) * 1.1]);
      while (st.dust >= 1) {
        st.dust -= 1;
        const [x, z] = pts[Math.floor(Math.random() * pts.length)];
        const w = apply(pose, { x, y: 0, z });
        const v = 0.4 * speed;
        this.dust.emit(w.x + rnd(0.3), 0.15, w.z + rnd(0.3), -hx * fwd * v + rnd(0.5), 0.4 + Math.random() * 0.5, -hz * fwd * v + rnd(0.5),
          1.4 + Math.random() * 1.2, 0.9 + Math.random() * 0.6);
      }
    }

    // polvo de las zapatas: al llegar al suelo (S.out pasa por 0,5 al desplegar; carrierLift en kinematics)
    if (T.out && st.out < 0.5 && S.out >= 0.5) {
      const o = T.out;
      for (const x of [o.xf, o.xr]) for (const s of [-1, 1]) {
        const w = apply(pose, { x, y: 0, z: s * o.hw * 0.92 });
        for (let k = 0; k < 14; k++) {
          const a = Math.random() * Math.PI * 2, v = 0.8 + Math.random() * 1.2;
          this.dust.emit(w.x, 0.1, w.z, Math.cos(a) * v, 0.15 + Math.random() * 0.3, Math.sin(a) * v, 1.8 + Math.random() * 1.2, 0.8 + Math.random() * 0.6);
        }
      }
    }

    // humo del escape (grúas de ruedas): al acelerar y, menos, con la grúa trabajando
    if (!isCrawler(T)) {
      const rate = Math.min(45, Math.max(0, st.acc) * 30) + 6 * Math.min(1, work);
      st.smoke += dt * rate;
      if (st.smoke >= 1) {
        const p = this.pipe(T as WheeledSpec);
        const w = apply(pose, p);
        while (st.smoke >= 1) {
          st.smoke -= 1;
          this.smoke.emit(w.x + rnd(0.05), w.y, w.z + rnd(0.05), -hx * 1.2 + rnd(0.3), 0.3 + Math.random() * 0.3, -hz * 1.2 + rnd(0.3),
            1.6 + Math.random() * 1.2, 0.35 + Math.random() * 0.2);
        }
      }
    }
    st.vd = S.vd;
    st.out = S.out;
  }

  dispose() {
    this.setRain(false);
  }
}
