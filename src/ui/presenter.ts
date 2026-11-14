import * as THREE from 'three';
import { CRANES, isCrawler, type CraneSpec } from '../crane/cranes';
import { reach, ratedCap } from '../crane/stability';
import { supportMode } from '../crane/ops';
import { jibPhase, towerPhase, yGuyPhase } from '../crane/assembly';
import { canTie } from '../crane/tiedown';
import { CameraRig } from '../render/camera';
import { sceneFog, type SceneCtx } from '../render/scene';
import { DetailLod, LOD_DIST } from '../render/lod';
import { DecorView } from '../render/decorView';
import { Effects } from '../render/effects';
import { updateWater } from '../render/water';
import { apply } from '../crane/pose';
import { levelSize } from '../levels/setup';
import { LANDING_MIN } from '../levels/rules';
import { CARD_DELAY } from '../game/control';
import { MENU_IDS, type Session, type Unit } from '../game/session';
import { Hud } from './hud';
import { Help } from './help';
import { LevelUi, homeUrl, levelUrl } from './levelUi';
import type { Sound } from './audio';
import { bootDone } from './boot';
import { clearSave, loadSave } from './savegame';
import { readFrame, type Frame } from '../game/interp';
import { saveSettings, showFps, QUALITIES, type Quality, type Settings } from './settings';
import type { Input } from './input';
import { t } from '../i18n';

const MODE_TEXT = t.hud.modes;
const m = t.msg;

const _lat = new THREE.Vector3();
const _wd = new THREE.Vector3();
const _up = new THREE.Vector3();
const f1 = (v: number) => v.toFixed(1).replace('.', ',');

/**
 * Escala de la cámara con el largo del chasis; las orugas, con su pluma de celosía larga, más lejos (la LR 3000, con
 * 108 m de pluma, unas 3 veces la distancia de la AT 60); con plumín (AT 650-8: 54 + 42 m), según el largo total.
 */
export function camSize(specs: CraneSpec[]) {
  return Math.max(...specs.map((T) => Math.max(isCrawler(T) ? Math.max(1.4, T.boom.max / 36) : 1, (T.len[1] - T.len[0]) / 12.3,
    T.jibDef ? (T.boom.max + T.jibDef.len) / 55 : 0,
    // grúa torre: 40 m de alto y 60 m de pluma (la referencia aleja la vista a J·1,2 + 16)
    T.tower ? (T.tower.J * 1.2 + 16) / 40 : 0)));
}

/** Encuadre de sombras: lo que llega la pluma más tumbada (y la bandeja del superlift), al menos ±45 m */
export function shadowHalf(specs: CraneSpec[]) {
  return Math.max(...specs.map((T) => Math.max(45, T.foot + T.boom.max * Math.cos(T.boom.angMin) + 6,
    T.jibDef ? T.foot + T.boom.min + T.jibDef.len + 8 : 0,
    T.superlift ? T.superlift.rMax + T.superlift.w / 2 + 4 : 0)));
}

/**
 * Presentación (fase 14: sacada de main.ts): cámara, HUD, ayuda, menú y fichas de nivel, sonido. Escucha el bus de la
 * partida y, cada cuadro, dibuja y lee el estado de las grúas; no cambia la simulación (salvo empezar el turno desde
 * la ficha).
 */
export class Presenter {
  readonly cam: CameraRig;
  readonly hud: Hud;
  readonly help: Help;
  readonly lui: LevelUi;
  readonly sound: Sound;
  private readonly off: (() => void)[] = [];
  /** Detalles de las grúas que se ocultan de lejos (fase 16) */
  readonly lod: DetailLod;
  /** CPU del HUD en el último cuadro, ms (banco de pruebas, fase 16) */
  hudMs = 0;
  /** Polvo, humo y lluvia (fase 16); null en calidad baja */
  readonly fx: Effects | null;
  /** Decorado de fondo (fase 17) */
  readonly decor: DecorView;
  /** Intensidad del sol sin lluvia (con lluvia se oscurece; se repone al desmontar) */
  private sunI: number;

