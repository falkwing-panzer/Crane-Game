import * as THREE from 'three';
import type { CrawlerSpec } from '../crane/cranes';
import type { CraneState } from '../crane/kinematics';
import type { Pose } from '../crane/pose';
import { Parts } from './models/builder';
import { ladder, operatorCab, railing } from './models/details';
import { palette } from './models/materials';
import { crawlerLayout, cwBlock, loopLength, loopPoint, trayBlock, type CrawlerLayout } from './models/crawlerLayout';
import { blockPieces } from './models/layout';
import { PlateMeshes, plateColors } from './models/plates';
import { boomLattice, latticeSegs, type Seg } from './models/lattice';
import type { Eye } from './craneModel';

// Grúa sobre orugas (fase 6): rama T.crawler de craneModel() en la referencia. Cada grupo rígido (tren de
// rodaje, superestructura, pie y cabeza de la pluma) se fusiona por material; las tejas de las orugas y las
// barras de la celosía van con InstancedMesh (las de la pluma se colocan una sola vez: la pluma no cambia de largo).

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
const bar = new THREE.CylinderGeometry(1, 1, 1, 6);
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Lleva el eje y de un cilindro al eje x (ruedas del remolque del superlift) */
const Y_TO_X = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2);

/** Barras (segmentos) en un InstancedMesh de cilindros, en el marco de `parent`. */
function bars(parent: THREE.Object3D, segs: Seg[], mat: THREE.Material) {
  const m = new THREE.InstancedMesh(bar, mat, segs.length);
  segs.forEach((g, i) => {
    _a.set(...g.a);
    _b.set(...g.b);
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    _q.setFromUnitVectors(_up, _dir.normalize());
    _m4.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(g.r, len, g.r));
    m.setMatrixAt(i, _m4);
  });
  m.castShadow = m.receiveShadow = true;
  m.computeBoundingSphere();
  parent.add(m);
  return m;
}

export class CrawlerModel {
  readonly root = new THREE.Group();
  readonly L: CrawlerLayout;
  private sup = new THREE.Group();
  private boom = new THREE.Group();
  private shoes: THREE.InstancedMesh;
  private nShoe: number;
  private shoeKey = [NaN, NaN];
  private ropeA: THREE.Mesh;
  private ropeB: THREE.Mesh;
  private pendant: THREE.Mesh | null = null;
  /** Bandeja del superlift (se coloca en x = −slR) y tirantes del derrick */
  private tray = new THREE.Group();
  private ties: THREE.InstancedMesh | null = null;
  /** Ruedas del remolque del superlift (neumáticos, llantas, bujes) y ángulo de rodadura con el que se colocaron */
  private trayWheels: THREE.InstancedMesh[] = [];
  private trayRoll = NaN;
  private half: (d: number) => number;
  /** Piezas que se ocultan en la vista de cabina (la del operador: no hay cabina de conductor) */
  readonly cab: THREE.Object3D[] = [];

