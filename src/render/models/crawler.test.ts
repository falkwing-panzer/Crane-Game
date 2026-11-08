import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CRANES, type CrawlerSpec } from '../../crane/cranes';
import { initialState } from '../../crane/kinematics';
import { carrierPose } from '../../crane/pose';
import { CrawlerModel } from '../crawlerModel';
import { crawlerLayout, loopLength, loopPoint } from './crawlerLayout';
import { boomLattice } from './lattice';
import type { Box3 } from './layout';

// Modelo de la LR 300 (fase 6): se construye, las tejas recorren un contorno cerrado y la pluma de celosía
// no atraviesa la superestructura en todo su recorrido (25°–84°).

type V2 = [number, number];
function overlap(a: V2[], b: V2[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const nx = y2 - y1, ny = x1 - x2;
    const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}
const rectXY = (b: Pick<Box3, 'x0' | 'x1' | 'y0' | 'y1'>): V2[] => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];

const T = CRANES.crawler as CrawlerSpec;
const L = crawlerLayout(T);
const angs = Array.from({ length: 25 }, (_, i) => T.boom.angMin + ((T.boom.angMax - T.boom.angMin) * i) / 24);
/** Punto del marco de la pluma (d a lo largo, u normal) → plano x-y de la superestructura */
const toSup = (ang: number, [d, u]: V2): V2 => [T.foot + d * Math.cos(ang) - u * Math.sin(ang), T.pivH + d * Math.sin(ang) + u * Math.cos(ang)];

describe('LR 300: modelo', () => {
  it('se construye: mallas sin NaN y pocas draw calls', () => {
    const m = new CrawlerModel(T);
    const S = initialState(T);
    S.trackL = 3.3; S.trackR = -1.2;
    m.update(S, carrierPose(T, S, 'crawler'));
    let meshes = 0;
    m.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes++;
      const p = o.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error('NaN');
      if (o instanceof THREE.InstancedMesh) {
        const a = o.instanceMatrix.array;
        for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(a[i])) throw new Error('NaN en instancias');
      }
    });
    expect(meshes).toBeGreaterThan(15);
    expect(meshes).toBeLessThan(60);
    expect(m.cab.length).toBeGreaterThan(0);
  });

  it('las tejas recorren un contorno cerrado que apoya en el suelo y pasa sobre las ruedas', () => {
    const lp = L.loop, S = loopLength(lp);
    for (let s = 0; s < S; s += 0.05) {
      const p = loopPoint(lp, s), q = loopPoint(lp, s + 0.05);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.051); // continuo
      expect(p.y - lp.shoe[1] / 2).toBeGreaterThan(-0.01); // nunca bajo el suelo
    }
    expect(loopPoint(lp, S + 1).x).toBeCloseTo(loopPoint(lp, 1).x, 9);
    // abajo, la teja toca el suelo; arriba va sobre el bastidor (1,05 m)
    expect(loopPoint(lp, S / 2 + 1).y - lp.shoe[1] / 2).toBeCloseTo(0, 2);
    expect(loopPoint(lp, 1).y - lp.shoe[1] / 2).toBeGreaterThan(1.05 * L.kk);
    // las dos orugas, dentro del rectángulo de apoyo
    for (const t of L.tracks) { expect(t.z1 - t.z0).toBeCloseTo(T.trackW, 9); expect(Math.max(Math.abs(t.z0), Math.abs(t.z1))).toBeCloseTo(T.track.hw, 9); }
  });

  it('la pluma (pie y celosía) no toca la plataforma, el cuerpo, el cabrestante, el contrapeso ni el caballete', () => {
    const lat = boomLattice(L.bw, T.boom.min);
    const d = L.drum, cw = L.cw;
    // piezas que están a la altura lateral de la pluma (|z| < media anchura + cordón)
    const obstacles: V2[][] = [
      rectXY({ x0: cw.x - cw.len / 2 + 0.2, x1: L.slot[0], y0: L.yd + 0.3, y1: L.plateTop }), // plataforma (sin la ranura)
      rectXY({ x0: -L.ringR, x1: L.ringR, y0: L.yd, y1: L.yd + 0.3 }), // corona
      rectXY(L.rearBody),
      rectXY({ x0: d.x - d.r, x1: d.x + d.r, y0: d.y - d.r, y1: d.y + d.r }),
      rectXY({ x0: cw.x - cw.len / 2, x1: cw.x + cw.len / 2, y0: cw.y0, y1: cw.top }),
    ];
    if (L.mast) {
      const [mx, my] = L.mast.top, [fx, fy] = L.mast.feet[0];
      obstacles.push([[fx - 0.18, fy], [fx + 0.18, fy], [mx + 0.18, my], [mx - 0.18, my]]);
    }
    for (const a of angs) {
      const foot = L.foot.map((p) => toSup(a, p));
      // envolvente de la celosía: del final del pie a la cabeza, con su sección (se estrecha)
      const h0 = lat.half(2.4) + lat.chords[0].r, h1 = lat.half(T.boom.min) + lat.chords[0].r;
      const body: V2[] = [[2.4, -h0], [T.boom.min + 0.3, -h1], [T.boom.min + 0.3, h1], [2.4, h0]].map((p) => toSup(a, p as V2));
      for (const o of obstacles) {
        expect(overlap(foot, o), `pie a ${(a * 180 / Math.PI).toFixed(0)}°`).toBe(false);
        expect(overlap(body, o), `celosía a ${(a * 180 / Math.PI).toFixed(0)}°`).toBe(false);
      }
      // el pie cabe en la ranura entre los soportes laterales
      expect(L.footHalf).toBeLessThan(L.bw / 2 + 0.1);
    }
  });

  it('la cabina y el contrapeso pasan por encima de las orugas al girar; la cabina no toca la pluma', () => {
    const trackTop = L.loop.yc + L.loop.R + L.loop.shoe[1] / 2;
    expect(L.opCab.y0).toBeGreaterThan(trackTop);
    expect(L.cw.y0).toBeGreaterThan(trackTop);
    expect(L.yd).toBeGreaterThan(trackTop); // la plataforma gira por encima de las tejas
    expect(-L.opCab.z1).toBeGreaterThan(L.bw / 2 + 0.36); // por fuera de los soportes del pie
  });
});