  /**
   * root = contenedor de esta partida dentro de #hud (se quita entero al desmontarla); sound = el de la app (uno solo);
   * go(url) = ir a otro nivel o grúa sin recargar (fase 14).
   */
  constructor(private ctx: SceneCtx, private ses: Session, settings: Settings, root: HTMLElement, sound: Sound, input: Input, go: (url: string) => void) {
    const { units, L, def, multi, bus } = ses;
    const act = ses.act;
    const specs = units.map((u) => u.T);
    this.cam = new CameraRig(ctx, act.crane.cab, (s) => ses.act.crane.eye(s), camSize(specs), shadowHalf(specs));
    // la cámara no atraviesa obstáculos, cargas ni grúas (fase 16; el mundo de Rapier es el mismo para las dos del tándem)
    this.cam.ray = (o, d, max) => ses.act.phys.rayHit(o, d, max);
    this.cam.groundY = (x, z) => ses.terrain.height(x, z);
    // niebla según la obra (fase 16) y detalles que se ocultan de lejos
    const site = L ? levelSize(L) : null;
    sceneFog(ctx, site ? { w: site[0], d: site[1] } : null, camSize(specs));
    this.lod = new DetailLod(units.map((u) => u.crane.root), settings.calidad === 'bajo' ? LOD_DIST / 2 : LOD_DIST);
    this.fx = settings.calidad === 'bajo' ? null : new Effects(ctx.scene);
    this.decor = new DecorView(ctx.scene, ses.decor, L?.wind[2] ?? 0, settings.calidad === 'bajo', ses.terrain.hills);
    // cuadrícula de 5 m solo en la prueba libre (fase 17)
    const grid = ctx.scene.getObjectByName('cuadricula');
    if (grid) grid.visible = ses.decor.grid;
    this.sunI = ctx.sun.intensity;
    // tándem: cámara libre en el centro de las grúas (V), que no salta al cambiar de grúa con Tab
    if (multi) this.cam.enableFree(() => {
      const n = units.length;
      return { x: units.reduce((a, u) => a + u.pose.t.x, 0) / n, z: units.reduce((a, u) => a + u.pose.t.z, 0) / n };
    });
    const any = (f: (T: CraneSpec, u: Unit) => boolean) => units.some((u) => f(u.T, u));
    const hud = this.hud = new Hud(root, act.T.name, act.id, MENU_IDS.map((k) => ({ id: k, name: CRANES[k].name })),
      { tele: any((T) => T.boom.max > T.boom.min), tower: any((T) => !!T.tower) }, showFps(import.meta.env.DEV, location.search));
    // Ayuda de controles (fase 13): H o el botón "?"; solo las teclas de las grúas de esta partida
    this.help = new Help(root, {
      tele: any((T) => !T.tower && T.boom.max > T.boom.min), tower: any((T) => !!T.tower), outriggers: any((T) => !!T.out),
      crawler: any((T) => isCrawler(T)), wheels: any((T) => !isCrawler(T)), tie: any((T) => canTie(T)),
      ballast: any((T) => !!T.ballast), yguy: any((T) => !!T.yguy), jib: any((_, u) => u.jibOk), superlift: any((T) => !!T.superlift),
      tandem: multi, free: !L,
    }, hud.helpBtn, input);
    // teclas cambiadas en la ayuda: la línea de abajo las muestra
    this.help.onKeys = () => hud.setKeys();
    hud.onCrane = (k) => go(levelUrl(0, k));

    // Niveles: menú, ficha, carteles y reloj. El turno empieza en pausa hasta "Empezar turno".
    const lui = this.lui = new LevelUi(root);
    hud.left.insertAdjacentHTML('beforeend', `<a class="panel menu-btn" href="${homeUrl()}">${t.hud.menu}</a>`);
    if (L) root.querySelector<HTMLElement>('.pick')!.hidden = true;
    // Ajustes (fase 11): calidad gráfica (recarga la página: el antialias no cambia en marcha) y sonido
    const qOpts = QUALITIES.map((q) => `<option value="${q}"${q === settings.calidad ? ' selected' : ''}>${t.hud.qualities[q]}</option>`).join('');
    hud.left.insertAdjacentHTML('beforeend', `<label class="panel pick prefs">${t.hud.quality} <select id="quality">${qOpts}</select></label>`);
    const qSel = root.querySelector('#quality') as HTMLSelectElement;
    qSel.addEventListener('change', () => {
      saveSettings({ ...settings, calidad: qSel.value as Quality });
      const u = new URL(location.href);
      u.searchParams.delete('calidad');
      location.href = u.toString();
    });
    qSel.addEventListener('keydown', (e) => { if (e.key !== 'Enter') { e.preventDefault(); qSel.blur(); } });
    // lluvia (fase 16): solo en la prueba libre y sin calidad baja (no hay niveles con lluvia en la referencia)
    if (!L && !def.showMenu && this.fx) {
      hud.left.insertAdjacentHTML('beforeend', `<label class="panel pick prefs"><input type="checkbox" id="rain"> ${t.hud.rain}</label>`);
      const rain = root.querySelector('#rain') as HTMLInputElement;
      rain.addEventListener('change', () => { this.setRain(rain.checked); rain.blur(); });
    }
    if (def.showMenu) lui.menu();
    else if (L) {
      // partida guardada de este nivel (fase 15): Continuar la monta con su grúa y sigue donde quedó
      const sv = loadSave(def.nivel);
      lui.brief(def.li, def.ids[0], (k) => go(levelUrl(def.nivel, k)), () => { ses.running = true; },
        sv ? { t: sv.t, crane: CRANES[sv.crane].name, go: () => go(`${levelUrl(def.nivel, L.tandem ? undefined : sv.crane)}&continuar=1`) } : undefined);
    }

    this.sound = sound;

    // Mensajes: en el tándem, los de la grúa que no se maneja llevan su nombre
    const name = (unit: number | undefined, text: string) => multi && unit !== undefined && units[unit] !== ses.act ? m.named(units[unit].T.name, text) : text;
    this.off.push(
      bus.on('say', (e) => { const t = name(e.unit, e.text); if (e.once) hud.sayOnce(t); else hud.say(t, e.s); }),
      bus.on('cut', (e) => hud.say(name(e.unit, e.overload ? m.cutOverload : m.cut))),
      bus.on('tipping', (e) => hud.say(name(e.unit, m.tipping), CARD_DELAY)),
      // en la prueba libre, el cartel con Reiniciar (en un nivel, el de nivel fallido: lo pide el fin del nivel)
      bus.on('tipped', (e) => { if (!L) hud.showTipped(multi ? m.named(units[e.unit].T.name, e.text) : e.text); }),
      bus.on('end', (e) => {
        clearSave(def.nivel);
        if (e.fail) lui.failed(def.li, ses.act.T.name, e.fail.title, e.fail.text);
        else lui.won(def.li, ses.act.T.name, ses.run, !!e.record);
      }),
      bus.on('restart', () => hud.showTipped(null)),
      bus.on('restored', () => hud.showTipped(null)),
      // Tab en el tándem (fase 15: llega desde el paso de la simulación)
      bus.on('switch', (e) => this.follow(units[e.unit])),
      // golpe sordo al apoyar o golpear la carga (los mismos umbrales que las reglas de los niveles)
      // fase 16: desde donde está la carga (o el gancho)
      bus.on('land', (e) => { if (e.v >= LANDING_MIN) this.sound.thump(e.v, this.loadAt(units[e.unit])); }),
      bus.on('strike', (e) => { if (e.v > 0.25) this.sound.thump(e.v, this.loadAt(units[e.unit])); }),
    );

    if (def.freeTandem) hud.say(m.freeTandem, 5);
    else if (!L && !def.showMenu) {
      const T = act.T;
      hud.say(T.tower ? m.introTower(T.name) : T.superlift ? m.introSuperlift(T.name) : T.crawler ? m.introCrawler(T.name) : m.intro(T.name), 4);
    }
  }

