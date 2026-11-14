import type { CraneInput } from '../crane/kinematics';
import type { DriveInput } from '../crane/drive';
import { stepCrane, stepOutriggers } from '../crane/kinematics';
import { lmiStatic } from '../crane/stability';
import { dynamicStability, stepTilt, supportMode, TILTED_PHI } from '../crane/ops';
import { apply, carrierFrame, carrierPose, edgeAxis, rotate, worldToCarrier } from '../crane/pose';
import { stepDrive, stepSuspension } from '../crane/drive';
import { groundFit } from '../crane/ground';
import { blockWhileTied } from '../crane/tiedown';
import { blockWhileAssembling, stepAssembly, teleLimit } from '../crane/assembly';
import { stepSuperlift } from '../crane/superlift';
import { cableAngle } from '../levels/tandemSetup';
import type { Session, Unit } from './session';
import { t } from '../i18n';

/** Mandos sueltos: la grúa que no se maneja se queda quieta */
export const IDLE: CraneInput = { slew: 0, luff: 0, tele: 0, hoist: 0, fine: false, sl: 0, jib: 0 };
export const IDLE_DRIVE: DriveInput = { throttle: 0, steer: 0, fine: false };

/** Segundos entre el vuelco y el cartel (para ver caer la grúa) */
export const CARD_DELAY = 2.5;

/**
 * Mandos, montajes y conducción de una grúa antes del paso de física. `inp`/`drv`: los mandos del jugador si es la
 * grúa que se maneja; si no, IDLE. Los avisos salen por el bus.
 */
export function controlUnit(ses: Session, u: Unit, dt: number, inp: CraneInput, drv: DriveInput) {
  const { T, S, C, phys } = u;
  const { bus, L, bypass } = ses;
  if (ses.tipped(u)) return;
  const say = (text: string, s?: number) => bus.emit('say', { text, s, unit: u.i });
  const sayOnce = (text: string) => bus.emit('say', { text, once: true, unit: u.i });
  const att = phys.attached;
  const mLoad = T.hookM + ses.loadOnHook(u);
  // Conducción (antes de las funciones de la grúa, como step() en la referencia)
  const v0 = S.vd;
  const dr = stepDrive(T, S, drv, dt, {
    loadHanging: ses.hanging(u),
    lmiMove: lmiStatic(T, C, T.crawler ? 'crawlMove' : 'move', S.Lb, S.ang, S.slew, mLoad),
    tilted: S.phi > TILTED_PHI,
    bypass,
    blocked: (x, z, h) => phys.carrierBlocked(x, z, h),
    ground: (x, z, h) => groundFit(T, (px, pz) => phys.groundY(px, pz), x, z, h),
  });
  if (dr.msg) {
    // choque del chasis a más de 1,2 m/s: golpe (referencia)
    if (dr.hit && L) bus.emit('bump', { unit: u.i, text: dr.msg }); else sayOnce(dr.msg);
  }
  stepSuspension(T, S, (S.vd - v0) / dt, dt);
  // Montajes (lastre, Y-guy): avanzan y, mientras tanto, la grúa no se mueve
  // (grúa torre: el montaje se detiene si la torre o su pluma tocarían algo)
  const am = stepAssembly(T, S, C, dt, T.tower ? (s) => phys.towerHits(s, u.pose) : undefined);
  if (am) say(am, 2);
  const bm = blockWhileAssembling(S, inp, T);
  if (bm) sayOnce(bm);
  const tm = phys.tied ? blockWhileTied(inp) : null;
  if (tm) sayOnce(tm);
  const teleMax = teleLimit(T, S);
  if (inp.tele > 0 && S.Lb >= teleMax - 1e-6 && teleMax < T.boom.max) {
    sayOnce(t.msg.teleLimit(teleMax));
  }
  const md = supportMode(S, T);
  // Como la referencia: los cortes usan el LMI estático; la carga cuenta solo si cuelga.
  // Tándem: la parte de la carga que lleva esta grúa (medida en Rapier).
  const mEval = ses.hanging(u) ? mLoad : T.hookM;
  const noHoistUp = !!att && lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mLoad) >= 1;
  let hitMsg = '';
  u.cut = stepCrane(T, S, inp, dt, {
    // C.jibRel sigue al ángulo del plumín que se está probando (T/G)
    lmi: bypass ? () => 0 : (s) => { C.jibRel = s.jibRel; return lmiStatic(T, C, md, s.Lb, s.ang, s.slew, mEval); },
    L0: lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
    noHoistUp: noHoistUp && !bypass,
    tilted: S.phi > TILTED_PHI, // la inclinación limita los movimientos aunque el LMI esté puenteado
    teleMax,
    // la bandeja del superlift no atraviesa obstáculos al girar (boomHit de la referencia)
    // y las torres de lastre tampoco (no está en la referencia)
    // (fase 8B: el contrapeso de todas las grúas, salvo la torre, que lo lleva arriba)
    slewBlocked: !T.tower ? (s) => {
      const why = phys.trayBlocked(s.x, s.z, s.h, s.slew, C.slR) ?? phys.tailBlocked(s, s.slew, s.cw);
      if (why) sayOnce(why);
      return !!why;
    } : undefined,
    // el plumín no atraviesa obstáculos, cargas sueltas ni el suelo; la torre y su pluma tampoco
    jibHit: T.jibDef || T.tower ? (s) => {
      const r = T.tower ? phys.towerHits(s, u.pose) : phys.jibHits(s, u.pose);
      if (r.n) hitMsg = r.what;
      return r.n;
    } : undefined,
    // el plumín o la torre tocarían algo: en un nivel cuenta como golpe (strike de la referencia)
    onHit: () => { if (L) bus.emit('bump', { unit: u.i, text: hitMsg }); else sayOnce(hitMsg); },
  });
  C.jibRel = S.jibRel;
  // radio del superlift (K/L), con el guard del LMI y sin chocar
  if (T.superlift && inp.sl) {
    const why = stepSuperlift(T, C, inp.sl, inp.fine, dt, {
      lmi: () => (bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval)),
      L0: bypass ? 0 : lmiStatic(T, C, md, S.Lb, S.ang, S.slew, mEval),
      hit: (r) => phys.trayBlocked(S.x, S.z, S.h, S.slew, r),
    });
    if (why === 'lmi') { u.cut = true; } else if (why) sayOnce(why);
  }
  if (u.cut && !u.cutMsg) bus.emit('cut', { unit: u.i, overload: noHoistUp && inp.hoist < 0 });
  u.cutMsg = u.cut;
  stepOutriggers(T, S, dt);
  u.pose = carrierPose(T, S, supportMode(S, T));
}

