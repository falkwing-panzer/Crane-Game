import RAPIER from '@dimforge/rapier3d-compat';
import { SLING, type CraneSpec } from '../crane/cranes';
import { headPos, type CraneState } from '../crane/kinematics';

// Unidades de masa: toneladas (igual que la referencia). Gravedad 9,81 m/s².
// La grúa NO es un cuerpo dinámico: su cinemática viene del modelo analítico; aquí solo
// se reflejan su chasis (fijo) y su superestructura (cinemática) para que la carga choque con ellos.

export const FIXED_DT = 1 / 60;

/** Medio alto del cuerpo del gancho: el cable se ancla arriba, la eslinga abajo. */
export const HOOK_HALF_H = 0.5;

export interface Load {
  label: string;
  mass: number;
  half: { x: number; y: number; z: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class Physics {
  readonly world: RAPIER.World;
  readonly hookBody: RAPIER.RigidBody;
  readonly hookCollider: RAPIER.Collider;
  readonly loads: Load[] = [];
  /** Carga enganchada, si la hay */
  attached: Load | null = null;
  private headBody: RAPIER.RigidBody;
  private supBody: RAPIER.RigidBody;
  private cableJoint: RAPIER.ImpulseJoint;
  private slingJoint: RAPIER.ImpulseJoint | null = null;

  constructor(private T: CraneSpec, S: CraneState) {
    const world = (this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
    world.timestep = FIXED_DT;
    world.numSolverIterations = 8;

    // Suelo
    world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.8));

    // Chasis: caja fija con el contorno del portador (ruedas incluidas)
    const [L0, L1] = T.len;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((L1 - L0) / 2, T.deckHi / 2, T.half).setTranslation((L0 + L1) / 2, T.deckHi / 2, 0),
    );

    // Superestructura: cuerpo cinemático que gira con la grúa (plataforma + contrapeso)
    this.supBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(T.piv, 0, 0));
    const yd = T.deckHi;
    const px0 = T.xCw - T.cwLen / 2, px1 = 1.3;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((px1 - px0) / 2, 0.85, 1.15).setTranslation((px0 + px1) / 2, yd + 1.05, 0),
      this.supBody,
    );

    // Cabeza de pluma: cuerpo cinemático sin colisionador, solo ancla del cable
    const h = headPos(T, S);
    this.headBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(h.x, h.y, h.z));

    // Gancho
    this.hookBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(h.x, h.y - S.cable - HOOK_HALF_H, h.z)
        .setLinearDamping(0.02)
        .setAngularDamping(2.0)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.hookCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.28, HOOK_HALF_H, 0.22).setMass(T.hookM).setFriction(0.6),
      this.hookBody,
    );

    // Cable: rope joint (distancia máxima, puede aflojarse) cabeza → parte superior del gancho
    this.cableJoint = world.createImpulseJoint(
      RAPIER.JointData.rope(S.cable, { x: 0, y: 0, z: 0 }, { x: 0, y: HOOK_HALF_H, z: 0 }),
      this.headBody, this.hookBody, true,
    );

    // Carga de prueba: caja de 2 t delante a la derecha de la grúa
    this.addLoad('Caja', 2.0, { x: 1.0, y: 0.5, z: 0.7 }, { x: 9, y: 0.5, z: 6 });
  }

  addLoad(label: string, mass: number, half: Load['half'], pos: { x: number; y: number; z: number }) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.02).setAngularDamping(0.4),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(0.7),
      body,
    );
    const load = { label, mass, half, body, collider };
    this.loads.push(load);
    return load;
  }

  step(S: CraneState) {
    const h = headPos(this.T, S);
    this.headBody.setNextKinematicTranslation(h);
    const half = S.slew / 2;
    this.supBody.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    // El rope joint de Rapier no expone setMaxDistance en JS: su largo es el límite del eje LinX.
    setRopeLength(this.cableJoint, S.cable);
    this.world.step();
  }

  /** Parte superior del gancho en el mundo (donde llega el cable). */
  hookTop() {
    return this.bodyPoint(this.hookBody, 0, HOOK_HALF_H, 0);
  }

  bodyPoint(b: RAPIER.RigidBody, x: number, y: number, z: number) {
    const t = b.translation(), q = b.rotation();
    // rotar (x,y,z) por el cuaternión q
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    return {
      x: t.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      y: t.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      z: t.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
  }

  /** ¿La carga está apoyada en algo que no sea el gancho? */
  isResting(load: Load) {
    const v = load.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.3) return false;
    let touching = false;
    this.world.contactPairsWith(load.collider, (other) => {
      if (touching || other.handle === this.hookCollider.handle) return;
      this.world.contactPair(load.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    return touching;
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
    load.body.wakeUp();
    return `Enganchada ${load.label} · ${load.mass.toFixed(1).replace('.', ',')} t`;
  }
}

function setRopeLength(joint: RAPIER.ImpulseJoint, length: number) {
  const raw = (joint as unknown as { rawSet: { jointSetLimits(h: number, axis: number, min: number, max: number): void } }).rawSet;
  raw.jointSetLimits(joint.handle, RAPIER.JointAxis.LinX, 0, length);
}