  constructor(private T: CrawlerSpec) {
    const L = (this.L = crawlerLayout(T));
    const pal = palette(T);

    // --- Tren de rodaje ---
    const car = new Parts();
    this.buildUndercarriage(car);
    car.build(this.root, pal);
    const lp = L.loop;
    this.nShoe = Math.floor(loopLength(lp) / lp.pitch);
    this.shoes = new THREE.InstancedMesh(box, pal.black, this.nShoe * L.tracks.length);
    this.shoes.castShadow = this.shoes.receiveShadow = true;
    this.shoes.frustumCulled = false;
    this.root.add(this.shoes);

    // --- Superestructura (gira en x = piv) ---
    this.sup.position.set(T.piv, 0, 0);
    this.root.add(this.sup);
    const sp = new Parts();
    this.buildSuper(sp);
    const supMeshes = sp.build(this.sup, pal);
    // contrapeso: dos torres de placas achaflanadas con bastidor (fase 8B); fijo, se coloca una vez
    const cb = blockPieces(cwBlock(L));
    new PlateMeshes(this.sup, cb.plates.length, cb.frame.length, plateColors(T)).set(cb.plates, cb.frame);
    this.cab.push(...supMeshes.filter((m) => m.material === pal.cabin || m.material === pal.glass));

    // cables: de elevación (tambor → pie → cabeza) y tirante del caballete a la cabeza
    this.ropeA = new THREE.Mesh(cyl, pal.black);
    this.ropeB = new THREE.Mesh(cyl, pal.black);
    for (const m of [this.ropeA, this.ropeB]) { m.castShadow = true; this.sup.add(m); }
    if (L.mast) {
      this.pendant = new THREE.Mesh(cyl, pal.pendant);
      this.pendant.castShadow = true;
      this.sup.add(this.pendant);
    }

    // --- Pluma de celosía (marco de la pluma: origen en el pie) ---
    this.boom.position.set(T.foot, T.pivH, 0);
    this.sup.add(this.boom);
    const Lb = T.boom.min;
    const lat = boomLattice(L.bw, Lb);
    this.half = lat.half;
    bars(this.boom, lat.chords, pal.lattice);
    bars(this.boom, lat.diags, pal.latticeDiag);
    // --- Derrick y superlift (LR 3000) ---
    const dk = L.derrick;
    if (dk) {
      // mástil: grupo con origen en el bulón y eje x a lo largo del mástil (celosía colocada una sola vez)
      const g = new THREE.Group();
      g.position.set(dk.foot[0], dk.foot[1], 0);
      g.rotation.z = dk.dirAng;
      this.sup.add(g);
      const dl = latticeSegs({
        d0: 0, d1: dk.len, hw: (d) => (dk.w0 + (dk.w1 - dk.w0) * (d / dk.len)) / 2, bay: Math.max(1.6, dk.w0 * 1.1), stop: dk.len - 0.2,
        rChord: 0.06 * Math.max(1, dk.w0 / 2), rDiag: 0.03 * Math.max(1, dk.w0 / 2),
      });
      bars(g, dl.chords, pal.lattice);
      bars(g, dl.diags, pal.latticeDiag);
      const dp = new Parts();
      dp.box('dark', dk.len - 0.9, dk.len + 0.9, -0.9, 0.9, -1.0, 1.0);
      dp.build(g, pal);
    }
    if (L.tray) {
      const t = L.tray, tp = new Parts();
      this.buildTrailer(tp);
      // placas en dos pilas achaflanadas (fase 8B): se colocan una vez en el grupo de la bandeja
      const tb = blockPieces(trayBlock(t));
      new PlateMeshes(this.tray, tb.plates.length, tb.frame.length, plateColors(T)).set(tb.plates, tb.frame);
      for (const [x, z] of t.hangers) tp.box('dark', x - 0.2, x + 0.2, t.h, t.h + 0.3, z - 0.15, z + 0.15);
      tp.build(this.tray, pal);
      // ruedas del remolque (giran al girar la superestructura): neumático, llanta y buje instanciados
      const n = t.wheel.at.length;
      this.trayWheels = [new THREE.InstancedMesh(cyl, pal.tire, n), new THREE.InstancedMesh(cyl, pal.yellow, n), new THREE.InstancedMesh(bar, pal.greyDeep, n)];
      for (const m of this.trayWheels) { m.frustumCulled = false; m.receiveShadow = true; this.tray.add(m); }
      this.trayWheels[0].castShadow = true;
      this.placeTrayWheels(0);
      this.sup.add(this.tray);
    }
    if (dk) {
      // tirantes: 2 del derrick a la cabeza de pluma, 1 al contrapeso y los de la bandeja (se recolocan cada cuadro)
      this.ties = new THREE.InstancedMesh(cyl, pal.pendant, 3 + (L.tray?.hangers.length ?? 0));
      this.ties.castShadow = true;
      this.ties.frustumCulled = false;
      this.sup.add(this.ties);
    }

    const bp = new Parts();
    this.buildBoomParts(bp);
    bp.build(this.boom, pal);
  }

