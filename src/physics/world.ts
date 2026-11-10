import RAPIER from '@dimforge/rapier3d-compat';
import { SLING, bodyHalf, isCrawler, type CraneSpec, type WheeledSpec } from '../crane/cranes';
import { blockPieces, cwPieces, cwDims, hookScale, layout, type Box3, type Layout } from '../render/models/layout';
import { crawlerLayout, cwBlock } from '../render/models/crawlerLayout';
import { trayHitsTracks } from '../crane/superlift';
import { carrierLift, headPos, jibOn, tipPos, type CraneState } from '../crane/kinematics';
import { craneMasses, supportRect, type CraneConfig, type SupportMode } from '../crane/stability';
import { apply, axisAngle, mul, rotate, type Pose, type V3 } from '../crane/pose';
import { padsOnSoft, terrainBlocked, type SoftZone } from '../crane/terrain';
import { COUNTER_JIB, towerGeom } from '../crane/tower';
import { foldedTowerBox } from '../render/models/tower';

// Unidades de masa: toneladas (igual que la referencia). Gravedad 9,81 m/s².
// Mientras la grúa está de pie NO es un cuerpo dinámico: su cinemática viene del modelo analítico y aquí
// solo se reflejan su chasis y su superestructura (cuerpos cinemáticos) para que la carga choque con ellos.
// Cuando el modelo analítico decide el vuelco, tipOver() la cambia por un único cuerpo dinámico.

export const FIXED_DT = 1 / 60;
const G = 9.81;

/** Medio alto del cuerpo del gancho: el cable se ancla arriba, la eslinga abajo. */
export const HOOK_HALF_H = 0.5;

export interface Load {
  label: string;
  mass: number;
  half: { x: number; y: number; z: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Posición inicial, para reponer la carga */
  home: { x: number; y: number; z: number };
}

/** Obstáculo fijo de la obra (caja), girado `rotY` alrededor del eje vertical. */
export interface Obstacle {
  label: string;
  kind: 'block' | 'container';
  half: { x: number; y: number; z: number };
  pos: { x: number; y: number; z: number };
  rotY: number;
  color?: string;
}

/** Medio lado de la obra: más allá no se puede conducir (Límite de la obra de la referencia). */
export const SITE_HALF = 150;
/** Altura libre bajo el chasis: lo más bajo no lo bloquea (la referencia ignora cajas de menos de 0,35 m). */
const CLEARANCE = 0.35;

export class Physics {
  readonly world: RAPIER.World;
  readonly hookBody: RAPIER.RigidBody;
  readonly hookCollider: RAPIER.Collider;
  readonly loads: Load[] = [];
  readonly obstacles: Obstacle[] = [];
  /** Terreno blando (barro, agua): no es un colisionador, solo impide entrar o apoyar zapatas */
  readonly softs: SoftZone[] = [];
  /** Carga enganchada, si la hay */
  attached: Load | null = null;
  /** Tensión del cable (t), filtrada; incluye el gancho */
  tension = 0;
  /** Punto de suspensión para el momento de la tensión (gp de la referencia), en el mundo */
  gp = { x: 0, z: 0 };
  /** Cuerpo dinámico de la grúa volcada (null mientras está de pie) */
  tipped: RAPIER.RigidBody | null = null;
  /** Radio actual del superlift (C.slR; se pasa en step) y giro de la superestructura */
  slR: number;
  private slew = 0;

  /** Suelo (las consultas de choques no lo cuentan: el suelo del plumín se mira aparte) */
  private groundCol!: RAPIER.Collider;
  private chassisBody!: RAPIER.RigidBody;
  private supBody!: RAPIER.RigidBody;
  /** Bandeja del superlift (colisionador de la superestructura, se mueve con el radio) */
  private trayCol: RAPIER.Collider | null = null;
  private trayAt = NaN;
  private headBody!: RAPIER.RigidBody;
  /** Torres de lastre (grúas de ruedas con lastre): colisionadores de la superestructura que crecen con el montaje */
  private wheeledL: Layout | null = null;
  private towerCols: RAPIER.Collider[] = [];
  /** Placas de la torre derecha del contrapeso de las orugas (fijas; se calculan una vez) */
  private crawlerCw: Box3[] | null = null;
  private towerAt = NaN;
  private cableJoint!: RAPIER.ImpulseJoint;
  private slingJoint: RAPIER.ImpulseJoint | null = null;
  /** Cabeza de pluma en el marco del cuerpo volcado */
  private headLocal: V3 = { x: 0, y: 0, z: 0 };
  private head: V3 = { x: 0, y: 0, z: 0 };
  private trHook = newTrack();
  /** Cabeza en el paso anterior (velocidad de la cabeza para dampRope) */
  private headPrev: V3 | null = null;
  private cablePrev = 0;
  private trLoad = newTrack();

  constructor(private T: CraneSpec, S: CraneState, pose: Pose) {
    this.slR = T.superlift?.r0 ?? 0;
    this.slew = S.slew;
    // contrapeso en placas (fase 8B: también el fijo de las grúas sin lastre); la grúa torre lo lleva arriba
    if (!isCrawler(T) && !T.tower) this.wheeledL = layout(T as WheeledSpec);
    const world = (this.world = new RAPIER.World({ x: 0, y: -G, z: 0 }));
    world.timestep = FIXED_DT;
    // Medido (fase 2): con 8 + 16 iteraciones internas el cable no se estira al izar ni con 200 t colgando
    // de un gancho de 0,4 t (≤ 6 cm); con los valores por defecto se estiraba metros. Costo < 0,02 ms por paso.
    world.numSolverIterations = 8;
    world.numInternalPgsIterations = 16;

    // Suelo
    this.groundCol = world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.8));

