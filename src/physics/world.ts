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
import { canTie, tieLug, tieReach, tiedHookCenter } from '../crane/tiedown';
import { foldedTowerBox } from '../render/models/tower';
import type { BoxKind } from '../levels/levels';
import { slingTensions, type SlingObs } from './tandem';
import { t } from '../i18n';
import { Terrain, patchRect } from '../terrain/terrain';

const tw = t.world;

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
  /** Dibujo y reglas de los niveles: color, tipo (kind de la referencia) y velocidad de rotura (cargas frágiles) */
  color?: string;
  kind?: string;
  fragile?: number;
  /**
   * Orejetas (tándem, fase 10): puntos de enganche en el marco de la carga, uno por grúa. Sin orejetas, la eslinga
   * va al centro de la cara superior y la carga la lleva una sola grúa.
   */
  lugs?: V3[];
  /** Eje que queda vertical cuando la carga está colocada (por defecto y; la columna del tándem, x) */
  stand?: 'x';
  /** Dinámica de la carga para el reparto entre eslingas: posiciones y velocidades angulares de los últimos pasos */
  dyn?: { p: V3[]; w: V3[]; step: number; T: Map<Physics, number>; hook: Map<Physics, V3> };
}

/** Límites de la obra en planta (x0…x1, z0…z1) */
export interface Bounds { x0: number; x1: number; z0: number; z1: number }

/** Obstáculo fijo de la obra (caja), girado `rotY` alrededor del eje vertical. */
export interface Obstacle {
  label: string;
  kind: 'block' | BoxKind;
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
  /** Mundo de Rapier (fase 15: cambia al volver a una instantánea, que crea un mundo nuevo) */
  world: RAPIER.World;
  /** Grúas que comparten este mundo (fase 10, tándem): la primera es la que creó el mundo */
  readonly crew: Physics[];
  /** Orejeta de la carga enganchada (−1 = centro de la cara superior) */
  attachedLug = -1;
  /** Paso de física del mundo (lo cuenta la primera grúa): el reparto del tándem se calcula una vez por paso */
  private stepNo = 0;
  /** Parte de la carga del tándem que lleva esta grúa (t), filtrada como la tensión */
  private share = 0;
  /** Gancho contra la cabeza (doble bloqueo) en el último paso */
  private blocked = false;
  /** Largo de la eslinga enganchada (fondo del gancho a la orejeta) */
  private slingLen = SLING - HOOK_HALF_H;
  hookBody: RAPIER.RigidBody;
  hookCollider: RAPIER.Collider;
  readonly loads: Load[];
  readonly obstacles: Obstacle[];
  /**
   * Colisionadores del decorado (fase 17): la carga y el gancho chocan con ellos, pero las comprobaciones de la grúa
   * (chasis, zapatas, contrapeso, bandeja, plumín, torre) no los miran: así ningún nivel cambia de dificultad.
   */
  readonly decor: Set<number>;
  /** Terreno blando (barro, agua): no es un colisionador, solo impide entrar o apoyar zapatas */
  readonly softs: SoftZone[];
  /** Carga enganchada, si la hay */
  attached: Load | null = null;
  /** Gancho amarrado al frente del chasis (posición de transporte): cinemático, sigue al chasis */
  tied = false;
  /** Pose del portador del último paso (para amarrar el gancho al pulsar Espacio) */
  private lastPose: Pose | null = null;
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
  /**
   * Fase 18: terreno de la partida (compartido en el tándem) y los handles de sus heightfields. Como el suelo, no
   * cuentan en las consultas de choques ni como golpe de costado; el rayo de la cámara sí los ve.
   */
  private land!: { terrain: Terrain; cols: Set<number> };
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

  /** Fuerza del viento (t·m/s² en x y z del mundo), que se aplica en cada paso */
  wind = { x: 0, z: 0 };
  /**
   * Lo que le pasó a la carga enganchada en los pasos desde la última vez que se vació: 'land' = empezó a tocar
   * algo (v = velocidad de bajada antes del contacto); 'strike' = empezó a tocar algo de costado (v = velocidad
   * horizontal). Lo vacía quien lo lee (main).
   */
  readonly events: { kind: 'land' | 'strike'; load: Load; v: number }[] = [];

  /** Límites de la obra (prueba libre: ±SITE_HALF; niveles: 0…84 × 0…56 de la referencia) */
  readonly bounds: Bounds;

  /**
   * testLoad: caja de 2 t de prueba (prueba libre); bounds: límites de la obra.
   * site (tándem, fase 10): otra grúa cuyo mundo se comparte (suelo, obstáculos, cargas, terreno y límites).
   */
  /** Esta grúa creó el mundo (la primera); la segunda del tándem lo comparte */
  private readonly ownsWorld: boolean;

  /**
   * Fase 14: libera el mundo de Rapier (memoria del wasm) al desmontar la partida. Solo lo hace la grúa que lo creó;
   * llamar después de soltar las demás. El objeto no se puede usar después.
   */
  dispose() {
    if (this.ownsWorld) this.world.free();
  }