  private buildUndercarriage(P: Parts) {
    const T = this.T, L = this.L, r = T.track, kk = L.kk;
    for (const t of L.tracks) {
      const { z0, z1 } = t, zm = (z0 + z1) / 2;
      // bastidor, rueda motriz (detrás), rueda guía (delante), rodillos y guía central
      P.box('undercarriage', r.xr + 0.6 * kk, r.xf - 0.6 * kk, 0.35 * kk, 1.05 * kk, z0 + 0.12, z1 - 0.12);
      P.cyl('idler', [r.xr + 0.65 * kk, 0.68 * kk, z0 + 0.08], [r.xr + 0.65 * kk, 0.68 * kk, z1 - 0.08], 0.6 * kk, 16);
      P.cyl('idler', [r.xf - 0.65 * kk, 0.68 * kk, z0 + 0.08], [r.xf - 0.65 * kk, 0.68 * kk, z1 - 0.08], 0.58 * kk, 16);
      for (const z of [z0 + 0.06, z1 - 0.06]) {
        P.cyl('greyDark', [r.xr + 0.65 * kk, 0.68 * kk, z - 0.03], [r.xr + 0.65 * kk, 0.68 * kk, z + 0.03], 0.25 * kk, 8);
        P.cyl('greyDark', [r.xf - 0.65 * kk, 0.68 * kk, z - 0.03], [r.xf - 0.65 * kk, 0.68 * kk, z + 0.03], 0.25 * kk, 8);
      }
      for (const x of L.rollers) P.cyl('roller', [x, 0.32 * kk, z0 + 0.2], [x, 0.32 * kk, z1 - 0.2], 0.24 * kk, 8);
      P.box('dark', r.xr + kk, r.xf - kk, 1.05 * kk, 1.28 * kk, zm - 0.02, zm + 0.02);
    }
    const c = L.carbody;
    P.box('undercarriage', c.x0, c.x1, c.y0, c.y1, c.z0, c.z1);
    for (const x of L.crossbeams) P.box('yellowShade', x - 0.6, x + 0.6, 0.9 * kk, T.deckHi - 0.3, -(r.hw - 0.2), r.hw - 0.2);
    P.cyl('dark', [0, T.deckHi - 0.2, 0], [0, T.deckHi, 0], L.carRingR, 20);
  }

