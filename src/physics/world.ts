import RAPIER from '@dimforge/rapier3d-compat';
import { SLING, bodyHalf, type CraneSpec } from '../crane/cranes';
import { hookScale } from '../render/models/layout';
import { carrierLift, headPos, type CraneState } from '../crane/kinematics';
import { craneMasses, supportRect, type CraneConfig, type SupportMode } from '../crane/stability';
import { apply, axisAngle, mul, rotate, type Pose, type V3 } from '../crane/pose';
import { padsOnSoft, terrainBlocked, type SoftZone } from '../crane/terrain';

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

  private chassisBody!: RAPIER.RigidBody;
  private supBody!: RAPIER.RigidBody;
  private headBody!: RAPIER.RigidBody;
  private cableJoint!: RAPIER.ImpulseJoint;
  private slingJoint: RAPIER.ImpulseJoint | null = null;
  /** Cabeza de pluma en el marco del cuerpo volcado */
  private headLocal: V3 = { x: 0, y: 0, z: 0 };
  private head: V3 = { x: 0, y: 0, z: 0 };
  private trHook = newTrack();
  private trLoad = newTrack();

  constructor(private T: CraneSpec, S: CraneState, pose: Pose) {
    const world = (this.world = new RAPIER.World({ x: 0, y: -G, z: 0 }));
    world.timestep = FIXED_DT;
    // Medido (fase 2): con 8 + 16 iteraciones internas el cable no se estira al izar ni con 200 t colgando
    // de un gancho de 0,4 t (≤ 6 cm); con los valores por defecto se estiraba metros. Costo < 0,02 ms por paso.
    world.numSolverIterations = 8;
    world.numInternalPgsIterations = 16;

    // Suelo
    world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.8));

    this.buildStanding(pose);
    this.head = apply(pose, headPos(T, S));

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

    // Carga de prueba: caja de 2 t delante a la derecha de la grúa
    this.addLoad('Caja', 2.0, { x: 1.0, y: 0.5, z: 0.7 }, { x: 9, y: 0.5, z: 6 });
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
    return this.hitsSomething(pos, axisAngle(0, 1, 0, h), shape) ? 'El chasis toca un obstáculo' : null;
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

  private hitsSomething(pos: V3, rot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape) {
    let hit = false;
    const own = new Set([this.chassisBody?.handle, this.supBody?.handle, this.headBody?.handle]);
    this.world.intersectionsWithShape(pos, rot, shape, () => { hit = true; return false; }, undefined, undefined, undefined, undefined,
      (col) => {
        if (col.handle === this.hookCollider.handle) return false;
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
    const [hx, cx, cy] = this.supBox();
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.85, 1.15).setTranslation(cx, cy, 0), this.supBody);
    this.headBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  }

  /** Caja de la plataforma giratoria + contrapeso en el marco de la superestructura: [medio largo, x, y]. */
  private supBox(): [number, number, number] {
    const T = this.T, px0 = T.xCw - T.cwLen / 2, px1 = 1.3;
    return [(px1 - px0) / 2, (px0 + px1) / 2, T.deckHi + 1.05];
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
    this.buildStanding(pose);
    this.head = apply(pose, headPos(this.T, S));
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
  step(S: CraneState, pose: Pose) {
    if (!this.tipped) {
      this.chassisBody.setNextKinematicTranslation(pose.t);
      this.chassisBody.setNextKinematicRotation(pose.q);
      this.supBody.setNextKinematicTranslation(apply(pose, { x: this.T.piv, y: 0, z: 0 }));
      this.supBody.setNextKinematicRotation(mul(pose.q, axisAngle(0, 1, 0, S.slew)));
      this.head = apply(pose, headPos(this.T, S));
      this.headBody.setNextKinematicTranslation(this.head);
      // El rope joint de Rapier no expone setMaxDistance en JS: su largo es el límite del eje LinX.
      setRopeLength(this.cableJoint, S.cable);
    }
    this.dampSling();
    this.world.step();
    if (this.tipped) this.head = this.bodyPoint(this.tipped, this.headLocal.x, this.headLocal.y, this.headLocal.z);
    this.measureTension(S);
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
   */
  private measureTension(S: CraneState) {
    const dt = FIXED_DT;
    const acc = (k: Track, p: V3) => {
      // hacen falta dos pasos previos para tener velocidad y aceleración
      const v = k.n > 0 ? { x: (p.x - k.p.x) / dt, y: (p.y - k.p.y) / dt, z: (p.z - k.p.z) / dt } : { x: 0, y: 0, z: 0 };
      const a = k.n > 1 ? { x: (v.x - k.v.x) / dt, y: (v.y - k.v.y) / dt, z: (v.z - k.v.z) / dt } : { x: 0, y: 0, z: 0 };
      k.n++;
      k.p = { x: p.x, y: p.y, z: p.z }; k.v = v;
      return a;
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
    if (dist >= S.cable - 0.02) t = Math.max(0, -(fx * dx + fy * dy + fz * dz) / dist) / G; // cable tenso
    // Filtro de primer orden (~0,1 s): quita el ruido de derivar velocidades sin perder un tirón.
    this.tension += (t - this.tension) * Math.min(1, dt / 0.1);
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
    const hs = [(T.deckLo + T.deckHi) / 2, T.deckHi + 1.0, T.deckHi + 1.05, T.pivH + (S.Lb / 2) * Math.sin(S.ang)];
    const pts = craneMasses(T, C, S.Lb, S.ang, S.slew)
      .filter((p) => !p[3])
      .map(([m, x, y], i) => ({ m, x, y: hs[i] ?? T.pivH, z: -y })); // marco del chasis: la elevación va en la pose
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
    const [hx, cx, cy] = this.supBox();
    const sp = at(cx, cy);
    cub(hx, 0.85, 1.15, sp.x, sp.y, sp.z, qs);
    const c = Math.cos(S.ang), s = Math.sin(S.ang);
    const bp = at(T.foot + (S.Lb / 2) * c, T.pivH + (S.Lb / 2) * s);
    cub(S.Lb / 2, T.boom.w * 0.6, T.boom.w / 2, bp.x, bp.y, bp.z, mul(qs, axisAngle(0, 0, 1, S.ang)));

    // Velocidad inicial: giro phiV alrededor de la arista (v = ω × (CDG − arista))
    const w = { x: axis.x * S.phiV, y: axis.y * S.phiV, z: axis.z * S.phiV };
    const cw = apply(pose, com);
    const rx = cw.x - edgeP.x, ry = cw.y - edgeP.y, rz = cw.z - edgeP.z;
    body.setAngvel(w, true);
    body.setLinvel({ x: w.y * rz - w.z * ry, y: w.z * rx - w.x * rz, z: w.x * ry - w.y * rx }, true);

    this.tipped = body;
    const hp = headPos(T, S);
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

const xyz = (p: V3): [number, number, number] => [p.x, p.y, p.z];

/** Seguimiento de posición para derivar velocidad y aceleración */
interface Track { p: V3; v: V3; n: number }
const newTrack = (): Track => ({ p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, n: 0 });

function setRopeLength(joint: RAPIER.ImpulseJoint, length: number) {
  const raw = (joint as unknown as { rawSet: { jointSetLimits(h: number, axis: number, min: number, max: number): void } }).rawSet;
  raw.jointSetLimits(joint.handle, RAPIER.JointAxis.LinX, 0, length);
}