    this.buildStanding(pose);
    this.head = apply(pose, tipPos(T, S));

    // Gancho
    const h = this.head;
    this.hookBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(h.x, h.y - S.cable - HOOK_HALF_H, h.z)
        .setLinearDamping(0.02)
        .setAngularDamping(2.0)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    // ancho y fondo del bloque escalados como el dibujo (hookScale de la referencia); el alto es fijo
    const hb = hookScale(T);
    this.hookCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.55 * hb, HOOK_HALF_H, 0.21 * hb).setMass(T.hookM).setFriction(0.6),
      this.hookBody,
    );
    this.cableJoint = this.makeCable(this.headBody, { x: 0, y: 0, z: 0 }, S.cable);

    // Carga de prueba: caja de 2 t delante a la derecha de la grúa (fuera del chasis de la LR 3000)
    this.addLoad('Caja', 2.0, { x: 1.0, y: 0.5, z: 0.7 }, { x: Math.max(9, T.len[1] + 3), y: 0.5, z: 6 });
  }

  addObstacle(o: Obstacle) {
    const q = axisAngle(0, 1, 0, o.rotY);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(o.half.x, o.half.y, o.half.z).setTranslation(o.pos.x, o.pos.y, o.pos.z).setRotation(q).setFriction(0.8),
    );
    this.obstacles.push(o);
  }

  /**
   * ¿El chasis en la pose (x, z, h) toca algo? (carrierBlocked de la referencia). Caja del chasis desde la
   * altura libre hasta la plataforma; cuentan los obstáculos y las cargas sueltas, no el gancho ni la carga
   * enganchada. Se prueba antes de mover: el chasis cinemático empujaría cualquier cosa sin frenarse.
   */
  carrierBlocked(x: number, z: number, h: number): string | null {
    const T = this.T, [L0, L1] = T.len;
    const c = Math.cos(h), s = Math.sin(h);
    // esquinas en el mundo para el límite de la obra
    for (const lx of [L0, L1]) for (const lz of [-bodyHalf(T), bodyHalf(T)]) {
      const wx = x + c * lx + s * lz, wz = z - s * lx + c * lz;
      if (Math.abs(wx) > SITE_HALF || Math.abs(wz) > SITE_HALF) return 'Límite de la obra';
    }
    const soft = terrainBlocked(T, this.softs, x, z, h);
    if (soft) return soft;
    const cx = (L0 + L1) / 2, hy = (T.deckHi - CLEARANCE) / 2;
    const shape = new RAPIER.Cuboid((L1 - L0) / 2, hy, bodyHalf(T));
    const pos = { x: x + c * cx, y: CLEARANCE + hy, z: z - s * cx };
    if (this.hitsSomething(pos, axisAngle(0, 1, 0, h), shape)) return 'El chasis toca un obstáculo';
    // grúa torre plegada: sobresale por delante del camión (no está en la referencia, que solo mira el chasis)
    if (T.tower) {
      const b = foldedTowerBox(T), bx = (b.x0 + b.x1) / 2;
      const tp = { x: x + c * bx, y: (b.y0 + b.y1) / 2, z: z - s * bx };
      if (this.hitsSomething(tp, axisAngle(0, 1, 0, h), new RAPIER.Cuboid((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, b.hz))) return 'La torre plegada toca un obstáculo';
    }
    // la bandeja del superlift se arrastra con la grúa (no está en la referencia, que solo mira el chasis)
    return T.superlift ? this.trayBlocked(x, z, h, this.slew, this.slR) : null;
  }

  /**
   * ¿La bandeja del superlift, con el chasis en (x, z, h), el giro `slew` y el radio `slR`, toca un obstáculo,
   * una carga suelta o las orugas? (parte superlift de boomHit en la referencia, que mira solo obstáculos).
   * Lo que mide menos de 0,2 m de alto no cuenta.
   */
  trayBlocked(x: number, z: number, h: number, slew: number, slR: number): string | null {
    const T = this.T, sl = T.superlift;
    if (!sl) return null;
    if (trayHitsTracks(T, slR, slew)) return 'El lastre superlift tocaría las orugas';
    const c = Math.cos(h), s = Math.sin(h);
    // centro de la bandeja: en el marco del chasis (piv − slR·cos slew, slR·sin slew), luego al mundo
    const lx = T.piv - slR * Math.cos(slew), lz = slR * Math.sin(slew);
    const pos = { x: x + c * lx + s * lz, y: 0.2 + (sl.h - 0.2) / 2, z: z - s * lx + c * lz };
    if (Math.max(Math.abs(pos.x), Math.abs(pos.z)) + Math.hypot(sl.d, sl.w) / 2 > SITE_HALF) return 'Límite de la obra';
    const shape = new RAPIER.Cuboid(sl.d / 2 + 0.2, (sl.h - 0.2) / 2, sl.w / 2 + 0.2);
    return this.hitsSomething(pos, axisAngle(0, 1, 0, h + slew), shape) ? 'El lastre superlift golpearía un obstáculo' : null;
  }

  /**
   * Las dos torres de lastre al avance cwS (cajas envolventes, sin chaflán) en el marco de la superestructura:
   * medias medidas y centro de la torre derecha (+z); la izquierda es la simétrica. null si no hay torres.
   */
  towerBox(cwS: number): { hx: number; hy: number; hz: number; cx: number; cy: number; cz: number } | null {
    const L = this.wheeledL, T = this.T;
    // orugas (fase 8B): las dos torres del contrapeso de la superestructura
    const ps = L ? cwPieces(T, L, cwS).plates.filter((p) => p.side > 0).map((p) => p.box)
      : isCrawler(T) ? (this.crawlerCw ??= blockPieces(cwBlock(crawlerLayout(T))).plates.filter((p) => p.side > 0).map((p) => p.box)) : [];
    if (!ps.length) return null;
    const x0 = Math.min(...ps.map((b) => b.x0)), x1 = Math.max(...ps.map((b) => b.x1));
    const y0 = Math.min(...ps.map((b) => b.y0)), y1 = Math.max(...ps.map((b) => b.y1));
    const z0 = Math.min(...ps.map((b) => b.z0)), z1 = Math.max(...ps.map((b) => b.z1));
    return { hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2 };
  }

  /**
   * ¿El contrapeso (las dos torres de lastre al avance cwS), con la grúa en S y el giro `slew`, toca un obstáculo o
   * una carga suelta? (no está en la referencia: su boomHit no mira el contrapeso). Margen de 0,1 m.
   */
  tailBlocked(S: CraneState, slew: number, cwS: number): string | null {
    const b = this.towerBox(cwS);
    if (!b) return null;
    const T = this.T, c = Math.cos(S.h), s = Math.sin(S.h), cs = Math.cos(slew), ss = Math.sin(slew);
    const shape = new RAPIER.Cuboid(b.hx + 0.1, b.hy, b.hz + 0.1);
    const rot = axisAngle(0, 1, 0, S.h + slew);
    for (const side of [1, -1]) {
      // superestructura → chasis (como trayCorners) → mundo
      const lx = b.cx, lz = side * b.cz;
      const px = T.piv + lx * cs + lz * ss, pz = -lx * ss + lz * cs;
      const pos = { x: S.x + c * px + s * pz, y: b.cy + carrierLift(S), z: S.z - s * px + c * pz };
      if (this.hitsSomething(pos, rot, shape)) return 'El contrapeso golpearía un obstáculo';
    }
    return null;
  }

  /** ¿Hay sitio para las zapatas? (padsBlocked de la referencia, con un margen de 0,6 m alrededor). */
  padsBlocked(S: CraneState): string | null {
    const o = this.T.out;
    if (!o) return null;
    const c = Math.cos(S.h), s = Math.sin(S.h), q = axisAngle(0, 1, 0, S.h);
    const shape = new RAPIER.Cuboid(0.6, 0.5, 0.6);
    for (const lx of [o.xf, o.xr]) for (const lz of [-o.hw, o.hw]) {
      const wx = S.x + c * lx + s * lz, wz = S.z - s * lx + c * lz;
      if (Math.abs(wx) > SITE_HALF || Math.abs(wz) > SITE_HALF) return 'No hay espacio para los estabilizadores';
      if (this.hitsSomething({ x: wx, y: 0.55, z: wz }, q, shape)) return 'Un obstáculo impide abrir los estabilizadores';
    }
    return padsOnSoft(this.T, this.softs, S.x, S.z, S.h);
  }

  /**
   * Gancho debajo del punto `anchor` (mundo), quieto, a `cable` de distancia o apoyado en el suelo si no llega
   * (al montar el plumín la punta queda a 0,7 m: el gancho se queda en el suelo con el cable flojo).
   */
  private placeHook(anchor: V3, cable: number) {
    const y = Math.max(HOOK_HALF_H + 0.05, anchor.y - cable - HOOK_HALF_H);
    const off = y > anchor.y - HOOK_HALF_H ? 1.2 : 0; // si la punta está muy baja, al lado y no debajo
    this.hookBody.setTranslation({ x: anchor.x + off, y, z: anchor.z }, true);
    this.hookBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.hookBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.hookBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.trHook = newTrack();
    this.headPrev = null;
  }

  /**
   * Choque del plumín montado con la grúa en `pose` (boomHit de la referencia, que mira obstáculos y cargas sueltas
   * con un margen; aquí también el suelo). Devuelve cuánto toca: 10 por metro bajo 0,5 m de altura de la punta y 1
   * por cada uno de los 8 tramos que toca algo. 0 = libre.
   */
  jibHits(S: CraneState, pose: Pose): { n: number; what: string } {
    const T = this.T, jd = T.jibDef;
    if (!jd || !jibOn(T, S)) return { n: 0, what: '' };
    const a = apply(pose, headPos(T, S)), b = apply(pose, tipPos(T, S));
    let n = 0, what = '';
    const low = Math.min(a.y, b.y);
    if (low < JIB_MIN_H) { n += (JIB_MIN_H - low) * 10; what = 'El plumín tocaría el suelo'; }
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    // el eje x de la caja a lo largo del plumín: primero el cabeceo (z), después el rumbo (y)
    const rot = mul(axisAngle(0, 1, 0, Math.atan2(-dz, dx)), axisAngle(0, 0, 1, Math.atan2(dy, Math.hypot(dx, dz))));
    const N = 8, shape = new RAPIER.Cuboid(len / N / 2, JIB_HALF, JIB_HALF);
    for (let i = 0; i < N; i++) {
      const k = (i + 0.5) / N;
      if (this.hitsSomething({ x: a.x + dx * k, y: a.y + dy * k, z: a.z + dz * k }, rot, shape)) { n++; what = 'El plumín golpearía un obstáculo'; }
    }
    return { n, what };
  }

  /**
   * ¿Se puede armar el plumín en el suelo? (no está en la referencia) Los tramos van delante de la cabeza, de 1,5 m a
   * 1,5 m + largo, apoyados (1,5 m de alto y de ancho). Obstáculos, cargas sueltas y límite de la obra.
   */
  jibGroundBlocked(S: CraneState, pose: Pose): string | null {
    const T = this.T, jd = T.jibDef;
    if (!jd) return null;
    const h = apply(pose, headPos(T, S)), th = S.h + S.slew;
    const fx = Math.cos(th), fz = -Math.sin(th);
    const end = { x: h.x + fx * (1.5 + jd.len), z: h.z + fz * (1.5 + jd.len) };
    if (Math.max(Math.abs(end.x), Math.abs(end.z)) > SITE_HALF) return 'No hay sitio en la obra para armar el plumín';
    const d = 1.5 + jd.len / 2;
    const pos = { x: h.x + fx * d, y: 0.85, z: h.z + fz * d };
    return this.hitsSomething(pos, axisAngle(0, 1, 0, th), new RAPIER.Cuboid(jd.len / 2, 0.75, 0.9))
      ? 'Un obstáculo impide armar el plumín en el suelo: gira la pluma hacia un sitio libre' : null;
  }

  /**
   * Choque de la grúa torre con el entorno (boomHit de la referencia: la torre desde 3 m sobre la bisagra y la pluma,
   * contra obstáculos y cargas sueltas; aquí también la contrapluma). Geometría de towerGeom en la pose dada, en
   * cualquier punto del montaje. Devuelve cuántos tramos tocan (0 = libre) y qué.
   */
  towerHits(S: CraneState, pose: Pose): { n: number; what: string } {
    const T = this.T;
    if (!T.tower) return { n: 0, what: '' };
    const g = towerGeom(T, S);
    const P = (v: [number, number, number]) => ({ x: v[0], y: v[1], z: v[2] });
    const at = (o: [number, number, number], d: [number, number, number], k: number) => P([o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k]);
    const pieces: [V3, V3, number, number, string][] = [
      [at(g.base, g.dir, 3), P(g.top), 1.0, 5, 'La torre golpearía un obstáculo'],
      [P(g.top), at(g.top, g.jd, g.jlVis), 0.6, 10, 'La pluma golpearía un obstáculo'],
      [P(g.top), at(g.top, g.jd, -COUNTER_JIB), 0.6, 2, 'La contrapluma golpearía un obstáculo'],
    ];
    let n = 0, what = '';
    for (const [a0, b0, half, N, msg] of pieces) {
      const a = apply(pose, a0), b = apply(pose, b0);
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
      const rot = mul(axisAngle(0, 1, 0, Math.atan2(-dz, dx)), axisAngle(0, 0, 1, Math.atan2(dy, Math.hypot(dx, dz))));
      const shape = new RAPIER.Cuboid(len / N / 2, half, half);
      for (let i = 0; i < N; i++) {
        const k = (i + 0.5) / N;
        if (this.hitsSomething({ x: a.x + dx * k, y: a.y + dy * k, z: a.z + dz * k }, rot, shape)) { n++; what = msg; }
      }
    }
    return { n, what };
  }

  private hitsSomething(pos: V3, rot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape) {
    let hit = false;
    const own = new Set([this.chassisBody?.handle, this.supBody?.handle, this.headBody?.handle]);
    this.world.intersectionsWithShape(pos, rot, shape, () => { hit = true; return false; }, undefined, undefined, undefined, undefined,
      (col) => {
        if (col.handle === this.hookCollider.handle || col.handle === this.groundCol.handle) return false;
        if (this.attached && col.handle === this.attached.collider.handle) return false;
        const b = col.parent();
        return !(b && own.has(b.handle));
      });
    return hit;
  }

  /** Grúa de pie: chasis y superestructura cinemáticos; cabeza cinemática sin colisionador (ancla del cable). */
  private buildStanding(pose: Pose) {
    const T = this.T, world = this.world;
    this.chassisBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.t.x, pose.t.y, pose.t.z));
    const [L0, L1] = T.len;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((L1 - L0) / 2, T.deckHi / 2, bodyHalf(T)).setTranslation((L0 + L1) / 2, T.deckHi / 2, 0),
      this.chassisBody,
    );
    this.chassisBody.setRotation(pose.q, false);
    this.supBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(...xyz(apply(pose, { x: T.piv, y: 0, z: 0 }))).setRotation(pose.q));
    const b = this.supBox();
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.cx, b.cy, 0), this.supBody);
    // torres de lastre: se dimensionan en step() según el avance del montaje
    this.towerCols = this.wheeledL ? [1, -1].map(() => world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1).setFriction(0.8), this.supBody)) : [];
    this.towerAt = NaN;
    const sl = T.superlift;
    if (sl) {
      this.trayCol = world.createCollider(RAPIER.ColliderDesc.cuboid(sl.d / 2, sl.h / 2, sl.w / 2)
        .setTranslation(-this.slR, sl.h / 2, 0).setFriction(0.8), this.supBody);
      this.trayAt = this.slR;
    }
    this.headBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  }

  /**
   * Caja de la plataforma giratoria + contrapeso en el marco de la superestructura (medias medidas y centro).
   * Grúas de ruedas: la de la fase 2. Orugas: toda la plataforma (del contrapeso al frente, todo el ancho y
   * hasta lo alto del contrapeso), con las cotas del modelo.
   */
  private supBox(): { hx: number; hy: number; hz: number; cx: number; cy: number } {
    const T = this.T;
    if (isCrawler(T)) {
      const L = crawlerLayout(T), x0 = L.cw.x - L.cw.len / 2, x1 = L.front, y0 = L.yd, y1 = Math.max(L.cw.top, L.rearBody.y1);
      return { hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: Math.max(L.wide, L.cw.w), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    // grúa torre: la plataforma giratoria (el contrapeso va arriba, en la contrapluma); ver models/tower.ts
    if (T.tower) return { hx: 2.5, hy: 0.3, hz: 1.3, cx: 0.4, cy: T.deckHi + 0.3 };
    const px0 = T.xCw - T.cwLen / 2, px1 = 1.3;
    return { hx: (px1 - px0) / 2, hy: 0.85, hz: 1.15, cx: (px0 + px1) / 2, cy: T.deckHi + 1.05 };
  }

  private makeCable(body: RAPIER.RigidBody, anchor: V3, len: number) {
    // Cable: rope joint (distancia máxima, puede aflojarse) cabeza → parte superior del gancho
    return this.world.createImpulseJoint(
      RAPIER.JointData.rope(len, anchor, { x: 0, y: HOOK_HALF_H, z: 0 }),
      body, this.hookBody, true,
    );
  }

  addLoad(label: string, mass: number, half: Load['half'], pos: { x: number; y: number; z: number }) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.02).setAngularDamping(0.4),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(0.7),
      body,
    );
    const load = { label, mass, half, body, collider, home: { ...pos } };
    this.loads.push(load);
    return load;
  }

  /** Tecla X: suelta la carga y devuelve todas las cargas a su posición inicial, quietas. */
  resetLoads(): string {
    if (this.slingJoint) {
      this.world.removeImpulseJoint(this.slingJoint, true);
      this.slingJoint = null;
    }
    this.attached = null;
    for (const l of this.loads) {
      l.body.setTranslation(l.home, true);
      l.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      l.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      l.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    return 'Carga repuesta en su posición inicial';
  }

  /** Reiniciar tras el vuelco: grúa de pie con la pose dada, gancho bajo la cabeza y cargas en su sitio. */
  reset(S: CraneState, pose: Pose) {
    this.resetLoads();
    if (this.tipped) { this.world.removeRigidBody(this.tipped); this.tipped = null; }
    else {
      this.world.removeImpulseJoint(this.cableJoint, true);
      for (const b of [this.chassisBody, this.supBody, this.headBody]) this.world.removeRigidBody(b);
    }
    this.slR = this.T.superlift?.r0 ?? 0;
    this.slew = S.slew;
    this.buildStanding(pose);
    this.head = apply(pose, tipPos(this.T, S));
    const h = this.head;
    this.hookBody.setTranslation({ x: h.x, y: h.y - S.cable - HOOK_HALF_H, z: h.z }, true);
    this.hookBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.hookBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.hookBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.cableJoint = this.makeCable(this.headBody, { x: 0, y: 0, z: 0 }, S.cable);
    this.tension = 0;
    this.trHook = newTrack();
    this.trLoad = newTrack();
  }

  /** Un paso de física. `pose` = pose del portador según el modelo analítico (se ignora si ya volcó). */
  step(S: CraneState, pose: Pose, slR = this.slR) {
    this.slR = slR;
    this.slew = S.slew;
    if (this.trayCol && this.trayAt !== slR) {
      this.trayCol.setTranslationWrtParent({ x: -slR, y: this.T.superlift!.h / 2, z: 0 });
      this.trayAt = slR;
    }
    if (this.towerCols.length && this.towerAt !== S.cw && !this.tipped) {
      const b = this.towerBox(S.cw);
      this.towerCols.forEach((col, i) => {
        const side = i ? -1 : 1;
        col.setEnabled(!!b);
        if (!b) return;
        col.setHalfExtents({ x: b.hx, y: b.hy, z: b.hz });
        col.setTranslationWrtParent({ x: b.cx, y: b.cy, z: side * b.cz });
      });
      this.towerAt = S.cw;
    }
    if (!this.tipped) {
      this.chassisBody.setNextKinematicTranslation(pose.t);
      this.chassisBody.setNextKinematicRotation(pose.q);
      this.supBody.setNextKinematicTranslation(apply(pose, { x: this.T.piv, y: 0, z: 0 }));
      this.supBody.setNextKinematicRotation(mul(pose.q, axisAngle(0, 1, 0, S.slew)));
      const anchor = apply(pose, tipPos(this.T, S));
      // el cable cambia de la cabeza a la punta del plumín (o al revés) al montarlo: el gancho se lleva debajo
      if (Math.hypot(anchor.x - this.head.x, anchor.y - this.head.y, anchor.z - this.head.z) > 3) this.placeHook(anchor, S.cable);
      this.head = anchor;
      this.headBody.setNextKinematicTranslation(this.head);
      // El rope joint de Rapier no expone setMaxDistance en JS: su largo es el límite del eje LinX.
      setRopeLength(this.cableJoint, S.cable);
    }
    this.dampSling();
    this.dampRope(S);
    this.world.step();
    if (this.tipped) this.head = this.bodyPoint(this.tipped, this.headLocal.x, this.headLocal.y, this.headLocal.z);
    this.measureTension(S);
  }

  /**
   * Amortiguamiento interno del cable (fase 6B): con una carga colgada, frena la velocidad del gancho y de la
   * carga A LO LARGO del cable que no corresponde a la del cabrestante (cambio de S.cable) ni a la de la cabeza.
   * Sin él, al despegar 800 t la cadena cabeza–gancho–carga quedaba rebotando (±30 % de tensión durante todo
   * el izado). No frena el péndulo: el balanceo es perpendicular al cable. Solo con el cable tenso.
   */
  private dampRope(S: CraneState) {
    const L = this.attached, prev = this.headPrev, rate = (S.cable - this.cablePrev) / FIXED_DT;
    this.headPrev = { ...this.head };
    this.cablePrev = S.cable;
    if (!L || !prev || this.tipped || this.touching(L)) return;
    const tip = this.head, top = this.hookTop();
    const dx = top.x - tip.x, dy = top.y - tip.y, dz = top.z - tip.z, dist = Math.hypot(dx, dy, dz);
    if (dist < S.cable - 0.25 || dist < 0.5) return;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const vh = (tip.x - prev.x) * nx + (tip.y - prev.y) * ny + (tip.z - prev.z) * nz;
    for (const [b, m] of [[this.hookBody, this.T.hookM], [L.body, L.mass]] as const) {
      const v = b.linvel();
      const dev = v.x * nx + v.y * ny + v.z * nz - vh / FIXED_DT - rate;
      const j = -ROPE_DAMP * dev * m;
      b.applyImpulse({ x: j * nx, y: j * ny, z: j * nz }, true);
    }
  }

  /**
   * Amortiguador entre gancho y carga colgada: impulsos iguales y opuestos según su velocidad relativa
   * horizontal. Frena el modo rápido del doble péndulo (el gancho, liviano, oscilando ~0,6 s contra la carga),
   * que en una grúa real apagan el rozamiento de las eslingas y del gancho. Conserva el momento total,
   * así que NO frena el balanceo grande del péndulo. c = 2·ζ·μ·ω con ζ ≈ 0,5, ω ≈ 10 rad/s (medido).
   */
  private dampSling() {
    const L = this.attached;
    if (!L || this.touching(L)) return;
    const mh = this.T.hookM, ml = L.mass, mu = (mh * ml) / (mh + ml);
    const k = Math.min(0.5, 2 * 0.5 * 10 * FIXED_DT) * mu; // impulso por (m/s) de velocidad relativa
    const a = this.hookBody.linvel(), b = L.body.linvel();
    const jx = (a.x - b.x) * k, jz = (a.z - b.z) * k;
    this.hookBody.applyImpulse({ x: -jx, y: 0, z: -jz }, true);
    L.body.applyImpulse({ x: jx, y: 0, z: jz }, true);
  }

  /** Cabeza de pluma en el mundo (donde se ancla el cable). */
  headWorld(): V3 {
    return this.head;
  }

  /** Pose del cuerpo volcado (solo si tipped). */
  tippedPose(): Pose | null {
    if (!this.tipped) return null;
    const t = this.tipped.translation(), q = this.tipped.rotation();
    return { t: { x: t.x, y: t.y, z: t.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }

  /**
   * Tensión del cable a partir del movimiento que calcula Rapier (la API JS no da la fuerza de las juntas):
   * F_cable = Σ m·(a − g) del gancho y, si cuelga libre, de la carga; se proyecta sobre la dirección del cable.
   * Así un balanceo o un tirón también cuentan. Punto de aplicación = gp de la referencia.
   * La aceleración sale de las POSICIONES (segunda diferencia): Rapier corrige el límite del rope moviendo
   * el cuerpo sin cambiar su velocidad, así que con linvel() un izado no se notaría.
   * La segunda diferencia es de paso ACC_STEPS (0,1 s), no de un paso: al izar, esa corrección deja la
   * velocidad en diente de sierra paso a paso (la carga "cae" g·dt y la junta la sube; ±1 cm) y, derivada
   * paso a paso, daba ±150 % de tensión con 800 t en la LR 3000 (fase 6B). Con 0,1 s el tirón se sigue viendo.
   */
  private measureTension(S: CraneState) {
    const h = ACC_STEPS * FIXED_DT;
    const acc = (k: Track, p: V3) => {
      k.hist.push({ x: p.x, y: p.y, z: p.z });
      if (k.hist.length > 2 * ACC_STEPS + 1) k.hist.shift();
      if (k.hist.length < 2 * ACC_STEPS + 1) return { x: 0, y: 0, z: 0 }; // hace falta historia
      const a0 = k.hist[0], a1 = k.hist[ACC_STEPS], a2 = k.hist[2 * ACC_STEPS];
      return { x: (a2.x - 2 * a1.x + a0.x) / (h * h), y: (a2.y - 2 * a1.y + a0.y) / (h * h), z: (a2.z - 2 * a1.z + a0.z) / (h * h) };
    };
    const ah = acc(this.trHook, this.hookBody.translation());
    let fx = this.T.hookM * ah.x, fy = this.T.hookM * (ah.y + G), fz = this.T.hookM * ah.z;
    const L = this.attached;
    if (L) {
      const al = acc(this.trLoad, L.body.translation());
      if (!this.touching(L)) { fx += L.mass * al.x; fy += L.mass * (al.y + G); fz += L.mass * al.z; }
    }
    const tip = this.head, top = this.hookTop();
    const dx = top.x - tip.x, dy = top.y - tip.y, dz = top.z - tip.z, dist = Math.hypot(dx, dy, dz) || 1;
    let t = 0;
    // cable tenso: tolerancia de 0,25 m porque al izar la junta deja el gancho unos cm más cerca de la cabeza que
    // el largo nominal (con 2 cm la tensión de 800 t salía en 300–700 t); flojo de verdad, la fórmula ya da ~0
    if (dist >= S.cable - 0.25) t = Math.max(0, -(fx * dx + fy * dy + fz * dz) / dist) / G;
    // Filtro de primer orden (0,3 s; 0,1 s hasta la fase 6B): quita el ruido de derivar sin perder un tirón.
    this.tension += (t - this.tension) * Math.min(1, FIXED_DT / TENSION_TAU);
    // gp: prolongación del cable hasta el suelo, a lo sumo 10 m de la punta (como la referencia)
    const k = tip.y / Math.max(0.5, tip.y - top.y);
    let gx = dx * k, gz = dz * k;
    const gl = Math.hypot(gx, gz);
    if (gl > 10) { gx *= 10 / gl; gz *= 10 / gl; }
    this.gp = { x: tip.x + gx, z: tip.z + gz };
  }

  /**
   * Vuelco: cambia la grúa por un cuerpo dinámico con la pose actual y la velocidad de giro alrededor
   * de la arista que dio el modelo analítico. Masas y centro de gravedad de craneMasses().
   */
  tipOver(C: CraneConfig, S: CraneState, md: SupportMode, pose: Pose, edgeP: V3, axis: V3) {
    if (this.tipped) return;
    const T = this.T, world = this.world, lift = carrierLift(S);
    // Masas puntuales en el marco del chasis (x, altura, z). Las alturas son aproximaciones:
    // la referencia solo tiene el modelo en planta. Las de solo-estabilizar (superlift) se quedan en el suelo.
    // Orden de craneMasses: portador, superestructura, contrapeso, pluma, [plumín], [derrick], [superlift].
    const cwH = isCrawler(T) ? crawlerLayout(T).cw.y0 + cwDims(T, 0).hgt / 2 : T.deckHi + 1.05;
    const hs = [(T.deckLo + T.deckHi) / 2, T.deckHi + 1.0, cwH, T.pivH + (S.Lb / 2) * Math.sin(S.ang)];
    // grúa torre: la superestructura es sobre todo la torre (a media altura); contrapeso y pluma, arriba
    const tg = T.tower ? towerGeom(T, S) : null;
    if (tg) hs.splice(1, 3, (T.deckHi + tg.top[1]) / 2, tg.top[1], tg.top[1] + tg.jd[1] * T.tower!.J / 2);
    if (C.jib) hs.push(T.pivH + S.Lb * Math.sin(S.ang) + (C.jib.len / 2) * Math.sin(S.ang - S.jibRel));
    if (T.derrick) hs.push(T.deckHi + 2.2 + (T.derrick.len / 2) * Math.sin(T.derrick.ang));
    const pts = craneMasses(T, C, S.Lb, S.ang, S.slew)
      .map(([m, x, y, r], i) => ({ m, x, y: hs[i] ?? T.pivH, z: -y, r }))
      .filter((p) => !p.r); // marco del chasis: la elevación va en la pose
    const M = pts.reduce((s, p) => s + p.m, 0);
    const com = { x: 0, y: 0, z: 0 };
    for (const p of pts) { com.x += p.m * p.x / M; com.y += p.m * p.y / M; com.z += p.m * p.z / M; }
    // Inercia: masas puntuales respecto del CDG + el portador como caja (diagonal; suficiente para la caída)
    const [L0, L1] = T.len, lx = L1 - L0, ly = T.deckHi, lz = 2 * bodyHalf(T);
    const I = { x: T.mCar * (ly * ly + lz * lz) / 12, y: T.mCar * (lx * lx + lz * lz) / 12, z: T.mCar * (lx * lx + ly * ly) / 12 };
    for (const p of pts) {
      const dx = p.x - com.x, dy = p.y - com.y, dz = p.z - com.z;
      I.x += p.m * (dy * dy + dz * dz); I.y += p.m * (dx * dx + dz * dz); I.z += p.m * (dx * dx + dy * dy);
    }

    this.world.removeImpulseJoint(this.cableJoint, true);
    for (const b of [this.chassisBody, this.supBody, this.headBody]) world.removeRigidBody(b);
    this.trayCol = null; // la bandeja iba en supBody: desaparece de la física al volcar
    this.towerCols = [];

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose.t.x, pose.t.y, pose.t.z)
        .setRotation(pose.q)
        .setAdditionalMassProperties(M, com, I, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(true),
    );
    const cub = (hx: number, hy: number, hz: number, x: number, y: number, z: number, q = { x: 0, y: 0, z: 0, w: 1 }) =>
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(q).setDensity(0).setFriction(0.8), body);
    // Apoyo: zapatas si están los estabilizadores; si no, una base del tamaño del apoyo sobre neumáticos.
    // Así el cuerpo pivota sobre la misma arista que el modelo analítico.
    const r = supportRect(T, md);
    if (md === 'out') for (const x of [r.xf, r.xr]) for (const z of [-r.hw, r.hw]) cub(0.36, 0.1, 0.36, x, 0.1 - lift, z);
    else cub((r.xf - r.xr) / 2, 0.2, r.hw, (r.xf + r.xr) / 2, 0.2, 0);
    cub((L1 - L0) / 2, (T.deckHi - T.deckLo) / 2, bodyHalf(T), (L0 + L1) / 2, (T.deckLo + T.deckHi) / 2, 0);
    // superestructura y pluma, giradas con el slew actual alrededor del centro de giro
    const qs = axisAngle(0, 1, 0, S.slew);
    const at = (x: number, y: number) => { const p = rotate(qs, { x, y, z: 0 }); return { x: T.piv + p.x, y: p.y, z: p.z }; };
    const b = this.supBox();
    const sp = at(b.cx, b.cy);
    cub(b.hx, b.hy, b.hz, sp.x, sp.y, sp.z, qs);
    const c = Math.cos(S.ang), s = Math.sin(S.ang);
    if (tg) {
      // torre y pluma (marco del chasis con el giro: towerGeom ya lo incluye)
      const mx = (tg.base[0] + tg.top[0]) / 2, my = (tg.base[1] + tg.top[1]) / 2, mz = (tg.base[2] + tg.top[2]) / 2;
      cub(0.95, tg.hgt / 2, 0.95, mx, my, mz, qs);
      const J = tg.jlVis, jx = tg.top[0] + tg.jd[0] * J / 2, jy = tg.top[1] + tg.jd[1] * J / 2, jz = tg.top[2] + tg.jd[2] * J / 2;
      cub(J / 2, 0.35, 0.7, jx, jy, jz, mul(qs, axisAngle(0, 0, 1, tg.phi)));
    } else {
      const bp = at(T.foot + (S.Lb / 2) * c, T.pivH + (S.Lb / 2) * s);
      cub(S.Lb / 2, T.boom.w * 0.6, T.boom.w / 2, bp.x, bp.y, bp.z, mul(qs, axisAngle(0, 0, 1, S.ang)));
    }

    // Velocidad inicial: giro phiV alrededor de la arista (v = ω × (CDG − arista))
    const w = { x: axis.x * S.phiV, y: axis.y * S.phiV, z: axis.z * S.phiV };
    const cw = apply(pose, com);
    const rx = cw.x - edgeP.x, ry = cw.y - edgeP.y, rz = cw.z - edgeP.z;
    body.setAngvel(w, true);
    body.setLinvel({ x: w.y * rz - w.z * ry, y: w.z * rx - w.x * rz, z: w.x * ry - w.y * rx }, true);

    this.tipped = body;
    const hp = tipPos(T, S);
    this.headLocal = { x: hp.x, y: hp.y, z: hp.z };
    this.cableJoint = this.makeCable(body, this.headLocal, S.cable);
  }

  /** Parte superior del gancho en el mundo (donde llega el cable). */
  hookTop() {
    return this.bodyPoint(this.hookBody, 0, HOOK_HALF_H, 0);
  }

  bodyPoint(b: RAPIER.RigidBody, x: number, y: number, z: number) {
    const t = b.translation(), q = b.rotation();
    const p = rotate(q, { x, y, z });
    return { x: t.x + p.x, y: t.y + p.y, z: t.z + p.z };
  }

  /** ¿La carga toca algo que no sea el gancho? */
  private touching(load: Load) {
    let touching = false;
    this.world.contactPairsWith(load.collider, (other) => {
      if (touching || other.handle === this.hookCollider.handle) return;
      this.world.contactPair(load.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    return touching;
  }

  /** ¿La carga está apoyada en algo que no sea el gancho? */
  isResting(load: Load) {
    const v = load.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.3) return false;
    return this.touching(load);
  }

  /** Espacio: enganchar o soltar. Devuelve el mensaje para el operador (condiciones de la referencia). */
  toggleHook(): string {
    if (this.attached) {
      const load = this.attached;
      if (!this.isResting(load)) return 'Apoya la carga antes de soltarla';
      this.world.removeImpulseJoint(this.slingJoint!, true);
      this.slingJoint = null;
      this.attached = null;
      return `${load.label} soltada`;
    }
    const hp = this.hookBody.translation();
    const hv = this.hookBody.linvel();
    const hookBottom = hp.y - HOOK_HALF_H;
    const load = this.loads.find((l) => {
      const top = this.bodyPoint(l.body, 0, l.half.y, 0);
      const gap = hookBottom - top.y; // gancho apoyado = 0; colgando a la distancia de eslinga ≈ 0,5
      return Math.hypot(top.x - hp.x, top.z - hp.z) < 1.0 && gap > -0.1 && gap < 1.1;
    });
    if (!load) return 'Baja el gancho sobre el centro de la carga para engancharla';
    if (Math.hypot(hv.x, hv.z) > 0.6) return 'Estabiliza el gancho antes de enganchar';
    // Eslinga: rope joint del fondo del gancho al centro de la cara superior de la carga.
    this.slingJoint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(SLING - HOOK_HALF_H, { x: 0, y: -HOOK_HALF_H, z: 0 }, { x: 0, y: load.half.y, z: 0 }),
      this.hookBody, load.body, true,
    );
    this.attached = load;
    this.trLoad = newTrack();
    load.body.wakeUp();
    return `Enganchada ${load.label} · ${load.mass.toFixed(1).replace('.', ',')} t`;
  }
}

/** Altura mínima del eje del plumín (la punta lleva poleas de 0,45 m) */
const JIB_MIN_H = 0.5;
/** Medio ancho de la caja de choques del plumín (celosía de 1,5 m con margen, como boomHit) */
const JIB_HALF = 0.75;

const xyz = (p: V3): [number, number, number] => [p.x, p.y, p.z];

/** Seguimiento de posición para derivar velocidad y aceleración */
interface Track { hist: V3[] }
const newTrack = (): Track => ({ hist: [] });
/** Paso de la segunda diferencia de la tensión (6 pasos = 0,1 s) */
const ACC_STEPS = 6;
/** Constante de tiempo del filtro de la tensión (s) */
const TENSION_TAU = 0.3;
/** Fracción de la velocidad sobrante a lo largo del cable que se quita en cada paso (dampRope) */
const ROPE_DAMP = 0.3;

function setRopeLength(joint: RAPIER.ImpulseJoint, length: number) {
  const raw = (joint as unknown as { rawSet: { jointSetLimits(h: number, axis: number, min: number, max: number): void } }).rawSet;
  raw.jointSetLimits(joint.handle, RAPIER.JointAxis.LinX, 0, length);
}