  private buildSuper(P: Parts) {
    const T = this.T, L = this.L, yd = L.yd, ft = T.foot, bw = L.bw, cw = L.cw, wide = L.wide;
    P.cyl('dark', [0, yd, 0], [0, yd + 0.3, 0], L.ringR, 20);
    // plataforma con ranura bajo el pie de pluma
    const pr = cw.x - cw.len / 2 + 0.2, [s0, s1] = L.slot, zs = bw / 2 + 0.08;
    P.box('dark', pr, s0, yd + 0.3, L.plateTop, -wide, wide);
    for (const s of [-1, 1]) P.box('dark', s0, s1, yd + 0.3, L.plateTop, s * zs, s * wide);
    const b = L.rearBody;
    P.box('yellow', b.x0, b.x1, b.y0, b.y1, b.z0, b.z1);
    // rejillas a los costados del cuerpo trasero (motor)
    for (const sg of [-1, 1]) for (let i = 0; i < 5; i++) {
      const x = b.x0 + 0.3 + i * 0.28;
      if (x + 0.12 > b.x1 - 0.2) break;
      P.box('black', x, x + 0.12, b.y0 + 0.15, b.y1 - 0.15, sg * b.z1, sg * (b.z1 + 0.025));
    }
    if (L.housing) {
      const h = L.housing;
      P.box('yellow', h.x0, h.x1, h.y0, h.y1, h.z0, h.z1);
      for (let i = 0; i < 6; i++) {
        const x = h.x0 + 0.3 + i * 0.3;
        if (x + 0.12 > h.x1 - 0.2) break;
        P.box('black', x, x + 0.12, yd + 0.9, yd + 1.3, h.z1, h.z1 + 0.025);
      }
      // barandilla sobre el capó y escalerilla desde la plataforma (fase 8B, aproximación visual)
      const zr = h.z1 - 0.06;
      railing(P, 'greyDeep', [[h.x0 + 0.1, h.z0 + 0.1], [h.x0 + 0.1, zr], [h.x1 - 0.2, zr]], h.y1, 0.8);
      ladder(P, 'greyDeep', [h.x0 + 0.35, h.z1 + 0.05], [h.x0 + 0.75, h.z1 + 0.05], yd + 0.3, h.y1);
    }
    // contrapeso: dos torres de placas instanciadas (fase 8B, ver el constructor)
    // cabrestante y sus soportes
    const d = L.drum;
    for (const s of [-1, 1]) {
      const a = s * (d.hl + 0.05), c = s * (d.hl + 0.15);
      P.box('dark', d.x - 0.55, d.x + 0.55, L.plateTop, d.y + 0.45, Math.min(a, c), Math.max(a, c));
    }
    P.cyl('drum', [d.x, d.y, -d.hl], [d.x, d.y, d.hl], d.r, 14);
    // soportes del pie de pluma y bulón
    for (const s of [-1, 1]) {
      const a = s * (bw / 2 + 0.1), c = s * (bw / 2 + 0.36);
      P.box('yellowShade', ft - 0.9, ft + 1.1, L.plateTop, T.pivH + 0.4, Math.min(a, c), Math.max(a, c));
    }
    P.cyl('greyDeep', [ft, T.pivH, -(bw / 2 + 0.45)], [ft, T.pivH, bw / 2 + 0.45], 0.22, 10);
    // cabina del operador (izquierda) con ménsula, cristales, techo y rotativo
    const c = L.opCab;
    P.box('dark', c.x0 + 0.2, c.x1 - 0.2, yd + 0.3, c.y0, c.z1 - 0.05, -wide + 0.05);
    operatorCab(P, c, -1);
    if (L.gear) this.buildGear(P);
    // soportes y bulón del pie del derrick
    if (L.derrick) {
      const dk = L.derrick;
      for (const b of dk.brackets) P.box('yellowShade', b.x0, b.x1, b.y0, b.y1, b.z0, b.z1);
      P.cyl('greyDeep', [dk.foot[0], dk.foot[1], -2.2], [dk.foot[0], dk.foot[1], 2.2], 0.25, 10);
    }
    // caballete (A) y su tirante al contrapeso
    if (L.mast) {
      const [mx, my] = L.mast.top;
      for (const f of L.mast.feet) P.cyl('mast', f, [mx, my, 0], 0.18, 8);
      P.cyl('pendant', [mx, my, 0], [cw.x, yd + 2.8, 0], 0.03, 6);
    }
  }