/** Después del paso de física: estabilidad con la tensión real, inclinación y vuelco de una grúa. */
export function afterUnit(ses: Session, u: Unit, dt: number) {
  const { T, S, C, phys } = u;
  const { bus } = ses;
  if (ses.tipped(u)) {
    u.pose = phys.tippedPose()!;
    if (u.tipClock >= 0 && (u.tipClock += dt) >= CARD_DELAY) {
      // en un nivel, el cartel de nivel fallido (Repetir vuelve a la ficha); en la prueba libre, Reiniciar
      bus.emit('tipped', { unit: u.i, text: u.tipText });
      u.tipClock = -1;
    }
    return;
  }
  if (phys.twoBlocked()) bus.emit('say', { text: t.msg.twoBlock, once: true, unit: u.i });
  // ángulo del cable con la vertical (tiro lateral del tándem)
  u.sideAng = cableAngle(phys.headWorld(), phys.hookTop());
  // Estabilidad con la tensión real del cable: un balanceo o un tirón también cuentan.
  const md = supportMode(S, T);
  u.dyn = dynamicStability(T, C, S, md, phys.tension, worldToCarrier(S, phys.gp));
  if (ses.hanging(u)) ses.run.maxLmi = Math.max(ses.run.maxLmi, u.dyn.lmi); // LMI máximo con la carga colgada (maxLmi de la referencia)
  if (stepTilt(S, u.dyn, dt)) {
    const { p, axis } = edgeAxis(T, md, S.edge);
    const f = carrierFrame(S); // la arista viene en el marco del chasis
    phys.tipOver(C, S, md, u.pose, apply(f, p), rotate(f.q, axis));
    S.vd = 0;
    u.cut = false;
    u.tipClock = 0;
    u.tipText = t.msg.tipText(Math.round(u.dyn.u * 100), md === 'tire' || md === 'move');
    bus.emit('tipping', { unit: u.i });
  }
}