  constructor(private T: CraneSpec, S: CraneState, pose: Pose, opts: { testLoad?: boolean; bounds?: Bounds; site?: Physics } = {}) {
    this.ownsWorld = !opts.site;
    this.slR = T.superlift?.r0 ?? 0;
    this.slew = S.slew;
    // contrapeso en placas (fase 8B: también el fijo de las grúas sin lastre); la grúa torre lo lleva arriba
    if (!isCrawler(T) && !T.tower) this.wheeledL = layout(T as WheeledSpec);
    const site = opts.site;
    let world: RAPIER.World;
    if (site) {
      world = this.world = site.world;
      this.bounds = site.bounds;
      this.loads = site.loads;
      this.obstacles = site.obstacles;
      this.decor = site.decor;
      this.softs = site.softs;
      this.groundCol = site.groundCol;
      this.land = site.land;
      this.crew = site.crew;
    } else {
      this.bounds = opts.bounds ?? { x0: -SITE_HALF, x1: SITE_HALF, z0: -SITE_HALF, z1: SITE_HALF };
      this.loads = [];
      this.obstacles = [];
      this.decor = new Set();
      this.softs = [];
      this.crew = [];
      this.land = { terrain: new Terrain(), cols: new Set() };
      world = this.world = new RAPIER.World({ x: 0, y: -G, z: 0 });
      world.timestep = FIXED_DT;
      // Medido (fase 2): con 8 + 16 iteraciones internas el cable no se estira al izar ni con 200 t colgando
      // de un gancho de 0,4 t (≤ 6 cm); con los valores por defecto se estiraba metros. Costo < 0,02 ms por paso.
      world.numSolverIterations = 8;
      world.numInternalPgsIterations = 16;
      // Suelo
      this.groundCol = world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.8));
    }
    this.crew.push(this);

    this.buildStanding(pose);
    this.head = apply(pose, tipPos(T, S));

    // Gancho
    const h = this.head;
    this.hookBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(h.x, h.y - S.cable - HOOK_HALF_H, h.z)
        .setLinearDamping(0.02)
        .setAngularDamping(2.0)
        // sin giro propio (fase 10): los ramales del cable mantienen el motón derecho. Entre el cable y una carga de
        // cientos de t, el gancho liviano giraba solo hasta 12 rad/s al izar (error del solucionador)
        .lockRotations()
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
    if (opts.testLoad ?? !site) this.addLoad('Caja', 2.0, { x: 1.0, y: 0.5, z: 0.7 }, { x: Math.max(9, T.len[1] + 3), y: 0.5, z: 6 });
  }

  /** Terreno de la partida (fase 18) */
  get terrain() { return this.land.terrain; }

  /** Altura del suelo en (x, z) */
  groundY(x: number, z: number) { return this.land.terrain.height(x, z); }

  /**
   * Fase 18: pone el terreno de la partida. Cada parche es un heightfield fijo de Rapier con las mismas alturas
   * (encima del suelo plano, que sigue debajo); las colinas no tienen colisionador (nada llega hasta ellas).
   */
  addTerrain(terrain: Terrain) {
    this.land.terrain = terrain;
    for (const p of terrain.patches) {
      const r = patchRect(p);
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.heightfield(p.nz, p.nx, p.h, { x: r.x1 - r.x0, y: 1, z: r.z1 - r.z0 }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
          .setTranslation((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2).setFriction(0.8),
      );
      this.land.cols.add(c.handle);
    }
  }

  private isGround(col: RAPIER.Collider) {
    return col.handle === this.groundCol.handle || this.land.cols.has(col.handle);
  }

  /** ¿(x, z) queda fuera de la obra, o a menos de `m` de su borde? */
  outside(x: number, z: number, m = 0) {
    const b = this.bounds;
    return x < b.x0 + m || x > b.x1 - m || z < b.z0 + m || z > b.z1 - m;
  }

  addObstacle(o: Obstacle) {
    const q = axisAngle(0, 1, 0, o.rotY);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(o.half.x, o.half.y, o.half.z).setTranslation(o.pos.x, o.pos.y, o.pos.z).setRotation(q).setFriction(0.8),
    );
    this.obstacles.push(o);
  }

  /** Fase 17: cajas estáticas del decorado (centro, medios lados y giro alrededor de la vertical) */
  addDecor(solids: { x: number; y: number; z: number; hx: number; hy: number; hz: number; r: number }[]) {
    for (const s of solids) {
      const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz).setTranslation(s.x, s.y, s.z)
        .setRotation(axisAngle(0, 1, 0, s.r)).setFriction(0.8));
      this.decor.add(c.handle);
    }
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
      if (this.outside(wx, wz, 0.3)) return tw.bounds;
    }
    const soft = terrainBlocked(T, this.softs, x, z, h);
    if (soft) return soft;
    const cx = (L0 + L1) / 2, hy = (T.deckHi - CLEARANCE) / 2;
    const shape = new RAPIER.Cuboid((L1 - L0) / 2, hy, bodyHalf(T));
    const pos = { x: x + c * cx, y: CLEARANCE + hy, z: z - s * cx };
    pos.y += this.groundY(pos.x, pos.z);
    if (this.hitsSomething(pos, axisAngle(0, 1, 0, h), shape)) return tw.chassis;
    // grúa torre plegada: sobresale por delante del camión (no está en la referencia, que solo mira el chasis)
    if (T.tower) {
      const b = foldedTowerBox(T), bx = (b.x0 + b.x1) / 2;
      const tp = { x: x + c * bx, y: (b.y0 + b.y1) / 2, z: z - s * bx };
      tp.y += this.groundY(tp.x, tp.z);
      if (this.hitsSomething(tp, axisAngle(0, 1, 0, h), new RAPIER.Cuboid((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, b.hz))) return tw.foldedTower;
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
    if (trayHitsTracks(T, slR, slew)) return tw.trayTracks;
    const c = Math.cos(h), s = Math.sin(h);
    // centro de la bandeja: en el marco del chasis (piv − slR·cos slew, slR·sin slew), luego al mundo
    const lx = T.piv - slR * Math.cos(slew), lz = slR * Math.sin(slew);
    const pos = { x: x + c * lx + s * lz, y: 0.2 + (sl.h - 0.2) / 2, z: z - s * lx + c * lz };
    if (this.outside(pos.x, pos.z, Math.hypot(sl.d, sl.w) / 2)) return tw.bounds;
    pos.y += this.groundY(pos.x, pos.z);
    const shape = new RAPIER.Cuboid(sl.d / 2 + 0.2, (sl.h - 0.2) / 2, sl.w / 2 + 0.2);
    return this.hitsSomething(pos, axisAngle(0, 1, 0, h + slew), shape) ? tw.trayHit : null;
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
      const pos = { x: S.x + c * px + s * pz, y: b.cy + carrierLift(S) + S.gy, z: S.z - s * px + c * pz };
      if (this.hitsSomething(pos, rot, shape)) return tw.tailHit;
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
      if (this.outside(wx, wz)) return tw.padsSpace;
      if (this.hitsSomething({ x: wx, y: 0.55 + this.groundY(wx, wz), z: wz }, q, shape)) return tw.padsHit;
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
    if (low < JIB_MIN_H) { n += (JIB_MIN_H - low) * 10; what = tw.jibGround; }
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    // el eje x de la caja a lo largo del plumín: primero el cabeceo (z), después el rumbo (y)
    const rot = mul(axisAngle(0, 1, 0, Math.atan2(-dz, dx)), axisAngle(0, 0, 1, Math.atan2(dy, Math.hypot(dx, dz))));
    const N = 8, shape = new RAPIER.Cuboid(len / N / 2, JIB_HALF, JIB_HALF);
    for (let i = 0; i < N; i++) {
      const k = (i + 0.5) / N;
      if (this.hitsSomething({ x: a.x + dx * k, y: a.y + dy * k, z: a.z + dz * k }, rot, shape)) { n++; what = tw.jibHit; }
    }
    return { n, what };
  }

  /**
   * ¿Se puede armar el plumín en el suelo? (no está en la referencia) Los tramos van delante de la cabeza, de 1,5 m a
   * 1,5 m + largo, apoyados (1,5 m de alto y de ancho). Obstáculos y cargas sueltas. El límite de la obra no cuenta
   * (fase 9): en el nivel "Sobre la nave" la referencia lo arma hacia el oeste, por fuera de la parcela de 84 × 56 m.
   */
  jibGroundBlocked(S: CraneState, pose: Pose): string | null {
    const T = this.T, jd = T.jibDef;
    if (!jd) return null;
    const h = apply(pose, headPos(T, S)), th = S.h + S.slew;
    const fx = Math.cos(th), fz = -Math.sin(th);
    const d = 1.5 + jd.len / 2;
    const pos = { x: h.x + fx * d, y: 0.85, z: h.z + fz * d };
    return this.hitsSomething(pos, axisAngle(0, 1, 0, th), new RAPIER.Cuboid(jd.len / 2, 0.75, 0.9))
      ? tw.jibNoRoom : null;
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
      [at(g.base, g.dir, 3), P(g.top), 1.0, 5, tw.towerHit],
      [P(g.top), at(g.top, g.jd, g.jlVis), 0.6, 10, tw.towerBoomHit],
      [P(g.top), at(g.top, g.jd, -COUNTER_JIB), 0.6, 2, tw.counterJibHit],
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

  /**
   * Cámara (fase 16): distancia por el rayo o + d·t (d unitario) hasta lo primero que toca, como mucho `max`: obstáculos,
   * cargas y las grúas. El decorado (fase 17) no cuenta: rodea la obra y la cámara saltaría hacia dentro a cada momento. El gancho no cuenta (es pequeño y se mueve) ni el suelo (la cámara ya no baja de él), ni lo
   * que contiene el origen (el punto al que mira la cámara puede caer dentro de la superestructura).
   */
  rayHit(o: V3, d: V3, max: number): number | null {
    const hit = this.world.castRay(new RAPIER.Ray(o, d), max, true, undefined, undefined, undefined, undefined,
      (col) => !col.isSensor() && col.handle !== this.hookCollider.handle && col.handle !== this.groundCol.handle && !this.decor.has(col.handle) && !col.containsPoint(o));
    return hit ? hit.timeOfImpact : null;
  }

  private hitsSomething(pos: V3, rot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape) {
    let hit = false;
    const own = new Set([this.chassisBody?.handle, this.supBody?.handle, this.headBody?.handle]);
    this.world.intersectionsWithShape(pos, rot, shape, () => { hit = true; return false; }, undefined, undefined, undefined, undefined,
      (col) => {
        if (col.handle === this.hookCollider.handle || this.isGround(col) || this.decor.has(col.handle)) return false;
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

  addLoad(label: string, mass: number, half: Load['half'], pos: { x: number; y: number; z: number },
    extra: { color?: string; kind?: string; fragile?: number; lugs?: V3[]; stand?: 'x' } = {}) {
    // Sin giro alrededor del eje vertical (fase 9): como en la referencia, la carga no gira sobre sí misma, como si
    // la guiaran con cuerdas; colgada de un punto no se podría alinear (la viga de 22 m tiene < 1 m de margen).
    // Con orejetas (tándem, fase 10) gira libre: los dos ganchos fijan su orientación y, sin ese giro, mover un gancho
    // de lado no movía la columna.
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.02).setAngularDamping(0.4)
        .enabledRotations(true, !!extra.lugs, true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(0.7),
      body,
    );
    const load: Load = { label, mass, half, body, collider, home: { ...pos }, ...extra };
    if (extra.lugs) load.dyn = { p: [], w: [], step: -1, T: new Map(), hook: new Map() };
    this.loads.push(load);
    return load;
  }

  /** Tecla X: suelta la carga y devuelve todas las cargas a su posición inicial, quietas. */
  resetLoads(): string {
    for (const c of this.crew) c.release();
    for (const l of this.loads) {
      l.body.setTranslation(l.home, true);
      l.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      l.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      l.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (l.dyn) { l.dyn.p = []; l.dyn.w = []; }
    }
    return tw.loadsReset;
  }

  /** Reiniciar tras el vuelco: grúa de pie con la pose dada, gancho bajo la cabeza y cargas en su sitio. */
  reset(S: CraneState, pose: Pose) {
    this.resetLoads();
    this.untie();
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
    const pre = this.beforeStep(S, pose, slR);
    this.world.step();
    this.afterStep(S, pre);
  }

  /**
   * Tándem: un paso de física con varias grúas en el mismo mundo. Cada una prepara su parte (pose, cable, viento),
   * el mundo avanza una vez y cada una mide lo suyo. La primera grúa del mundo va primero.
   */
  static stepCrew(units: { phys: Physics; S: CraneState; pose: Pose; slR?: number }[]) {
    const pres = units.map((u) => u.phys.beforeStep(u.S, u.pose, u.slR ?? u.phys.slR));
    units[0].phys.world.step();
    units.forEach((u, i) => u.phys.afterStep(u.S, pres[i]));
  }

  /** Antes del paso del mundo: pose de los cuerpos cinemáticos, largo del cable, amortiguadores y viento. */
  private beforeStep(S: CraneState, pose: Pose, slR: number) {
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
      if (this.tied) {
        // amarrado: el gancho va con el chasis y el cable mide lo que hay de la cabeza al gancho (R/F bloqueados)
        const c = apply(pose, tiedHookCenter(this.T, hookScale(this.T), HOOK_HALF_H));
        this.hookBody.setNextKinematicTranslation(c);
        this.hookBody.setNextKinematicRotation(mul(pose.q, axisAngle(0, 1, 0, Math.PI / 2)));
        const t = { x: c.x, y: c.y + HOOK_HALF_H, z: c.z };
        S.cable = Math.hypot(t.x - this.head.x, t.y - this.head.y, t.z - this.head.z);
      }
      this.lastPose = pose;
      setRopeLength(this.cableJoint, S.cable);
    }
    this.dampSling();
    this.dampRope(S);
    // viento (fase 9): sobre la carga enganchada o, sin carga, sobre el gancho (el péndulo de la referencia)
    this.hookBody.resetForces(false);
    if (this.crew[0] === this) { this.stepNo++; for (const l of this.loads) l.body.resetForces(false); }
    const L = this.attached;
    // carga en tándem: el viento lo pone solo la primera grúa que la lleva
    if ((this.wind.x || this.wind.z) && (!L || this.crew.find((c) => c.attached === L) === this)) {
      (L ? L.body : this.hookBody).addForce({ x: this.wind.x, y: 0, z: this.wind.z }, true);
    }
    // aterrizajes y golpes de la carga enganchada: velocidad y contactos antes del paso
    return L && !this.tipped ? { v: L.body.linvel(), touch: this.touching(L), side: this.sideContact(L) } : null;
  }

  /** Después del paso del mundo: aterrizajes y golpes, cabeza de la grúa volcada y tensión del cable. */
  private afterStep(S: CraneState, pre: { v: V3; touch: boolean; side: boolean } | null) {
    const L = this.attached;
    if (L && pre && this.attached === L) {
      if (!pre.touch && -pre.v.y > 0 && this.touching(L)) this.events.push({ kind: 'land', load: L, v: -pre.v.y });
      const vh = Math.hypot(pre.v.x, pre.v.z);
      if (!pre.side && this.sideContact(L)) this.events.push({ kind: 'strike', load: L, v: vh });
    }
    if (this.tipped) this.head = this.bodyPoint(this.tipped, this.headLocal.x, this.headLocal.y, this.headLocal.z);
    else if (!this.tied) this.stopAtHead();
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
    const dev = (v: V3) => v.x * nx + v.y * ny + v.z * nz - vh / FIXED_DT - rate;
    const jh = -ROPE_DAMP * dev(this.hookBody.linvel()) * this.T.hookM;
    this.hookBody.applyImpulse({ x: jh * nx, y: jh * ny, z: jh * nz }, true);
    if (this.attachedLug >= 0) {
      // orejeta (tándem): la velocidad de la orejeta, no la del centro (la carga gira entre las dos grúas), y la masa
      // efectiva en ese punto a lo largo del cable: 1 / (1/m + (r×n)·I⁻¹·(r×n))
      const p = this.lugWorld(L, this.attachedLug), c = L.body.worldCom();
      const rn = cross3({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }, { x: nx, y: ny, z: nz });
      const iI = L.body.effectiveWorldInvInertia();
      const q = rn.x * (iI.m11 * rn.x + iI.m12 * rn.y + iI.m13 * rn.z) + rn.y * (iI.m12 * rn.x + iI.m22 * rn.y + iI.m23 * rn.z)
        + rn.z * (iI.m13 * rn.x + iI.m23 * rn.y + iI.m33 * rn.z);
      const j = -ROPE_DAMP * dev(L.body.velocityAtPoint(p)) / (1 / L.mass + q);
      L.body.applyImpulseAtPoint({ x: j * nx, y: j * ny, z: j * nz }, p, true);
      return;
    }
    const jl = -ROPE_DAMP * dev(L.body.linvel()) * L.mass;
    L.body.applyImpulse({ x: jl * nx, y: jl * ny, z: jl * nz }, true);
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
    // tándem: velocidad de la orejeta y el impulso en ella (la carga gira entre las dos grúas)
    const p = this.attachedLug >= 0 ? this.lugWorld(L, this.attachedLug) : null;
    const a = this.hookBody.linvel(), b = p ? L.body.velocityAtPoint(p) : L.body.linvel();
    const jx = (a.x - b.x) * k, jz = (a.z - b.z) * k;
    this.hookBody.applyImpulse({ x: -jx, y: 0, z: -jz }, true);
    if (p) L.body.applyImpulseAtPoint({ x: jx, y: 0, z: jz }, p, true);
    else L.body.applyImpulse({ x: jx, y: 0, z: jz }, true);
  }

  /** Doble bloqueo: el gancho no sube más de TWO_BLOCK bajo la cabeza; se baja a ese punto y pierde la velocidad hacia arriba. */
  private stopAtHead() {
    const top = this.head.y - TWO_BLOCK, t = this.hookBody.translation();
    // punta casi en el suelo (plumín recién montado, a 0,7 m): el gancho está apoyado al lado
    if (top < 2 * HOOK_HALF_H + 0.1) { this.blocked = false; return; }
    const over = t.y + HOOK_HALF_H - top;
    this.blocked = over > -0.05;
    if (over <= 0) return;
    this.hookBody.setTranslation({ x: t.x, y: t.y - over, z: t.z }, true);
    const v = this.hookBody.linvel();
    if (v.y > 0) this.hookBody.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  }

  /** ¿El gancho está contra la cabeza (doble bloqueo)? */
  twoBlocked(): boolean {
    return !this.tipped && this.blocked;
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
    if (this.tied) {
      // amarrado: el cable solo sostiene el gancho (sin medir: el gancho cinemático no tiene la aceleración del cable)
      this.tension += (this.T.hookM - this.tension) * Math.min(1, FIXED_DT / TENSION_TAU);
      this.gp = { x: this.head.x, z: this.head.z };
      this.trHook = newTrack();
      return;
    }
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
    if (L?.dyn) {
      // tándem: la eslinga tira del gancho hacia la orejeta con la parte de la carga que lleva esta grúa, y el gancho,
      // si está apoyado en la carga (la orejeta de cola va en su cara de arriba), recibe el empuje de la carga: la
      // fuerza del gancho sobre la carga, cambiada de signo (sin ella, el gancho apoyado sumaba cientos de t al cable)
      const ts = this.slingForce(), fc = L.dyn.hook.get(this);
      const p = this.lugWorld(L, this.attachedLug), hb = this.bodyPoint(this.hookBody, 0, -HOOK_HALF_H, 0);
      const ux = p.x - hb.x, uy = p.y - hb.y, uz = p.z - hb.z, ul = Math.hypot(ux, uy, uz) || 1;
      fx -= ts * ux / ul; fy -= ts * uy / ul; fz -= ts * uz / ul;
      if (fc) { fx += fc.x; fy += fc.y; fz += fc.z; }
    } else if (L) {
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
    // tándem: la parte de la carga que lleva esta grúa = lo que su cable lleva además del gancho
    if (L?.dyn) this.share += (Math.max(0, t - this.T.hookM) - this.share) * Math.min(1, FIXED_DT / TENSION_TAU);
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
    this.untie();
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

  /** ¿Es el gancho de alguna de las grúas de este mundo? */
  private isHook(col: RAPIER.Collider) {
    return this.crew.some((c) => c.hookCollider.handle === col.handle);
  }

  /** ¿La carga toca algo que no sea un gancho? */
  private touching(load: Load) {
    let touching = false;
    this.world.contactPairsWith(load.collider, (other) => {
      if (touching || this.isHook(other)) return;
      this.world.contactPair(load.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    return touching;
  }

  /**
   * ¿La carga toca de costado algo que no sea el suelo ni el gancho? (normal de contacto casi horizontal: un golpe
   * contra un obstáculo, otra carga o la grúa, no un apoyo encima).
   */
  private sideContact(load: Load) {
    let side = false;
    this.world.contactPairsWith(load.collider, (other) => {
      if (side || this.isHook(other) || this.isGround(other)) return;
      this.world.contactPair(load.collider, other, (manifold) => {
        if (manifold.numContacts() > 0 && Math.abs(manifold.normal().y) < 0.5) side = true;
      });
    });
    return side;
  }

  /**
   * Dónde quedó una carga suelta y quieta (para checkWin): envolvente en planta, altura del fondo e inclinación.
   * null si está enganchada o se mueve más de 5 cm/s.
   */
  placed(load: Load): { x: number; z: number; hx: number; hz: number; bottom: number; tilt: number } | null {
    if (this.crew.some((c) => c.attached === load)) return null;
    const v = load.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.05) return null;
    const t = load.body.translation(), q = load.body.rotation(), h = load.half;
    // columnas de la matriz de giro: ejes x, y, z del cuerpo en el mundo
    const ax = rotate(q, { x: 1, y: 0, z: 0 }), ay = rotate(q, { x: 0, y: 1, z: 0 }), az = rotate(q, { x: 0, y: 0, z: 1 });
    const ext = (k: 'x' | 'y' | 'z') => Math.abs(ax[k]) * h.x + Math.abs(ay[k]) * h.y + Math.abs(az[k]) * h.z;
    const up = load.stand === 'x' ? ax : ay;
    return { x: t.x, z: t.z, hx: ext('x'), hz: ext('z'), bottom: t.y - ext('y'), tilt: Math.acos(Math.min(1, Math.abs(up.y))) };
  }

  /** ¿La carga está apoyada en algo que no sea el gancho? */
  isResting(load: Load) {
    const v = load.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.3) return false;
    return this.touching(load);
  }

  /** Espacio: enganchar o soltar. Devuelve el mensaje para el operador (condiciones de la referencia). */
  toggleHook(): string {
    if (this.tied) { this.untie(); return tw.untied; }
    if (this.attached) {
      const load = this.attached;
      // tándem: una grúa puede soltar mientras otra sostiene la carga (la de cola, con la columna ya de pie)
      const held = this.crew.some((c) => c !== this && c.attached === load);
      if (!held && !this.isResting(load)) return tw.restFirst;
      this.release();
      return tw.released(load.label, held);
    }
    const hp = this.hookBody.translation();
    const hv = this.hookBody.linvel();
    const hookBottom = hp.y - HOOK_HALF_H;
    let lug = -1;
    const load = this.loads.find((l) => {
      if (l.lugs) {
        // orejetas: una libre al alcance del gancho (cada una lleva una sola grúa)
        lug = l.lugs.findIndex((_, i) => {
          if (this.crew.some((c) => c !== this && c.attached === l && c.attachedLug === i)) return false;
          // el fondo del gancho a menos de 1,8 m de la orejeta, sin estar por debajo (la de cabeza va en la cara
          // del extremo: el gancho cuelga al lado)
          const w = this.lugWorld(l, i);
          return Math.hypot(w.x - hp.x, w.y - hookBottom, w.z - hp.z) < 1.8 && hookBottom > w.y - 0.3;
        });
        return lug >= 0;
      }
      if (this.crew.some((c) => c !== this && c.attached === l)) return false; // sin orejetas, una sola grúa
      const top = this.bodyPoint(l.body, 0, l.half.y, 0);
      const gap = hookBottom - top.y; // gancho apoyado = 0; colgando a la distancia de eslinga ≈ 0,5
      return Math.hypot(top.x - hp.x, top.z - hp.z) < 1.0 && gap > -0.1 && gap < 1.1;
    });
    if (!load) {
      const tie = this.tryTie();
      if (tie) return tie;
      return canTie(this.T) && !this.tipped
        ? tw.lowerTie
        : tw.lower;
    }
    if (Math.hypot(hv.x, hv.z) > 0.6) return tw.steady;
    // Eslinga: rope joint del fondo del gancho al centro de la cara superior de la carga (o a la orejeta).
    const anchor = load.lugs ? load.lugs[lug] : { x: 0, y: load.half.y, z: 0 };
    // orejeta: la eslinga se ajusta a la distancia (la de cabeza está al costado del gancho), sin tirón al enganchar
    const hb = this.bodyPoint(this.hookBody, 0, -HOOK_HALF_H, 0), w = this.bodyPoint(load.body, anchor.x, anchor.y, anchor.z);
    this.slingLen = Math.max(SLING - HOOK_HALF_H, load.lugs ? Math.hypot(w.x - hb.x, w.y - hb.y, w.z - hb.z) : 0);
    this.slingJoint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(this.slingLen, { x: 0, y: -HOOK_HALF_H, z: 0 }, anchor),
      this.hookBody, load.body, true,
    );
    this.attached = load;
    this.attachedLug = load.lugs ? lug : -1;
    this.trLoad = newTrack();
    load.body.wakeUp();
    return tw.hooked(load.label, load.lugs ? lug : null, load.mass);
  }

  /**
   * Amarra el gancho al frente del chasis si su fondo está al alcance del gancho de remolque delantero (tieReach;
   * posición de transporte, no está en la referencia). null si no está al alcance.
   */
  private tryTie(): string | null {
    const pose = this.lastPose;
    if (!canTie(this.T) || this.tipped || !pose) return null;
    const lug = apply(pose, tieLug(this.T)), hb = this.bodyPoint(this.hookBody, 0, -HOOK_HALF_H, 0);
    if (!tieReach(lug, hb)) return null;
    const hv = this.hookBody.linvel();
    if (Math.hypot(hv.x, hv.z) > 0.6) return tw.steadyTie;
    this.hookBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.hookBody.setTranslation(apply(pose, tiedHookCenter(this.T, hookScale(this.T), HOOK_HALF_H)), true);
    this.hookBody.setRotation(mul(pose.q, axisAngle(0, 1, 0, Math.PI / 2)), true);
    this.tied = true;
    return tw.tiedUp;
  }

  /** Suelta el amarre del gancho, si lo hay: vuelve a colgar del cable, quieto. */
  untie() {
    if (!this.tied) return;
    this.tied = false;
    this.hookBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.hookBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.hookBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.trHook = newTrack();
  }

  /** Argolla del amarre en el mundo (para dibujar la eslinga), o null si el gancho no está amarrado */
  tieWorld(): V3 | null {
    return this.tied && this.lastPose ? apply(this.lastPose, tieLug(this.T)) : null;
  }

  /** Suelta la eslinga, si hay (sin condiciones). */
  release() {
    if (this.slingJoint) this.world.removeImpulseJoint(this.slingJoint, true);
    this.slingJoint = null;
    this.attached = null;
    this.attachedLug = -1;
    this.share = 0;
  }

  /** Orejeta `i` de la carga, en el mundo */
  lugWorld(l: Load, i: number): V3 {
    const p = l.lugs![i];
    return this.bodyPoint(l.body, p.x, p.y, p.z);
  }

  /**
   * Fuerza en la eslinga de esta grúa con una carga con orejetas (t·m/s²): reparto por la dinámica de la carga
   * (tandem.ts), calculado una vez por paso para todas las grúas que la llevan.
   */
  private slingForce(): number {
    const L = this.attached!, d = L.dyn!, step = this.crew[0].stepNo;
    if (d.step !== step) {
      d.step = step;
      d.T = this.solveSlings(L);
    }
    return d.T.get(this) ?? 0;
  }

  /** Reparto de la carga entre las eslingas de todas las grúas enganchadas a `L` (ver tandem.ts). */
  private solveSlings(L: Load): Map<Physics, number> {
    const d = L.dyn!, b = L.body, h = ACC_STEPS * FIXED_DT;
    const c = b.worldCom(), w = b.angvel();
    d.p.push({ x: c.x, y: c.y, z: c.z });
    d.w.push({ x: w.x, y: w.y, z: w.z });
    if (d.p.length > 2 * ACC_STEPS + 1) { d.p.shift(); d.w.shift(); }
    let a = { x: 0, y: 0, z: 0 }, al = { x: 0, y: 0, z: 0 };
    if (d.p.length === 2 * ACC_STEPS + 1) {
      const p0 = d.p[0], p1 = d.p[ACC_STEPS], p2 = d.p[2 * ACC_STEPS];
      a = { x: (p2.x - 2 * p1.x + p0.x) / (h * h), y: (p2.y - 2 * p1.y + p0.y) / (h * h), z: (p2.z - 2 * p1.z + p0.z) / (h * h) };
      const w0 = d.w[ACC_STEPS], w2 = d.w[2 * ACC_STEPS];
      al = { x: (w2.x - w0.x) / h, y: (w2.y - w0.y) / h, z: (w2.z - w0.z) / h };
    }
    // I·α + ω × I·ω, con la inercia efectiva en el mundo
    const I = b.effectiveAngularInertia();
    const mulI = (v: V3) => ({ x: I.m11 * v.x + I.m12 * v.y + I.m13 * v.z, y: I.m12 * v.x + I.m22 * v.y + I.m23 * v.z, z: I.m13 * v.x + I.m23 * v.y + I.m33 * v.z });
    const Ia = mulI(al), gyro = cross3(w, mulI(w));
    // fuerzas normales de los contactos sobre la carga (impulso / paso); las de cada gancho, además, aparte
    const contacts: { p: V3; f: V3 }[] = [];
    d.hook = new Map();
    this.world.contactPairsWith(L.collider, (other) => {
      const hookOf = this.crew.find((k) => k.hookCollider.handle === other.handle);
      this.world.contactPair(L.collider, other, (m, flipped) => {
        const n = m.normal(), sg = (flipped ? 1 : -1) / FIXED_DT;
        for (let i = 0; i < m.numSolverContacts(); i++) {
          const imp = m.contactImpulse(i), p = m.solverContactPoint(i);
          if (!p || !imp) continue;
          const f = { x: n.x * imp * sg, y: n.y * imp * sg, z: n.z * imp * sg };
          contacts.push({ p: { x: p.x, y: p.y, z: p.z }, f });
          if (hookOf) {
            const h = d.hook.get(hookOf) ?? { x: 0, y: 0, z: 0 };
            d.hook.set(hookOf, { x: h.x + f.x, y: h.y + f.y, z: h.z + f.z });
          }
        }
      });
    });
    const crew = this.crew.filter((k) => k.attached === L && k.attachedLug >= 0);
    const slings: SlingObs[] = crew.map((k) => {
      const p = k.lugWorld(L, k.attachedLug), hb = k.bodyPoint(k.hookBody, 0, -HOOK_HALF_H, 0);
      const ux = hb.x - p.x, uy = hb.y - p.y, uz = hb.z - p.z, ul = Math.hypot(ux, uy, uz) || 1;
      // floja si le sobran más de 5 cm (tensa, la junta la deja a su largo con 1–2 cm de diferencia)
      return { p, u: { x: ux / ul, y: uy / ul, z: uz / ul }, slack: ul < k.slingLen - 0.05 };
    });
    const T = slingTensions({
      m: L.mass, c: { x: c.x, y: c.y, z: c.z }, a, contacts, size: Math.max(L.half.x, L.half.y, L.half.z), yawFree: true,
      tau: { x: Ia.x + gyro.x, y: Ia.y + gyro.y, z: Ia.z + gyro.z },
    }, slings);
    return new Map(crew.map((k, i) => [k, T[i]]));
  }

  /**
   * Instantánea (fase 15): el mundo de Rapier entero (lo comparten las grúas del tándem) y lo que cada grúa guarda en
   * JavaScript (cuerpos por su handle, carga enganchada, filtros e historia de la tensión, amortiguadores). Llamar en
   * la grúa que creó el mundo, entre dos pasos.
   */
  snapshot(): PhysSnap {
    const crew = this.crew;
    return {
      world: this.world.takeSnapshot(),
      crew: crew.map((c) => c.exportState()),
      loads: this.loads.map((l) => ({
        body: l.body.handle, collider: l.collider.handle,
        dyn: l.dyn ? {
          p: l.dyn.p.map((v) => ({ ...v })), w: l.dyn.w.map((v) => ({ ...v })), step: l.dyn.step,
          T: [...l.dyn.T].map(([k, v]) => [crew.indexOf(k), v] as [number, number]),
          hook: [...l.dyn.hook].map(([k, v]) => [crew.indexOf(k), { ...v }] as [number, V3]),
        } : null,
      })),
      ground: this.groundCol.handle,
    };
  }

  /**
   * Vuelve a una instantánea de `snapshot()`: crea el mundo nuevo, suelta el viejo y vuelve a enlazar los cuerpos de
   * todas las grúas y las cargas. Las cargas y grúas tienen que ser las mismas (misma partida).
   */
  restore(s: PhysSnap) {
    const crew = this.crew;
    if (s.crew.length !== crew.length || s.loads.length !== this.loads.length) throw new Error('instantánea de otra partida');
    const old = this.world;
    const w = RAPIER.World.restoreSnapshot(s.world);
    w.timestep = FIXED_DT;
    w.numSolverIterations = 8;
    w.numInternalPgsIterations = 16;
    for (const c of crew) c.world = w;
    old.free();
    const ground = w.getCollider(s.ground);
    this.loads.forEach((l, i) => {
      const x = s.loads[i];
      l.body = w.getRigidBody(x.body);
      l.collider = w.getCollider(x.collider);
      if (x.dyn && l.dyn) {
        l.dyn.p = x.dyn.p.map((v) => ({ ...v }));
        l.dyn.w = x.dyn.w.map((v) => ({ ...v }));
        l.dyn.step = x.dyn.step;
        l.dyn.T = new Map(x.dyn.T.map(([k, v]) => [crew[k], v]));
        l.dyn.hook = new Map(x.dyn.hook.map(([k, v]) => [crew[k], { ...v }]));
      }
    });
    crew.forEach((c, i) => { c.groundCol = ground; c.importState(s.crew[i]); });
  }

  private exportState(): CrewState {
    const h = (b: { handle: number } | null) => (b ? b.handle : -1);
    return {
      hook: this.hookBody.handle, hookCol: this.hookCollider.handle,
      chassis: this.tipped ? -1 : this.chassisBody.handle, sup: this.tipped ? -1 : this.supBody.handle,
      headB: this.tipped ? -1 : this.headBody.handle, tray: h(this.trayCol), towers: this.towerCols.map((c) => c.handle),
      cable: this.cableJoint.handle, sling: h(this.slingJoint), tipped: h(this.tipped),
      attached: this.attached ? this.loads.indexOf(this.attached) : -1, attachedLug: this.attachedLug,
      stepNo: this.stepNo, share: this.share, blocked: this.blocked, slingLen: this.slingLen, tied: this.tied,
      lastPose: this.lastPose ? clonePose(this.lastPose) : null, tension: this.tension, gp: { ...this.gp },
      slR: this.slR, slew: this.slew, trayAt: this.trayAt, towerAt: this.towerAt, headLocal: { ...this.headLocal },
      head: { ...this.head }, trHook: cloneTrack(this.trHook), headPrev: this.headPrev ? { ...this.headPrev } : null,
      cablePrev: this.cablePrev, trLoad: cloneTrack(this.trLoad), wind: { ...this.wind },
    };
  }

  private importState(s: CrewState) {
    const w = this.world;
    this.hookBody = w.getRigidBody(s.hook);
    this.hookCollider = w.getCollider(s.hookCol);
    if (s.chassis >= 0) this.chassisBody = w.getRigidBody(s.chassis);
    if (s.sup >= 0) this.supBody = w.getRigidBody(s.sup);
    if (s.headB >= 0) this.headBody = w.getRigidBody(s.headB);
    this.trayCol = s.tray >= 0 ? w.getCollider(s.tray) : null;
    this.towerCols = s.towers.map((k) => w.getCollider(k));
    this.cableJoint = w.getImpulseJoint(s.cable);
    this.slingJoint = s.sling >= 0 ? w.getImpulseJoint(s.sling) : null;
    this.tipped = s.tipped >= 0 ? w.getRigidBody(s.tipped) : null;
    this.attached = s.attached >= 0 ? this.loads[s.attached] : null;
    this.attachedLug = s.attachedLug;
    this.stepNo = s.stepNo;
    this.share = s.share;
    this.blocked = s.blocked;
    this.slingLen = s.slingLen;
    this.tied = s.tied;
    this.lastPose = s.lastPose ? clonePose(s.lastPose) : null;
    this.tension = s.tension;
    this.gp = { ...s.gp };
    this.slR = s.slR;
    this.slew = s.slew;
    this.trayAt = s.trayAt;
    this.towerAt = s.towerAt;
    this.headLocal = { ...s.headLocal };
    this.head = { ...s.head };
    this.trHook = cloneTrack(s.trHook);
    this.headPrev = s.headPrev ? { ...s.headPrev } : null;
    this.cablePrev = s.cablePrev;
    this.trLoad = cloneTrack(s.trLoad);
    this.wind = { ...s.wind };
    this.events.length = 0;
  }

  /**
   * ¿El gancho o su carga están apoyados en algo? (dibujo del cable flojo, fase 15 C). Colgando, el cable va tenso
   * aunque el gancho quede unos cm por debajo del largo (al bajar, el solucionador lo deja atrás 2–20 cm).
   */
  hookSupported(): boolean {
    if (this.tied || this.tipped) return false;
    if (this.attached && this.touching(this.attached)) return true;
    let hit = false;
    this.world.contactPairsWith(this.hookCollider, (other) => {
      if (hit || (this.attached && other.handle === this.attached.collider.handle && !this.touching(this.attached))) return;
      this.world.contactPair(this.hookCollider, other, (m) => { if (m.numContacts() > 0) hit = true; });
    });
    return hit;
  }

  /** ¿La carga enganchada está apoyada en algo (no en un gancho)? (dibujo de los ramales flojos) */
  loadSupported(): boolean {
    return !!this.attached && this.touching(this.attached);
  }

  /** Largo de la eslinga enganchada (fondo del gancho al punto de la carga; dibujo de los ramales) */
  get slingLength() { return this.slingLen; }

  /** Parte de la carga que lleva esta grúa (t, sin el gancho) si es una carga con orejetas; si no, null */
  slingShare(): number | null {
    return this.attached?.dyn ? this.share : null;
  }
}

/** Altura mínima del eje del plumín (la punta lleva poleas de 0,45 m) */
const JIB_MIN_H = 0.5;
/** Medio ancho de la caja de choques del plumín (celosía de 1,5 m con margen, como boomHit) */
const JIB_HALF = 0.75;

const xyz = (p: V3): [number, number, number] => [p.x, p.y, p.z];
const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Seguimiento de posición para derivar velocidad y aceleración */
interface Track { hist: V3[] }
const newTrack = (): Track => ({ hist: [] });
const cloneTrack = (k: Track): Track => ({ hist: k.hist.map((v) => ({ ...v })) });
const clonePose = (p: Pose): Pose => ({ t: { ...p.t }, q: { ...p.q } });

/** Lo que una grúa guarda en JavaScript, para la instantánea (los cuerpos y juntas, por su handle) */
interface CrewState {
  hook: number; hookCol: number; chassis: number; sup: number; headB: number; tray: number; towers: number[];
  cable: number; sling: number; tipped: number; attached: number; attachedLug: number; stepNo: number; share: number;
  blocked: boolean; slingLen: number; tied: boolean; lastPose: Pose | null; tension: number; gp: { x: number; z: number };
  slR: number; slew: number; trayAt: number; towerAt: number; headLocal: V3; head: V3; trHook: Track; headPrev: V3 | null;
  cablePrev: number; trLoad: Track; wind: { x: number; z: number };
}

/** Instantánea de la física (fase 15): el mundo de Rapier serializado y el estado de cada grúa y carga */
export interface PhysSnap {
  world: Uint8Array;
  crew: CrewState[];
  loads: { body: number; collider: number; dyn: { p: V3[]; w: V3[]; step: number; T: [number, number][]; hook: [number, V3][] } | null }[];
  ground: number;
}
/** Paso de la segunda diferencia de la tensión (6 pasos = 0,1 s) */
const ACC_STEPS = 6;
/** Constante de tiempo del filtro de la tensión (s) */
const TENSION_TAU = 0.3;
/** Fracción de la velocidad sobrante a lo largo del cable que se quita en cada paso (dampRope) */
const ROPE_DAMP = 0.3;

/**
 * Doble bloqueo (fase 10): el motón no sube a menos de TWO_BLOCK bajo la cabeza (choca con las poleas). El cable de
 * Rapier es solo una distancia máxima: en el tándem, al subir la columna con la grúa de cola enganchada, su gancho
 * pasaba a través de la cabeza (una distancia mínima de 1 m tampoco basta: el gancho la rodeaba). CABLE_MIN es 1,2 m.
 */
export const TWO_BLOCK = 1.0;

function setRopeLength(joint: RAPIER.ImpulseJoint, length: number) {
  const raw = (joint as unknown as { rawSet: { jointSetLimits(h: number, axis: number, min: number, max: number): void } }).rawSet;
  raw.jointSetLimits(joint.handle, RAPIER.JointAxis.LinX, 0, length);
}
