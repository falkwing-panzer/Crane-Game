import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CRANES, type WheeledSpec } from '../../crane/cranes';
import { initialState } from '../../crane/kinematics';
import { carrierPose } from '../../crane/pose';
import { CraneModel } from '../craneModel';
import { boomCorners, layout, WHEELED_IDS, type Box3 } from './layout';
import { sheaves } from './superstructure';

// Modelos 3D de las grúas de ruedas (fase 4): se construyen sin errores y las piezas no se atraviesan
// (en todo el recorrido de la pluma y al girar la superestructura sobre el chasis).

type V2 = [number, number];

/** ¿Se solapan dos polígonos convexos? (separación por ejes) */
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

for (const id of WHEELED_IDS) {
  const T = CRANES[id] as WheeledSpec;
  const L = layout(T);
  const angs = Array.from({ length: 25 }, (_, i) => T.boom.angMin + ((T.boom.angMax - T.boom.angMin) * i) / 24);

  describe(`${T.name}`, () => {
    it('se construye: mallas sin NaN y pocas draw calls', () => {
      const m = new CraneModel(T);
      const S = initialState(T);
      m.update(S, carrierPose(T, S, 'tire'));
      let meshes = 0;
      m.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        meshes++;
        const p = o.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error(`NaN en ${id}`);
      });
      expect(meshes).toBeGreaterThan(20);
      expect(meshes).toBeLessThan(75); // una draw call por malla (sin contar sombras)
      expect(m.cab.length).toBeGreaterThan(0);
    });

    it('la pluma no toca la plataforma, el bloque trasero, el contrapeso ni el cabrestante', () => {
      const d = L.drum;
      const obstacles: V2[][] = [
        // placa base (con la ranura bajo el pie, donde solo está la corona)
        rectXY({ x0: L.cw.x - L.cw.len / 2 + 0.2, x1: L.slot[0], y0: T.deckHi, y1: L.plateTop }),
        rectXY({ x0: L.slot[1], x1: L.front, y0: T.deckHi, y1: L.plateTop }),
        rectXY({ x0: L.slot[0], x1: L.slot[1], y0: T.deckHi, y1: T.deckHi + 0.12 }),
        rectXY({ x0: L.cw.x - L.cw.len / 2, x1: L.cw.front, y0: L.cw.y0, y1: L.cw.top }),
        rectXY({ x0: d.x - d.r, x1: d.x + d.r, y0: d.y - d.r, y1: d.y + d.r }),
      ];
      if (L.rearBlock) obstacles.push(rectXY(L.rearBlock));
      for (const a of angs) {
        const boom = boomCorners(T, L, a);
        obstacles.forEach((o) => expect(overlap(boom, o), `ángulo ${(a * 180 / Math.PI).toFixed(0)}°`).toBe(false));
      }
    });

    it('lo que gira queda a los lados de la pluma', () => {
      const side = T.boom.w / 2 + 0.36; // soportes del pie de pluma
      expect(L.opCab.z1).toBeLessThan(-side);
      if (L.housing) expect(L.housing.z0).toBeGreaterThan(side);
    });

    it('la pluma tumbada pasa por encima de la cabina, el apoyo y el equipo de la cubierta', () => {
      const bottom = L.boomBottom0;
      if (!L.noCab) expect(L.cab.y1 + 0.06).toBeLessThan(bottom); // techo
      expect(L.restH).toBeLessThan(bottom);
      expect(L.deck.top).toBeLessThan(bottom);
      // tramos interiores, cabeza y poleas, con la pluma recogida
      const sv = sheaves(T, L);
      expect(sv.y - sv.r).toBeGreaterThanOrEqual(-L.hu / 2 - 0.031);
    });

    it('al girar, la superestructura no barre la cabina, el apoyo ni el equipo de la cubierta', () => {
      const r = L.tailR, low = T.deckHi + 0.12; // parte inferior de la superestructura
      if (!L.noCab && L.cab.y1 > low) expect(L.cab.x0 - T.piv).toBeGreaterThan(r);
      expect(L.restX - 0.2 - T.piv).toBeGreaterThan(r);
      expect(L.deck.x0 - T.piv).toBeGreaterThan(r);
    });

    it('llantas, bastidor y cajones de estabilizadores no se tocan', () => {
      expect(L.tireZ + L.tireHalf).toBeLessThanOrEqual(L.hf);
      expect(L.frameHalf).toBeLessThan(L.tireZ - L.tireHalf);
      expect(2 * T.wheelR).toBeLessThan(T.deckHi - 0.3); // la llanta cabe bajo la cubierta
      for (const [x0, x1] of L.outBox) {
        expect(x1 - x0).toBeGreaterThan(0.4);
        for (const a of T.axles) {
          const r = T.wheelR + 0.15; // guardabarros
          expect(x1 <= a - r || x0 >= a + r, `cajón ${x0.toFixed(2)}…${x1.toFixed(2)} y eje ${a}`).toBe(true);
        }
      }
      if (!L.noCab) expect(L.cab.x0).toBeGreaterThanOrEqual(Math.max(...T.axles) + T.wheelR + 0.12 - 1e-9);
    });
  });
}