  /** Dónde está la carga enganchada de una grúa (o su gancho) */
  private loadAt(u: Unit) {
    const b = u.phys.attached?.body ?? u.phys.hookBody;
    return b.translation();
  }

  /** Lluvia encendida o apagada: el sol se apaga un poco y la niebla se acerca */
  setRain(on: boolean) {
    if (!this.fx) return;
    this.fx.setRain(on);
    this.ctx.sun.intensity = on ? this.sunI * 0.55 : this.sunI;
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (fog) { fog.near *= on ? 0.5 : 2; fog.far *= on ? 0.6 : 1 / 0.6; }
  }

  /** Tab: la cámara y el título siguen a la grúa que se maneja */
  follow(u: Unit) {
    this.cam.follow(u.crane.cab, (s) => u.crane.eye(s));
    this.hud.setTitle(u.T.name);
  }

  /**
   * Dibuja el cuadro y actualiza el HUD y el sonido (physMs = tiempo de física de este cuadro; ki = mandos de la grúa
   * que se maneja; paused = juego en pausa).
   */
  draw(dt: number, physMs: number, ki: { slew: number; luff: number; tele: number; hoist: number; fine: boolean; jib?: number; sl?: number }, paused = false,
    frame?: Frame) {
    const { ctx, ses, hud } = this;
    const { units, L, run, multi } = ses;
    const act = ses.act;
    const t1 = performance.now();
    // fase 15: se dibuja la mezcla de los dos últimos pasos (frame); sin frame, el último paso tal cual
    const f = frame ?? readFrame(units);
    units.forEach((u, i) => {
      const fu = f.units[i];
      u.crane.update(fu.S, fu.pose, u.C.slR);
      u.rig.update(u.crane.lateral(_lat), fu, f.loads, dt);
    });
    const fa = f.units[units.indexOf(act)];
    this.cam.update(dt, fa.S, fa.pose);
    this.lod.update(ctx.camera, ctx.renderer.domElement.height);
    const work = Math.max(Math.abs(ki.slew), Math.abs(ki.luff), Math.abs(ki.tele), Math.abs(ki.jib ?? 0), Math.abs(ki.sl ?? 0),
      act.S.cw !== act.S.cwT || act.S.yg !== act.S.ygT || act.S.jg !== act.S.jgT || act.S.er !== act.S.erT || (act.S.out > 0 && act.S.out < 1) ? 1 : 0);
    // efectos (fase 16): en pausa se quedan quietos
    this.fx?.update(paused || ses.tipped() ? 0 : dt, units.map((u, i) => ({ T: u.T, S: f.units[i].S, pose: f.units[i].pose, work: u === act ? work : 0 })),
      ctx.camera, ctx.renderer.domElement.height);
    this.decor.update(paused ? 0 : dt, run.wind, ctx.camera, ctx.renderer.domElement.height);
    updateWater(performance.now() / 1000);
    ctx.renderer.render(ctx.scene, ctx.camera);
    bootDone(); // primer cuadro dibujado: se quita la pantalla de carga
    // sonido 3D (fase 16): el oyente es la cámara; el motor en el chasis y el cabrestante en la superestructura
    const cam = ctx.camera;
    cam.getWorldDirection(_wd);
    this.sound.listen(cam.position, _wd, _up.set(0, 1, 0).applyQuaternion(cam.quaternion));
    const other = multi ? units.find((u) => u !== act)! : null;
    this.sound.update(dt, {
      speed: act.S.vd,
      work,
      hoist: Math.abs(ki.hoist),
      lmi: act.dyn.lmi,
      cut: act.cut,
      prox: run.inProx,
      off: !ses.running || ses.tipped() || paused,
    }, {
      engine: apply(fa.pose, { x: 0, y: 1.5, z: 0 }),
      winch: apply(fa.pose, { x: act.T.piv, y: act.T.pivH, z: 0 }),
      other: other ? apply(other.pose, { x: 0, y: 1.5, z: 0 }) : null,
    });
    const t2 = performance.now();

    const { T, S, C, phys } = act;
    const md = supportMode(S, T);
    const att = phys.attached;
    const share = phys.slingShare();
    const hp = phys.headWorld();
    hud.frame(dt, physMs, t2 - t1, ctx.renderer.info);
    if (L) {
      // flecha del viento en pantalla: dirección del nivel respecto de hacia dónde mira la cámara
      ctx.camera.getWorldDirection(_wd);
      const fl = Math.hypot(_wd.x, _wd.z) || 1, fx = _wd.x / fl, fz = _wd.z / fl;
      const a = (L.wind[2] * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a);
      const arrow = (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI;
      this.lui.setClock(L, run.t, ses.def.nivel, { wind: run.wind, arrow, lineD: run.lineD });
      this.lui.showSave(ses.running && !run.done && !ses.tipped());
    } else this.lui.setClock(null, 0);
    hud.readout({
      Lb: S.Lb,
      angDeg: (S.ang * 180) / Math.PI,
      radius: Math.max(0, reach(T, C, S.Lb, S.ang)),
      headH: hp.y,
      cable: S.cable,
      // tándem: la parte de la carga que lleva esta grúa
      load: att ? (share !== null ? t.hud.loadLug(att.label, phys.attachedLug === 0, f1(share), f1(att.mass))
        : t.hud.load(att.label, f1(att.mass))) : phys.tied ? t.hud.tied : t.hud.free,
      fine: ki.fine,
      lmi: act.dyn.lmi,
      rated: ratedCap(T, C, md, S.Lb, S.ang, S.slew),
      mHook: T.hookM + ses.loadOnHook(act),
      mode: S.out > 0 && S.out < 1 ? (S.outT ? t.hud.deploying : t.hud.stowing) : MODE_TEXT[md],
      tension: phys.tension,
      cut: act.cut,
      tiltDeg: (S.phi * 180) / Math.PI,
      tipped: ses.tipped(),
      bypass: ses.bypass,
      speed: S.vd,
      steerDeg: T.crawler ? null : (S.steer * 180) / Math.PI,
      ballast: T.ballast ? { t: T.ballast.m * S.cw, of: T.ballast.m, p: S.cw, target: S.cwT } : null,
      yguy: T.yguy ? { text: yGuyPhase(S.yg), p: S.yg } : null,
      superlift: T.superlift ? { r: C.slR, min: T.superlift.rMin, max: T.superlift.rMax } : null,
      jib: T.jibDef ? { text: jibPhase(S.jg), p: S.jg, deg: ((S.ang - S.jibRel) * 180) / Math.PI, len: T.jibDef.len } : null,
      tower: T.tower ? { text: towerPhase(S.er, S.erT), p: S.er } : null,
      side: share !== null ? { deg: (act.sideAng * 180) / Math.PI, max: 6 } : null,
    });
    const o = multi ? units.find((u) => u !== act)! : null;
    hud.other(o ? { name: o.T.name, lmi: o.dyn.lmi, tension: o.phys.tension, share: o.phys.slingShare(), tiltDeg: (o.S.phi * 180) / Math.PI, tipped: ses.tipped(o),
      sideDeg: o.phys.slingShare() !== null ? (o.sideAng * 180) / Math.PI : null } : null);
    this.hudMs = performance.now() - t2;
  }

  /** Quita los oyentes del bus y deja la cámara sin piezas ocultas de esta partida */
  dispose() {
    for (const f of this.off) f();
    this.off.length = 0;
    if (this.fx?.raining) this.setRain(false);
    this.fx?.dispose();
  }
}