  /** Equipos sobre el cuerpo trasero de la LR 3000 (fase 8B): grupo de potencia, depósito, radiador, cabrestantes, barandillas. */
  private buildGear(P: Parts) {
    const g = this.L.gear!, yd = this.L.yd;
    // grupo de potencia (derecha): capó con rejillas en el costado, filete arriba y dos escapes
    const k = g.pack;
    P.box('yellow', k.x0, k.x1, k.y0, k.y1, k.z0, k.z1);
    P.box('yellowShade', k.x0 - 0.05, k.x1 + 0.05, k.y1 - 0.12, k.y1, k.z0 - 0.05, k.z1 + 0.05);
    for (let x = k.x0 + 0.4; x + 0.14 < k.x1 - 0.3; x += 0.32) P.box('black', x, x + 0.14, k.y0 + 0.5, k.y1 - 0.4, k.z1, k.z1 + 0.025);
    const kl = k.x1 - k.x0, ez = (k.z0 + k.z1) / 2 + 0.15 * (k.z1 - k.z0), er = Math.min(0.13, 0.05 * kl + 0.03);
    for (let z = k.z0 + 0.3; z + 0.12 < k.z1 - 0.2; z += 0.3) P.box('black', k.x0 + 0.1 * kl, k.x0 + 0.4 * kl, k.y1, k.y1 + 0.02, z, z + 0.12);
    for (const x of [k.x1 - 0.29 * kl, k.x1 - 0.16 * kl]) P.cyl('dark', [x, k.y1, ez], [x, k.y1 + Math.min(1.1, 0.45 * kl), ez], er, 8);
    // depósito hidráulico (izquierda, atrás) con su tapa y radiador delante con dos ventiladores arriba
    const t = g.tank;
    P.box('yellowShade', t.x0, t.x1, t.y0, t.y1, t.z0, t.z1);
    P.cyl('greyDeep', [(t.x0 + t.x1) / 2, t.y1, (t.z0 + t.z1) / 2], [(t.x0 + t.x1) / 2, t.y1 + 0.15, (t.z0 + t.z1) / 2], 0.25, 10);
    const c = g.cooler;
    P.box('dark', c.x0, c.x1, c.y0, c.y1, c.z0, c.z1);
    // ventiladores repartidos a lo largo del lado más largo del radiador
    const cx = c.x1 - c.x0, cz = c.z1 - c.z0, alongX = cx >= cz, big = alongX ? cx : cz, small = alongX ? cz : cx;
    const nf = Math.max(1, Math.min(2, Math.floor(big / small))), fr = Math.min(0.75, small / 2 - 0.08, big / (2 * nf) - 0.05);
    for (let i = 0; i < nf; i++) {
      const u = (i + 0.5) / nf, x = alongX ? c.x0 + u * cx : (c.x0 + c.x1) / 2, z = alongX ? (c.z0 + c.z1) / 2 : c.z0 + u * cz;
      P.cyl('black', [x, c.y1, z], [x, c.y1 + 0.06, z], fr, 16);
    }
    for (let x = c.x0 + 0.15; x + 0.08 < c.x1 - 0.1; x += 0.2) P.box('black', x, x + 0.08, c.y0 + 0.3, c.y1 - 0.25, c.z0 - 0.025, c.z0);
    // cabrestantes del derrick y del superlift: tambor con bridas entre dos placas
    for (const d of g.drums) {
      P.cyl('drum', [d.x, d.y, -d.hl], [d.x, d.y, d.hl], d.r, 16);
      for (const s of [-1, 1]) {
        P.cyl('greyDeep', [d.x, d.y, s * d.hl], [d.x, d.y, s * (d.hl + 0.08)], d.r + 0.18, 16);
        const a = s * (d.hl + 0.1), b = s * (d.hl + 0.3);
        P.box('dark', d.x - d.r - 0.25, d.x + d.r + 0.25, g.pack.y0, d.y + 0.35, Math.min(a, b), Math.max(a, b));
      }
    }
    // barandillas a lo largo de los dos bordes y escalerillas para subir desde las orugas
    const r = g.rail;
    for (const s of [-1, 1]) {
      railing(P, 'dark', [[r.x0, s * r.z], [r.x1, s * r.z]], g.pack.y0, 0.9);
      ladder(P, 'dark', [r.x1 - 1.6, s * (this.L.wide + 0.05)], [r.x1 - 1.2, s * (this.L.wide + 0.05)], yd + 0.3, g.pack.y0);
    }
  }

