// Señalero (fase 23): qué señal da según dónde está el gancho (o la carga) y adónde tiene que ir. Sin three.js ni DOM.
// Solo interfaz: no entra en la simulación (no se graba). Orden de un señalero de verdad: primero altura para pasar
// por encima de lo que haya en medio, después giro, después radio, después bajar (despacio al final) y parar.
//
// Señales (elegidas por el juego, a revisar con Jesús; basadas en las señales de mano habituales en obra):
//   sube          brazo derecho arriba, el índice en círculos
//   baja          brazo derecho abajo, el índice en círculos
//   despacio      la mano izquierda quieta delante de la que da la orden
//   giraIzq/Der   brazo extendido hacia el lado al que tiene que ir la pluma
//   subePluma     brazo extendido, pulgar arriba
//   bajaPluma     brazo extendido, pulgar abajo
//   sacaPluma/metePluma (telescopio) los dos puños delante, los pulgares hacia fuera / hacia dentro
//   carroFuera/Dentro (grúa torre) los dos brazos delante, las manos se separan / se juntan
//   para          brazo extendido a un lado, palma abajo, moviéndolo de un lado a otro
//   espera        los dos brazos extendidos (parada: hay alguien debajo)
//   engancha      las manos juntas arriba (ya se puede enganchar)
//   suelta        el brazo abierto hacia abajo, la palma hacia arriba (ya se puede soltar)

import { apply } from '../crane/pose';
import { towerPivot } from '../crane/tower';
import { inZone, levelBoxes } from '../levels/setup';
import { workerMargin, type SiteWorker } from '../levels/people';
import { HOOK_HALF_H } from '../physics/world';
import { teleLimit } from '../crane/assembly';
import { lmiStatic } from '../crane/stability';
import { CABLE_MIN } from '../crane/kinematics';
import { supportMode } from '../crane/ops';
import type { Session } from './session';

export type Signal = 'sube' | 'baja' | 'despacio' | 'giraIzq' | 'giraDer' | 'subePluma' | 'bajaPluma' | 'sacaPluma' | 'metePluma' | 'carroFuera' | 'carroDentro'
  | 'para' | 'espera' | 'engancha' | 'suelta';

export interface SignalIn {
  /** Eje de giro de la superestructura (planta) */
  pivot: { x: number; z: number };
  /**
   * Punto que se guía: en planta, la punta de la que cuelga el cable (donde quedará el gancho cuando se calme: si se
   * guiara el gancho, su balanceo haría que el señalero corrigiera de un lado a otro); en altura, el fondo de la carga
   * colgada o del gancho
   */
  at: { x: number; z: number; bottom: number };
  /** Adónde: la carga que hay que enganchar (y = lo alto de la carga) o la zona (y = su altura de apoyo) */
  goal: { x: number; z: number; y: number };
  /** Altura a la que hay que pasar (lo más alto entre medias + margen) */
  clearH: number;
  /** Se lleva la carga (colgando o apoyada) / está apoyada / la carga está dentro de la zona */
  carrying: boolean; resting: boolean; placed: boolean;
  /** Hay alguien debajo (o va a haber): parada */
  person: boolean;
  /** Grúa torre (el radio se cambia con el carro) */
  tower: boolean;
  /** Altura de la punta (de donde cuelga el cable) y queda telescopio por sacar (grúas telescópicas) */
  tipY: number;
  teleRoom: boolean;
  /** Velocidad horizontal del punto guiado (m/s) y distancia en planta de la carga (o el gancho) a la punta (m):
   *  balanceándose, primero se espera (en los extremos del balanceo la velocidad es casi 0, pero la distancia no) */
  speed: number; offset: number;
  /** Cuánto más se puede subir con el cable (m): cable − mínimo */
  hoistRoom: number;
  /** Se puede subir más la pluma (ángulo por debajo del máximo) */
  luffRoom: boolean;
}

