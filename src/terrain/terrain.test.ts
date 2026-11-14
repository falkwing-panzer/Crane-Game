import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FIXED_DT } from '../physics/world';
import { IDLE, IDLE_DRIVE } from '../game/control';
import { Session, groundState, sessionDef } from '../game/session';
import { GameStep } from '../game/step';
import { allModels } from '../render/models/allModels';
import { terrainMeshes } from '../render/terrainView';
import { decorFor } from '../decor/layout';
import { ALL_LEVELS } from '../levels/tandemSetup';
import { CRANES } from '../crane/cranes';
import { toggleOutriggers } from '../crane/ops';
import { baseConfig } from '../crane/stability';
import { groundFit, maxSlope } from '../crane/ground';
import { carrierPose } from '../crane/pose';
import { supportMode } from '../crane/ops';
import { TEST_MESA, decorReach, terrainFor } from './build';
import { Terrain, hillHeight, makePatch, mesaHeight, mesaSlopes, patchHeight } from './terrain';
import type { DriveInput } from '../crane/drive';
import { t } from '../i18n';

// Las etiquetas de las cargas se pintan en un <canvas>: en Node, un lienzo que no hace nada
const noop: unknown = new Proxy(() => noop, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop) });
if (typeof document === 'undefined') {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } });
}

const D2R = Math.PI / 180;

/** Prueba libre con una grúa puesta en (x, z, h) sobre el terreno, que conduce con `drv` */
function freeAt(id: string, x: number, z: number, h: number) {
  const ses = new Session(sessionDef(`?grua=${id}`), new THREE.Scene(), allModels);
  const u = ses.act;
  let drv: DriveInput = IDLE_DRIVE;
  const msgs: string[] = [];
  ses.bus.on('say', (p) => msgs.push(p.text));
  Object.assign(u.S, { x, z, h });
  Object.assign(u.S, groundState(u.T, u.S, ses.terrain));
  u.pose = carrierPose(u.T, u.S, supportMode(u.S, u.T));
  const game = new GameStep(ses, { state: () => IDLE, drive: () => drv });
  // el gancho salta debajo de la cabeza nueva y se calma
  for (let i = 0; i < 60; i++) game.tick(FIXED_DT);
  return {
    ses, u, msgs,
    drive(d: Partial<DriveInput>, s: number) { drv = { ...IDLE_DRIVE, ...d }; for (let i = 0; i < Math.round(s / FIXED_DT); i++) game.tick(FIXED_DT); drv = IDLE_DRIVE; },
    wait(s: number) { for (let i = 0; i < Math.round(s / FIXED_DT); i++) game.tick(FIXED_DT); },
  };
}