  /**
   * Remolque bajo las placas del superlift (fase 8B, aproximación visual como la foto de Jesús): bastidor, ejes a lo largo
   * de x con su soporte, patas con zapata en las esquinas. Todo dentro de la caja de la bandeja (d × w × h).
   */
  private buildTrailer(P: Parts) {
    const t = this.L.tray!, r = t.wheel.r, hd = t.d / 2, hw = t.w / 2;
    P.box('yellowShade', -hd + 0.15, hd - 0.15, t.frameY, t.base, -hw + 0.15, hw - 0.15);
    for (const z of [-hw + 0.15, hw - 0.15]) P.box('yellow', -hd + 0.1, hd - 0.1, t.frameY - 0.1, t.base, z - 0.12, z + 0.12);
    const zs = [...new Set(t.wheel.at.map(([, z]) => z))];
    for (const z of zs) {
      const xm = Math.max(...t.wheel.at.map(([x]) => Math.abs(x))) + t.wheel.w / 2 + 0.05;
      P.cyl('greyDeep', [-xm, r, z], [xm, r, z], 0.12, 10);
      const xi = Math.min(...t.wheel.at.map(([x]) => Math.abs(x))) - t.wheel.w / 2 - 0.05;
      P.box('dark', -xi, xi, r - 0.2, t.frameY, z - 0.35, z + 0.35);
    }
    for (const [x, z] of t.legs) {
      P.box('yellow', x - 0.15, x + 0.15, 0.25, t.frameY, z - 0.15, z + 0.15);
      P.box('dark', x - 0.35, x + 0.35, 0, 0.25, z - 0.35, z + 0.35);
    }
    ladder(P, 'dark', [hd - 0.12, -0.9], [hd - 0.12, -0.5], 0.2, t.base);
  }

  /** Coloca las ruedas del remolque con el ángulo de rodadura `roll` (solo si cambió). */
  private placeTrayWheels(roll: number) {
    if (roll === this.trayRoll || !this.trayWheels.length) return;
    this.trayRoll = roll;
    const t = this.L.tray!, r = t.wheel.r, w = t.wheel.w;
    _q.setFromAxisAngle(X_AXIS, roll).multiply(Y_TO_X);
    t.wheel.at.forEach(([x, z], i) => {
      const out = Math.sign(x);
      _m4.compose(_p.set(x, r, z), _q, _s.set(r, w, r));
      this.trayWheels[0].setMatrixAt(i, _m4);
      _m4.compose(_p.set(x + out * (w / 2 - 0.01), r, z), _q, _s.set(r * 0.62, 0.06, r * 0.62));
      this.trayWheels[1].setMatrixAt(i, _m4);
      _m4.compose(_p.set(x + out * (w / 2 + 0.04), r, z), _q, _s.set(r * 0.25, 0.1, r * 0.25));
      this.trayWheels[2].setMatrixAt(i, _m4);
    });
    for (const m of this.trayWheels) m.instanceMatrix.needsUpdate = true;
  }

  /** Pie macizo, cabeza y polea (marco de la pluma). */
  private buildBoomParts(P: Parts) {
    const L = this.L, Lb = this.T.boom.min, w = L.bw * 0.6;
    P.ext('latticeFoot', L.foot, -L.footHalf, L.footHalf);
    P.box('dark', Lb - 0.9, Lb + 0.3, -w / 2, w / 2, -w / 2, w / 2);
    P.cyl('steel', [Lb + 0.1, 0, -0.35], [Lb + 0.1, 0, 0.35], 0.5, 14);
  }

  /** Ojo del operador (vista de cabina) en el marco del chasis: gira con la superestructura. */
  eye(S: CraneState): Eye {
    const e = this.L.eye, c = Math.cos(S.slew), s = Math.sin(S.slew);
    return { x: this.T.piv + e.x * c + e.z * s, y: e.y, z: -e.x * s + e.z * c, fx: c, fz: -s };
  }