/** Tolerancias (m): de giro (en el arco), de radio y de altura al bajar; balanceo (m/s) a partir del cual se espera */
export const SIG_TOL = { arc: 1, radial: 1, pick: 0.4, near: 3, touch: 0.3, swing: 0.7, swingNear: 0.3 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function signalFor(s: SignalIn): Signal {
  if (s.person && s.carrying && !s.resting) return 'espera';
  if (s.carrying && s.resting && s.placed) return 'suelta';
  const px = s.at.x - s.pivot.x, pz = s.at.z - s.pivot.z, gx = s.goal.x - s.pivot.x, gz = s.goal.z - s.pivot.z;
  const rA = Math.hypot(px, pz), rG = Math.hypot(gx, gz);
  const dA = wrap(Math.atan2(-gz, gx) - Math.atan2(-pz, px));
  const far = Math.hypot(s.goal.x - s.at.x, s.goal.z - s.at.z) > SIG_TOL.radial * 1.5;
  // con la carga apoyada fuera de la zona, primero hay que levantarla
  if (s.carrying && s.resting && !s.placed) return 'sube';
  if (far && s.at.bottom < s.clearH) {
    // con el cable no basta para pasar por encima: hay que ganar altura con la pluma
    // (subir la pluma gana altura, acerca la carga y baja el LMI; si ya está arriba, sacar pluma)
    if (s.at.bottom + s.hoistRoom - 0.5 < s.clearH && !s.tower) return s.luffRoom ? 'subePluma' : 'sacaPluma';
    return 'sube';
  }
  // para enganchar hace falta más precisión que para dejar la carga en su zona
  const tol = s.carrying ? 0.6 : SIG_TOL.pick;
  if (Math.abs(dA) * Math.max(rA, rG) > tol) return dA > 0 ? 'giraIzq' : 'giraDer';
  const dR = rG - rA;
  if (Math.abs(dR) > tol) {
    if (s.tower) return dR > 0 ? 'carroFuera' : 'carroDentro';
    // más lejos: se saca pluma (gana radio sin perder altura) mientras quede; más cerca: se sube la pluma
    // (si sobra altura, bajar la pluma gana radio más deprisa)
    if (dR > 0) return s.teleRoom && s.at.bottom - s.clearH < 3 ? 'sacaPluma' : 'bajaPluma';
    return 'subePluma';
  }
  const h = s.at.bottom - s.goal.y;
  // encima del destino: antes de bajar, que se calme el balanceo
  if (!s.resting && (s.speed > (h > SIG_TOL.near ? SIG_TOL.swing : SIG_TOL.swingNear) || (h <= SIG_TOL.near && s.offset > 0.4))) return 'para';
  if (h > SIG_TOL.near) return 'baja';
  if (h > SIG_TOL.touch) return 'despacio';
  // colgando justo encima: despacio hasta que apoye (apoyada fuera de la zona ya se trató arriba)
  return s.carrying ? (s.resting ? 'para' : 'despacio') : 'engancha';
}

/** La señal en la partida (grúa que se maneja), o null si no hay nada que guiar */
export function sessionSignal(ses: Session): Signal | null {
  const L = ses.L, run = ses.run, u = ses.act, { phys, T, S } = u;
  if (!L || ses.tipped() || !ses.running) return null;
  const a = phys.attached;
  // (enganchada, `placed` no la cuenta: se mira su planta, como la escuela)
  const inAnyZone = (l: (typeof phys.loads)[number]) => {
    const p = l === phys.attached ? phys.footprint(l) : phys.placed(l);
    return !!p && L.zones.some((z) => inZone(p, z));
  };
  const hk = phys.hookBody.translation();
  const next = a ?? phys.loads.filter((l) => !inAnyZone(l)).sort((p, q) => {
    const P = p.body.translation(), Q = q.body.translation();
    return Math.hypot(P.x - hk.x, P.z - hk.z) - Math.hypot(Q.x - hk.x, Q.z - hk.z);
  })[0];
  if (!next) return null;
  const c = a ? a.body.translation() : null;
  const tip = phys.headWorld();
  const at = { x: tip.x, z: tip.z, bottom: c ? c.y - a!.half.y : hk.y - HOOK_HALF_H };
  let goal: { x: number; z: number; y: number };
  if (a) {
    const z = L.zones.reduce((p, q) => (Math.hypot(q.x - at.x, q.z - at.z) < Math.hypot(p.x - at.x, p.z - at.z) ? q : p));
    goal = { x: z.x, z: z.z, y: z.y };
  } else {
    const n = next.body.translation();
    goal = { x: n.x, z: n.z, y: n.y + next.half.y };
  }
  const piv = T.tower ? apply(u.pose, towerPivot(T, S)) : apply(u.pose, { x: T.piv, y: 0, z: 0 });
  // lo más alto entre la carga (o el gancho) y su destino
  let top = goal.y;
  // (la caja sobre la que está el destino solo pide pasar un poco por encima de él: allí se apoya)
  for (const b of levelBoxes(L)) {
    if (!segHitsBox(at.x, at.z, goal.x, goal.z, b, 1.5)) continue;
    const under = Math.abs(goal.x - b.x) <= b.w / 2 && Math.abs(goal.z - b.z) <= b.d / 2 && b.h <= goal.y + 0.05;
    top = Math.max(top, under ? goal.y - 0.7 : b.h);
  }
  const pos = (l: typeof next) => { const p = l.body.translation(); return { x: p.x, z: p.z, r: Math.hypot(l.half.x, l.half.z) }; };
  return signalFor({
    pivot: { x: piv.x, z: piv.z }, at, goal, clearH: top + 1.5,
    carrying: !!a, resting: !!a && phys.isResting(a), placed: !!a && inAnyZone(a),
    person: run.inExcl || (!!a && personAhead(pos(a), goal, L.workers ?? [], run.t)), tower: !!T.tower,
    speed: (() => { const v = (a ? a.body : phys.hookBody).linvel(); return Math.hypot(v.x, v.z); })(),
    offset: (() => { const p = (a ? a.body : phys.hookBody).translation(); return Math.hypot(p.x - tip.x, p.z - tip.z); })(),
    tipY: phys.headWorld().y, hoistRoom: Math.max(0, S.cable - CABLE_MIN), luffRoom: S.ang < T.boom.angMax - 3 * Math.PI / 180,
    // queda telescopio y sacarlo no llevaría el LMI al corte
    teleRoom: !T.tower && !T.crawler && S.Lb < teleLimit(T, S) - 0.2
      && lmiStatic(T, u.C, supportMode(S, T), Math.min(T.boom.max, S.Lb + 1.5), S.ang, S.slew, T.hookM + (ses.hanging(u) ? ses.loadOnHook(u) : 0))
        < (a?.kind === 'basket' ? 0.45 : 0.95),
  });
}

/** Alguien junto a la carga, o en los próximos 4 m del camino hacia el destino */
function personAhead(p: { x: number; z: number; r: number }, goal: { x: number; z: number }, ws: SiteWorker[], t: number) {
  if (!ws.length) return false;
  if (workerMargin(p, ws, t) < 1.5) return true;
  const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
  if (d < 0.5) return false;
  for (const k of [2, 4]) {
    const s = Math.min(k, d) / d;
    if (workerMargin({ x: p.x + dx * s, z: p.z + dz * s, r: p.r }, ws, t) < 0.5) return true;
  }
  return false;
}

/** El segmento a–b en planta pasa por la caja (agrandada m metros): muestras cada 0,5 m */
function segHitsBox(ax: number, az: number, bx: number, bz: number, b: { x: number; z: number; w: number; d: number }, m: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    if (Math.abs(x - b.x) <= b.w / 2 + m && Math.abs(z - b.z) <= b.d / 2 + m) return true;
  }
  return false;
}