describe('terreno (fase 18)', () => {
  beforeAll(async () => { await RAPIER.init(); });

  it('la altura del parche es la del heightfield de Rapier (mismos triángulos)', () => {
    const p = makePatch({ x0: -6, x1: 6, z0: -4, z1: 5 }, 1.5, (x, z) => Math.sin(x * 1.3) * 2 + Math.cos(z * 0.9) * 1.5 + x * z * 0.05);
    const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const W = p.nx * p.cell, Dz = p.nz * p.cell;
    w.createCollider(RAPIER.ColliderDesc.heightfield(p.nz, p.nx, p.h, { x: W, y: 1, z: Dz }).setTranslation(p.x0 + W / 2, 0, p.z0 + Dz / 2));
    w.step();
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const x = p.x0 + 0.01 + ((i * 7.31) % (W - 0.02)), z = p.z0 + 0.01 + ((i * 3.17) % (Dz - 0.02));
      const r = w.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
      if (!r) continue;
      expect(50 - r.timeOfImpact).toBeCloseTo(patchHeight(p, x, z)!, 4);
      n++;
    }
    expect(n).toBeGreaterThan(390);
    w.free();
  });

  it('la meseta de prueba: alturas y taludes', () => {
    expect(mesaHeight(TEST_MESA, 65, -55)).toBe(3);
    expect(mesaHeight(TEST_MESA, 35, -55)).toBeCloseTo(1.5, 6);
    expect(mesaHeight(TEST_MESA, 10, -55)).toBe(0);
    expect(mesaSlopes(TEST_MESA).map(Math.round)).toEqual([6, 12, 18, 45]);
    const T = terrainFor(decorFor(0, null), true);
    expect(T.patches.length).toBe(1);
    // el heightfield de la partida sigue la meseta en los vértices
    expect(T.height(65, -55)).toBeCloseTo(3, 5);
    expect(T.height(35, -55)).toBeCloseTo(1.5, 5);
    expect(T.height(0, 0)).toBe(0);
  });

  it('los 14 niveles son planos en la zona de juego y las colinas empiezan más allá del decorado', () => {
    for (let n = 1; n <= ALL_LEVELS.length; n++) {
      const D = decorFor(n, ALL_LEVELS[n - 1]);
      const T = terrainFor(D, false);
      expect(T.patches).toEqual([]);
      const H = T.hills!;
      expect(H.r0).toBeGreaterThanOrEqual(decorReach(D) + 30);
      // nada del decorado queda sobre una colina
      for (const p of [...D.kit.near, ...D.kit.far]) if (p.k !== 'cyl') expect(hillHeight(H, p.x, p.z)).toBe(0);
      // pero hay colinas (fuera del agua del puerto y del río)
      let top = 0;
      for (let a = 0; a < 360; a += 5) top = Math.max(top, hillHeight(H, D.center[0] + Math.cos(a * D2R) * (H.r1 + 40), D.center[1] + Math.sin(a * D2R) * (H.r1 + 40)));
      expect(top).toBeGreaterThan(15);
    }
  });

  it('en los niveles el chasis sigue en el suelo plano de siempre', () => {
    for (const q of ['?nivel=1', '?nivel=11&grua=at650', '?nivel=14']) {
      const ses = new Session(sessionDef(q), new THREE.Scene(), allModels);
      for (const u of ses.units) expect([u.S.gy, u.S.gb, u.S.gc, u.S.gspread]).toEqual([0, 0, 0, 0]);
      expect(terrainMeshes(ses.terrain)).toEqual([]);
    }
  });

  it('plano inclinado: el ajuste da la pendiente exacta', () => {
    const T = CRANES.medium;
    const flat = new Terrain();
    expect(groundFit(T, (x, z) => flat.height(x, z), 3, 4, 1)).toMatchObject({ y: 0, b: 0, c: 0, slope: 0 });
    // suelo que sube 0,1 por m hacia +x del mundo; chasis mirando a +x: sube hacia delante
    const g = groundFit(T, (x) => 0.1 * x, 10, 0, 0);
    expect(g.b).toBeCloseTo(0.1, 9);
    expect(g.c).toBeCloseTo(0, 9);
    expect(g.y).toBeCloseTo(1, 9);
    // girado 90° a la izquierda (mira a −z): la pendiente queda hacia la derecha... del mundo +x = derecha del chasis
    const g2 = groundFit(T, (x) => 0.1 * x, 10, 0, Math.PI / 2);
    expect(g2.b).toBeCloseTo(0, 9);
    expect(g2.c).toBeCloseTo(0.1, 9);
  });

  it('la AT 60 sube la rampa de 6°, cruza la meseta y baja por el talud de 12°', () => {
    const g = freeAt('medium', 6, -55, 0);
    g.drive({ throttle: 1 }, 9);
    const { S } = g.u;
    expect(S.x).toBeGreaterThan(20);
    expect(S.x).toBeLessThan(50);
    expect(Math.atan(S.gb) / D2R).toBeCloseTo(5.7, 0);
    // la pose de la física y del dibujo va inclinada con el terreno
    const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(g.u.pose.q.x, g.u.pose.q.y, g.u.pose.q.z, g.u.pose.q.w));
    expect(Math.acos(yAxis.y) / D2R).toBeCloseTo(5.7, 0);
    g.drive({ throttle: 1 }, 8);
    expect(S.x).toBeGreaterThan(56);
    expect(S.x).toBeLessThan(80);
    expect(S.gy).toBeCloseTo(3, 2);
    expect(Math.abs(S.gb) + Math.abs(S.gc)).toBeLessThan(1e-6);
    g.drive({ throttle: 1 }, 14);
    expect(S.x).toBeGreaterThan(96);
    expect(S.gy).toBe(0);
    expect(g.msgs.filter((m) => /Pendiente|irregular/.test(m))).toEqual([]);
  });

  it('el desnivel de 45° no se puede bajar ni subir', () => {
    const g = freeAt('medium', 65, -42, -Math.PI / 2); // mirando a +z, hacia el borde de 45°
    g.drive({ throttle: 1 }, 10);
    expect(g.u.S.z).toBeLessThan(-34);
    expect(g.u.S.gy).toBeGreaterThan(2);
    expect(g.msgs.some((m) => /Pendiente|irregular/.test(m))).toBe(true);
    // marcha atrás sí se sale
    const z0 = g.u.S.z;
    g.drive({ throttle: -1 }, 3);
    expect(g.u.S.z).toBeLessThan(z0 - 1);
  });

  it('el talud de 18°: las ruedas no pasan (máx. 15°), las orugas sí (máx. 20°)', () => {
    expect(maxSlope(CRANES.medium) / D2R).toBeCloseTo(15, 9);
    expect(maxSlope(CRANES.crawler) / D2R).toBeCloseTo(20, 9);
    const w = freeAt('medium', 65, -66, Math.PI / 2); // mirando a −z, hacia el talud de 18°
    w.drive({ throttle: 1 }, 14);
    // se para en el borde con el chasis a 15° (no llega abajo, a z = −84)
    expect(w.u.S.z).toBeGreaterThan(-80);
    expect(Math.atan(Math.hypot(w.u.S.gb, w.u.S.gc)) / D2R).toBeLessThanOrEqual(15 + 1e-6);
    expect(w.msgs.some((m) => m.startsWith('Pendiente'))).toBe(true);
    const c = freeAt('crawler', 65, -60, Math.PI / 2);
    c.drive({ throttle: 1 }, 50);
    expect(c.u.S.z).toBeLessThan(-90);
    expect(c.u.S.gy).toBe(0);
  });

  it('sin nivelación todavía, los estabilizadores solo se apoyan en llano', () => {
    const g = freeAt('medium', 30, -55, 0);
    const { T, S } = g.u;
    expect(toggleOutriggers(T, baseConfig(T), S, { padsBlocked: null, loadHanging: false, locked: null })).toBe(t.ops.slopePads);
    const top = freeAt('medium', 65, -55, 0);
    expect(toggleOutriggers(T, baseConfig(T), top.u.S, { padsBlocked: null, loadHanging: false, locked: null })).toBe(t.ops.deploying);
  });

  it('una carga suelta se apoya sobre la meseta (heightfield en Rapier)', () => {
    const g = freeAt('medium', 6, -55, 0);
    const L = g.u.phys.addLoad('Caja', 2, { x: 1, y: 0.5, z: 1 }, { x: 65, y: 6, z: -50 });
    g.wait(3);
    expect(L.body.translation().y).toBeCloseTo(3.5, 1);
    // y sobre la rampa también (de lado, se queda o resbala, pero no la atraviesa)
    const R = g.u.phys.addLoad('Caja', 2, { x: 1, y: 0.5, z: 1 }, { x: 35, y: 4, z: -45 });
    g.wait(3);
    const p = R.body.translation();
    expect(p.y).toBeGreaterThan(g.ses.terrain.height(p.x, p.z) + 0.3);
  });
});