  /** slR = radio actual del superlift (C.slR); se ignora en la LR 300 */
  update(S: CraneState, pose: Pose, slR = this.T.superlift?.r0 ?? 0) {
    const T = this.T, L = this.L;
    this.root.position.set(pose.t.x, pose.t.y, pose.t.z);
    this.root.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    this.updateShoes(S);
    this.sup.rotation.y = S.slew;
    this.boom.rotation.z = S.ang;

    const c = Math.cos(S.ang), s = Math.sin(S.ang);
    const bp = (d: number, u: number, v: THREE.Vector3) => v.set(T.foot + d * c - u * s, T.pivH + d * s + u * c, 0);
    // cable de elevación: tambor → sobre el pie de pluma → polea de la cabeza
    const d = L.drum, Lb = S.Lb;
    _a.set(d.x, d.y + d.r, 0);
    bp(1.0, L.bw / 2 + 0.15, _b);
    this.placeCyl(this.ropeA, _a, _b, 0.025);
    bp(Lb + 0.1, 0.5, _p);
    this.placeCyl(this.ropeB, _b, _p, 0.025);
    // tirante del caballete a la cabeza (por el cordón de arriba)
    if (this.pendant && L.mast) {
      _a.set(L.mast.top[0], L.mast.top[1], 0);
      bp(Lb - 0.6, this.half(Lb), _b);
      this.placeCyl(this.pendant, _a, _b, 0.03);
    }
    // derrick: tirantes a la cabeza de pluma, al contrapeso y a la bandeja del superlift
    const dk = L.derrick;
    if (dk && this.ties) {
      let i = 0;
      const [tx, ty] = dk.top;
      for (const z of [-dk.pendantZ, dk.pendantZ]) {
        _a.set(tx, ty, z);
        bp(Lb - 0.8, 0, _b).setZ(z);
        this.tie(i++, _a, _b, 0.07);
      }
      this.tie(i++, _a.set(tx, ty - 0.5, 0), _b.set(L.cw.x, L.cw.top, 0), 0.06);
      if (L.tray) {
        this.tray.position.x = -slR;
        // al girar, la bandeja avanza en +z del marco de la superestructura (slew·slR): las ruedas ruedan
        this.placeTrayWheels((S.slew * slR) / L.tray.wheel.r);
        for (const [x, z] of L.tray.hangers) {
          this.tie(i++, _a.set(tx, ty, Math.sign(z) * dk.hangerZ), _b.set(x - slR, L.tray.h + 0.3, z), 0.05);
        }
      }
      this.ties.instanceMatrix.needsUpdate = true;
    }
    this.root.updateMatrixWorld();
  }

  /** Tejas: avanzan por el contorno lo que recorrió cada oruga (solo se recolocan si cambia). */
  private updateShoes(S: CraneState) {
    if (S.trackL === this.shoeKey[0] && S.trackR === this.shoeKey[1]) return;
    this.shoeKey = [S.trackL, S.trackR];
    const L = this.L, lp = L.loop, step = loopLength(lp) / this.nShoe;
    let i = 0;
    for (const t of L.tracks) {
      const off = t.side < 0 ? S.trackL : S.trackR, zm = (t.z0 + t.z1) / 2, w = t.z1 - t.z0;
      for (let k = 0; k < this.nShoe; k++) {
        const p = loopPoint(lp, k * step + off);
        _q.setFromAxisAngle(Z_AXIS, p.a);
        _m4.compose(_p.set(p.x, p.y, zm), _q, _s.set(lp.shoe[0], lp.shoe[1], w));
        this.shoes.setMatrixAt(i++, _m4);
      }
    }
    this.shoes.instanceMatrix.needsUpdate = true;
  }

  /** Eje lateral de la superestructura en el mundo (para repartir los ramales del gancho). */
  lateral(out: THREE.Vector3) {
    return out.setFromMatrixColumn(this.sup.matrixWorld, 2).normalize();
  }

  /** Coloca el tirante i (cilindro de a a b) en el InstancedMesh de tirantes. */
  private tie(i: number, a: THREE.Vector3, b: THREE.Vector3, r: number) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    _q.setFromUnitVectors(_up, _dir.normalize());
    _m4.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(r, Math.max(0.01, len), r));
    this.ties!.setMatrixAt(i, _m4);
  }

  private placeCyl(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    _dir.normalize();
    m.quaternion.setFromUnitVectors(_up, _dir);
    m.scale.set(r, Math.max(0.01, len), r);
    m.position.copy(a).addScaledVector(_dir, len / 2);
  }
}
