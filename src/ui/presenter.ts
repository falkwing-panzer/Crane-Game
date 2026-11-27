import { Daylight } from '../render/daylight';
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
import { LevelUi, examUrl, homeUrl, levelUrl, loadRecords } from './levelUi';
import { grant, missingFor, craneOk, type Family } from '../game/licenses';
import type { Sound } from './audio';
import { bootDone } from './boot';
import { clearSave, loadSave } from './savegame';
import { readFrame, type Frame } from '../game/interp';
import { saveSettings, showFps, QUALITIES, type Quality, type Settings } from './settings';
import type { Input } from './input';
import { RingsView } from '../render/ringsView';
import { SchoolPanel, introHtml, loadSchool, markSchool, passedHtml } from './schoolUi';
import { ChartPanel } from './chartPanel';
import { HookPip } from '../render/hookPip';
import { CAB_LAYER, CabScreen } from '../render/cabScreen';
import { Aids } from '../render/aids';
import { Rumble } from './rumble';
import { OptionsPanel } from './options';
import { Replay } from '../game/replay';
import { maxReachContour } from '../crane/loadChart';
import type { HookAnchor } from '../render/camera';
import { t } from '../i18n';
import { AchievementToast } from './progressView';
import { SafetyView } from './safetyView';
import { settleContract, showCareer } from '../career/careerUi';
import { showEditor } from '../editor/editorUi';
import { active, type LevelEvent } from '../levels/events';

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
  /** Tabla de cargas (fase 20, tecla C) */
  readonly chart: ChartPanel;
  /** Fase 21: recuadro de la cámara del gancho, pantalla de la cabina, ayudas, vibración, opciones y repetición */
  readonly pip: HookPip;
  private cabScreen: CabScreen;
  private aids: Aids;
  private rumble = new Rumble();
  readonly opts: OptionsPanel;
  private inCab = false;
  private maxRing: { key: string; at: number; pts: { slew: number; R: number | null }[] | null } = { key: '', at: -Infinity, pts: null };
  /** Lo grabado para la repetición (lo pone bindCommands: `GameStep.replay.take`) */
  takeReplay: () => import('../game/interp').Frame[] = () => [];
  private rp: { play: Replay; then: () => void; cam: { p: THREE.Vector3; q: THREE.Quaternion; up: THREE.Vector3; target: THREE.Vector3; enabled: boolean }; a0: number; t: number } | null = null;
  private lastReplay: Replay | null = null;
  /** Fallo del nivel (para volver a poner su cartel después de ver la repetición otra vez) */
  private lastEnd: { title: string; text: string } | null = null;
  /** Aviso de logro conseguido (fase 22) */
  private toast: AchievementToast;
  /** Fase 23: trabajadores, señalero y lista de chequeo */
  safety!: SafetyView;
  private replayBar: HTMLElement;
  private size: number;
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
  private daylight: Daylight | null = null;
  /** Escuela (fase 19): panel del paso, aros y teclas resaltadas */
  private school: { panel: SchoolPanel; rings: RingsView; hl: string } | null = null;

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
    const site = ses.site ? levelSize(ses.site) : null;
    sceneFog(ctx, site ? { w: site[0], d: site[1] } : null, camSize(specs));
    this.lod = new DetailLod(units.map((u) => u.crane.root), settings.calidad === 'bajo' ? LOD_DIST / 2 : LOD_DIST);
    this.fx = settings.calidad === 'bajo' ? null : new Effects(ctx.scene);
    this.decor = new DecorView(ctx.scene, ses.decor, ses.site?.wind[2] ?? 0, settings.calidad === 'bajo', ses.terrain.hills);
    // cuadrícula de 5 m solo en la prueba libre (fase 17)
    const grid = ctx.scene.getObjectByName('cuadricula');
    if (grid) grid.visible = ses.decor.grid;
    // fase 27: atardecer o noche, con focos de trabajo
    if (ses.site?.light) {
      this.daylight = new Daylight(ctx, ses.site.light, ses.site.lamps ?? [], (x, z) => ses.terrain.height(x, z));
      this.cam.setSunDir(this.daylight.sunDir);
    }
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
      tandem: multi, free: !L && !ses.lesson, school: !!ses.lesson,
    }, hud.helpBtn, input);
    // teclas cambiadas en la ayuda: la línea de abajo las muestra
    this.help.onKeys = () => {
      hud.setKeys();
      if (this.school && ses.sch) this.school.panel.update(ses.sch, ses.running, true);
    };
    hud.onCrane = (k) => go(levelUrl(0, k));
    this.chart = new ChartPanel(root);
    this.toast = new AchievementToast(root);
    this.safety = new SafetyView(ctx.scene, root, ses);
    this.safety.checklist && (this.safety.checklist.onToggle = (open) => input.block('chequeo', open));
    ses.expert = settings.experto;
    // a ciegas (fase 23): solo la cabina y la cámara del gancho
    if (ses.L?.blind) this.cam.restrict(['cabina', 'gancho'], act.S, act.pose);
    // fase 21
    this.size = camSize(specs);
    this.pip = new HookPip(root, t.options.pipTitle);
    this.cabScreen = new CabScreen(ctx.scene);
    ctx.camera.layers.enable(CAB_LAYER);
    this.aids = new Aids(ctx.scene);
    this.opts = new OptionsPanel(root, hud.left, settings);
    this.opts.onToggle = (open) => input.block('opciones', open);
    this.opts.onChange = (s) => this.applyOptions(s, root);
    this.applyOptions(settings, root);
    root.insertAdjacentHTML('beforeend', `<div class="replay-bar" hidden><b></b><button type="button">${t.replay.skip}</button></div>`);
    this.replayBar = root.querySelector('.replay-bar')!;
    this.replayBar.querySelector('button')!.addEventListener('click', (e) => { this.skipReplay(); (e.currentTarget as HTMLElement).blur(); });
    this.input = input;
    this.settings = settings;

    // Niveles: menú, ficha, carteles y reloj. El turno empieza en pausa hasta "Empezar turno".
    const lui = this.lui = new LevelUi(root);
    hud.left.insertAdjacentHTML('beforeend', `<a class="panel menu-btn" href="${homeUrl()}">${t.hud.menu}</a>`);
    if (L || ses.lesson) root.querySelector<HTMLElement>('.pick')!.hidden = true;
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
    if (!L && !ses.lesson && !def.showMenu && this.fx) {
      hud.left.insertAdjacentHTML('beforeend', `<label class="panel pick prefs"><input type="checkbox" id="rain"> ${t.hud.rain}</label>`);
      const rain = root.querySelector('#rain') as HTMLInputElement;
      rain.addEventListener('change', () => { this.setRain(rain.checked); rain.blur(); });
    }
    lui.job = def.job;
    lui.unlockAll = settings.desbloquear;
    if (def.career) showCareer(lui, go);
    else if (def.editor) showEditor(lui, go, def.editor);
    else if (def.showMenu) lui.menu();
    else if (L && !lui.open_(L)) {
      // fase 22: sin la licencia de la familia, el nivel está cerrado (se llega con la URL a mano)
      const f = t.license.names[missingFor(L)];
      lui.show(`<div class="eyebrow">${L.name}</div><h2>${t.license.lockedTitle}</h2><p>${t.license.lockedText(f)}</p>
        <div class="row"><a class="btn" href="${homeUrl()}">${t.levels.menuBtn}</a><a class="btn primary" href="${examUrl(missingFor(L))}">${t.license.goExam}</a></div>`);
    } else if (L && !L.tandem && !craneOk(def.ids[0], lui.lic(), lui.unlockAll) && L.cranes.some((id) => craneOk(id, lui.lic(), false))) {
      // la grúa pedida (o la recomendada) no tiene licencia, pero otra permitida sí: esa
      go(lui.url(def.li, L.cranes.find((id) => craneOk(id, lui.lic(), false))));
    }
    else if (ses.lesson) this.school = this.setupSchool(root);
    else if (L) {
      // partida guardada de este nivel (fase 15): Continuar la monta con su grúa y sigue donde quedó
      const sv = def.job ? null : loadSave(def.nivel);
      lui.brief(def.li, def.ids[0], (k) => go(lui.url(def.li, k)), () => { ses.running = true; },
        sv ? { t: sv.t, crane: CRANES[sv.crane].name, go: () => go(`${levelUrl(def.nivel, L.tandem ? undefined : sv.crane)}&continuar=1`) } : undefined);
    }

    this.sound = sound;

    // Mensajes: en el tándem, los de la grúa que no se maneja llevan su nombre
    const name = (unit: number | undefined, text: string) => multi && unit !== undefined && units[unit] !== ses.act ? m.named(units[unit].T.name, text) : text;
    this.off.push(
      bus.on('say', (e) => { const t = name(e.unit, e.text); if (e.once) hud.sayOnce(t); else hud.say(t, e.s); }),
      bus.on('cut', (e) => hud.say(name(e.unit, e.overload ? m.cutOverload : m.cut))),
      bus.on('tipping', (e) => { hud.say(name(e.unit, m.tipping), CARD_DELAY); this.vibrate(this.rumble.hit('tip')); }),
      // en la prueba libre, el cartel con Reiniciar (en un nivel, el de nivel fallido: lo pide el fin del nivel);
      // fase 21: antes, la repetición de los últimos segundos a cámara lenta
      bus.on('tipped', (e) => {
        if (L) return;
        const text = multi ? m.named(units[e.unit].T.name, e.text) : e.text;
        this.startReplay(() => hud.showTipped(text, () => this.replayAgain()));
      }),
      bus.on('end', (e) => {
        clearSave(def.nivel);
        if (e.fail) {
          const f = this.lastEnd = e.fail;
          const contract = this.contract(e);
          this.startReplay(() => {
            lui.failed(def.li, ses.act.T.name, f.title, f.text, ses.run, this.lastReplay ? () => this.replayAgain() : undefined);
            this.showContract(contract);
          });
        } else {
          lui.won(def.li, ses.act.T.name, ses.run, !!e.record, e.smooth, !!e.smoothBest);
          this.showContract(this.contract(e));
          this.licensed(null); // el nivel 13 puede completar la de tándem
        }
      }),
      bus.on('achievement', (e) => this.toast.push(e.id)),
      bus.on('restart', () => hud.showTipped(null)),
      bus.on('restored', () => hud.showTipped(null)),
      // Tab en el tándem (fase 15: llega desde el paso de la simulación)
      bus.on('switch', (e) => this.follow(units[e.unit])),
      // golpe sordo al apoyar o golpear la carga (los mismos umbrales que las reglas de los niveles)
      // fase 16: desde donde está la carga (o el gancho)
      bus.on('land', (e) => {
        if (e.v >= LANDING_MIN) this.sound.thump(e.v, this.loadAt(units[e.unit]));
        if (units[e.unit] === ses.act) this.vibrate(this.rumble.hit('land', e.v));
      }),
      bus.on('strike', (e) => {
        if (e.v > 0.25) this.sound.thump(e.v, this.loadAt(units[e.unit]));
        if (units[e.unit] === ses.act) this.vibrate(this.rumble.hit('strike', e.v));
      }),
    );

    if (def.freeTandem) hud.say(m.freeTandem, 5);
    else if (!L && !ses.lesson && !def.showMenu) {
      const T = act.T;
      hud.say(T.tower ? m.introTower(T.name) : T.superlift ? m.introSuperlift(T.name) : T.crawler ? m.introCrawler(T.name) : m.intro(T.name), 4);
    }
  }

  /**
   * Escuela (fase 19): presentación de la lección (el turno empieza al pulsar Empezar), panel del paso actual, aros y
   * cartel de lección superada (se guarda como hecha).
   */
  private setupSchool(root: HTMLElement) {
    const { ses, lui } = this, lesson = ses.lesson!;
    const panel = new SchoolPanel(root, lesson);
    const rings = new RingsView(this.ctx.scene, lesson.rings, lesson.site.zones);
    lui.show(introHtml(lesson));
    const start = lui.card.querySelector<HTMLButtonElement>('#s-start')!;
    start.addEventListener('click', () => { lui.close(); ses.running = true; start.blur(); });
    start.focus({ preventScroll: true });
    this.off.push(ses.bus.on('lessonDone', (e) => {
      if (!lesson.license) markSchool(e.n);
      this.licensed(lesson.license ?? null);
      lui.show(passedHtml(lesson, levelUrl(1)));
      lui.card.querySelector<HTMLElement>('#s-next')?.focus({ preventScroll: true });
    }));
    // los enlaces del cartel (siguiente lección, repetir, menú) cambian de partida sin recargar: los toma la App
    return { panel, rings, hl: '' };
  }

  /** Panel de la escuela, aros y teclas resaltadas (cada cuadro; solo repinta si cambia algo) */
  private drawSchool() {
    const sc = this.school, sch = this.ses.sch;
    if (!sc || !sch) return;
    sc.panel.update(sch, this.ses.running);
    sc.panel.wind(this.ses.run.wind);
    sc.rings.update(sch.step, this.ctx.camera);
    const keys = this.ses.running ? sc.panel.keys(sch) : [];
    const hl = keys.join(',');
    if (hl !== sc.hl) { sc.hl = hl; this.hud.setKeys(keys); }
  }

  private input: Input;
  private settings: Settings;

  /** Opciones (fase 21): recuadro, modo experto y tamaño del HUD; las ayudas y la vibración se leen cada cuadro */
  /** Fase 25: si es un contrato de la carrera, lo cobra (una vez) y devuelve las cuentas para el cartel */
  private contract(e: { fail: unknown; stars?: number; smooth?: { medal: 'oro' | 'plata' | 'bronce' | null } | null }) {
    const { ses } = this, job = ses.def.job, run = ses.run;
    if (job?.kind !== 'contrato' || job.offer === undefined || ses.replaying) return '';
    return settleContract(job.offer, ses.units[0].id, {
      ok: !e.fail, stars: e.stars ?? 0, medal: e.smooth?.medal ?? null, bumps: run.bumps, hard: run.hard, prox: run.prox,
      excl: run.excl, skips: run.skips, late: run.late, tipped: ses.units.some((u) => ses.tipped(u)),
    });
  }

  /** Cuentas del contrato en el cartel: sustituyen a sus botones (la oferta ya no existe) */
  private showContract(html: string) {
    if (!html) return;
    this.lui.card.querySelectorAll('.row').forEach((r) => r.remove());
    this.lui.card.insertAdjacentHTML('beforeend', html);
  }

  /** Da la licencia del examen (o mira si lo hecho ya da alguna) y lo avisa (fase 22) */
  private licensed(f: Family | null) {
    for (const k of grant(this.lui.lic(), f, loadRecords(), loadSchool())) this.hud.say(t.license.got(t.license.names[k]), 4);
  }

  private applyOptions(s: Settings, root: HTMLElement) {
    if (this.lui && this.lui.unlockAll !== s.desbloquear) {
      this.lui.unlockAll = s.desbloquear;
      if (this.ses.def.showMenu && this.lui.open) this.lui.menu();
    }
    this.pip.setOn(s.recuadro);
    this.hud.expert = s.experto;
    this.ses.expert = s.experto;
    root.style.setProperty('--hud-scale', String(s.hud));
    root.querySelector('#other')?.classList.toggle('pip', s.recuadro);
  }

  /** Manda una vibración al mando, si está encendida */
  private vibrate(fx: { strong: number; weak: number; ms: number } | null) {
    if (fx && this.settings.vibracion) this.input.rumble(fx);
  }

  /** Ancla del cable y eje de giro de una grúa en un cuadro (cámara del gancho) */
  private anchor(u: Unit, fu: { head: { x: number; y: number; z: number }; pose: import('../crane/pose').Pose }): HookAnchor {
    return { head: fu.head, piv: apply(fu.pose, { x: u.T.piv, y: 0, z: 0 }) };
  }

  /** ¿Se está viendo la repetición? */
  get replaying() { return !!this.rp; }

  /**
   * Repetición del fallo (fase 21): los últimos segundos grabados a cámara lenta desde una cámara que da vueltas
   * alrededor de la grúa; al terminar (o al saltarla), then() muestra el cartel.
   */
  private startReplay(then: () => void) {
    const frames = this.takeReplay();
    if (frames.length < 30) { this.lastReplay = null; then(); return; }
    this.lastReplay = new Replay(frames);
    this.playReplay(this.lastReplay, then);
  }

  private playReplay(play: Replay, then: () => void) {
    const { camera, controls } = this.ctx;
    play.rewind();
    const c = this.ses.act.pose.t;
    this.rp = {
      play, then, t: 0,
      a0: Math.atan2(camera.position.z - c.z, camera.position.x - c.x),
      cam: { p: camera.position.clone(), q: camera.quaternion.clone(), up: camera.up.clone(), target: controls.target.clone(), enabled: controls.enabled },
    };
    controls.enabled = false;
    camera.up.set(0, 1, 0);
    this.lui.close();
    this.hud.showTipped(null);
    this.replayBar.hidden = false;
    this.replayBar.querySelector('b')!.textContent = t.replay.banner(play.speed.toFixed(2).replace('.', ','));
  }

  /** Esc o el botón: termina la repetición y sale el cartel */
  skipReplay() {
    const rp = this.rp;
    if (!rp) return;
    this.rp = null;
    const { camera, controls } = this.ctx;
    camera.position.copy(rp.cam.p);
    camera.quaternion.copy(rp.cam.q);
    camera.up.copy(rp.cam.up);
    controls.target.copy(rp.cam.target);
    controls.enabled = rp.cam.enabled;
    this.replayBar.hidden = true;
    rp.then();
  }

  /** Botón "Ver la repetición" del cartel */
  private replayAgain() {
    const play = this.lastReplay;
    if (!play || this.rp) return;
    const tipped = this.hud.tippedText;
    const end = this.lastEnd, ses = this.ses;
    this.playReplay(play, () => {
      // vuelve el mismo cartel, con sus botones
      if (end) this.lui.failed(ses.def.li, ses.act.T.name, end.title, end.text, ses.run, () => this.replayAgain());
      else if (tipped !== null) this.hud.showTipped(tipped, () => this.replayAgain());
    });
  }

  /** Cámara de la repetición: da vueltas despacio alrededor de la grúa, mirando la grúa entera */
  private replayCam(fa: { pose: import('../crane/pose').Pose }, dt: number) {
    const rp = this.rp!, { camera } = this.ctx, k = this.size;
    rp.t += dt;
    const a = rp.a0 + rp.t * 0.12, c = fa.pose.t;
    const R = 34 * k, H = 15 * k;
    camera.position.set(c.x + R * Math.cos(a), c.y + H, c.z + R * Math.sin(a));
    camera.lookAt(c.x, c.y + 5 * k, c.z);
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

  private fog0: { near: number; far: number } | null = null;
  private stormOn = false;
  private flash = 0;

  /** Fase 24: niebla (más cerca mientras dura), tormenta (lluvia, cielo oscuro y rayos de vez en cuando) */
  private weather(evs: LevelEvent[], t: number, dt: number) {
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (fog) {
      this.fog0 ??= { near: fog.near, far: fog.far };
      const f = active(evs, 'fog', t);
      const far = f && f.kind === 'fog' ? f.dist : this.fog0.far, near = f ? far * 0.2 : this.fog0.near;
      fog.near += (near - fog.near) * Math.min(1, dt * 0.5);
      fog.far += (far - fog.far) * Math.min(1, dt * 0.5);
    }
    const storm = !!active(evs, 'storm', t);
    if (storm !== this.stormOn) { this.stormOn = storm; this.setRain(storm); }
    if (storm && Math.random() < dt / 5) this.flash = 0.12;
    if (this.flash > 0) {
      this.flash -= dt;
      this.ctx.sun.intensity = this.flash > 0 ? this.sunI * 3 : this.sunI * 0.55;
    }
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
    // fase 21: en la repetición, el cuadro grabado que toca
    const rp = this.rp;
    const f = rp ? rp.play.frame(dt) : frame ?? readFrame(units);
    units.forEach((u, i) => {
      const fu = f.units[i];
      u.crane.update(fu.S, fu.pose, u.C.slR);
      u.rig.update(u.crane.lateral(_lat), fu, f.loads, dt);
    });
    const fa = f.units[units.indexOf(act)];
    if (rp) this.replayCam(fa, dt);
    else this.cam.update(dt, fa.S, fa.pose, this.anchor(act, fa));
    this.lod.update(ctx.camera, ctx.renderer.domElement.height);
    const work = Math.max(Math.abs(ki.slew), Math.abs(ki.luff), Math.abs(ki.tele), Math.abs(ki.jib ?? 0), Math.abs(ki.sl ?? 0),
      act.S.cw !== act.S.cwT || act.S.yg !== act.S.ygT || act.S.jg !== act.S.jgT || act.S.er !== act.S.erT || (act.S.out > 0 && act.S.out < 1) ? 1 : 0);
    // efectos (fase 16): en pausa se quedan quietos
    this.fx?.update(paused || ses.tipped() ? 0 : dt, units.map((u, i) => ({ T: u.T, S: f.units[i].S, pose: f.units[i].pose, work: u === act ? work : 0 })),
      ctx.camera, ctx.renderer.domElement.height);
    this.decor.update(paused ? 0 : dt, run.wind, ctx.camera, ctx.renderer.domElement.height);
    updateWater(performance.now() / 1000);
    // fase 21: pantalla del LMI en la cabina (y el panel de datos se oculta en esa vista) y ayudas
    const cabin = this.cam.mode === 'cabina' && !rp;
    if (cabin !== this.inCab) { this.inCab = cabin; hud.setCabin(cabin); }
    this.drawAids(fa, f);
    this.cabScreen.update(ctx.camera, cabin, cabin ? this.cabData() : null);
    ctx.renderer.render(ctx.scene, ctx.camera);
    // recuadro de la cámara del gancho (no en la vista del gancho: sería la misma imagen)
    if (this.pip.on && (this.cam.mode !== 'gancho' || rp)) {
      const info = ctx.renderer.info.render, c0 = info.calls, t0 = info.triangles;
      const add = this.pip.render(ctx.renderer, ctx.scene, this.anchor(act, fa));
      info.calls = c0 + add.calls;
      info.triangles = t0 + add.triangles;
    }
    if (rp && rp.play.done) this.skipReplay();
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
      off: !ses.running || ses.tipped() || paused || !!rp,
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
    this.drawSchool();
    if (L) this.safety.update(this.settings.voz);
    if (L) {
      // flecha del viento en pantalla: dirección del nivel respecto de hacia dónde mira la cámara
      ctx.camera.getWorldDirection(_wd);
      const fl = Math.hypot(_wd.x, _wd.z) || 1, fx = _wd.x / fl, fz = _wd.z / fl;
      const a = (L.wind[2] * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a);
      const arrow = (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI;
      // fase 24: con el anemómetro averiado no hay dato de viento
      this.lui.setClock(L, run.t, ses.def.nivel, { wind: active(L.events, 'anemo', run.t) ? NaN : run.wind, arrow, lineD: run.lineD });
      if (L.events) this.weather(L.events, run.t, dt);
      this.lui.showSave(!ses.def.job && ses.running && !run.done && !ses.tipped());
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
    this.chart.update({ T, S, C, md, mHook: T.hookM + ses.loadOnHook(act) });
    const o = multi ? units.find((u) => u !== act)! : null;
    hud.other(o ? { name: o.T.name, lmi: o.dyn.lmi, tension: o.phys.tension, share: o.phys.slingShare(), tiltDeg: (o.S.phi * 180) / Math.PI, tipped: ses.tipped(o),
      sideDeg: o.phys.slingShare() !== null ? (o.sideAng * 180) / Math.PI : null } : null);
    // vibración del mando (fase 21): continua desde el 90 % de LMI y pulsos con la alarma de la línea
    this.vibrate(this.rumble.frame(dt, { lmi: act.dyn.lmi, prox: run.inProx, off: !ses.running || ses.tipped() || paused || !!rp || !this.settings.vibracion }));
    this.hudMs = performance.now() - t2;
  }

  /** Ayudas (fase 21): plomada, marca de la carga, radio actual y radio máximo con la carga colgada */
  private drawAids(fa: Frame['units'][number], f: Frame) {
    const { ses, settings } = this;
    const act = ses.act, on = settings.ayudas && !settings.experto && !ses.tipped();
    if (!on) { this.aids.update(false, null); return; }
    const { T, S, C, phys } = act;
    const att = phys.attached, li = att ? phys.loads.indexOf(att) : -1;
    const lb = li >= 0 ? f.loads[li] : null;
    const from = lb && att ? { x: lb.t.x, y: lb.t.y - att.half.y, z: lb.t.z } : { x: fa.hook.t.x, y: fa.hook.t.y - 0.5, z: fa.hook.t.z };
    const piv = apply(fa.pose, { x: T.piv, y: 0, z: 0 });
    // radio máximo: se recalcula si cambia algo (como mucho cada 0,3 s)
    let ring: { x: number; z: number }[] | null = null;
    if (ses.hanging(act)) {
      const md = supportMode(S, T), m = T.hookM + ses.loadOnHook(act);
      const key = [md, S.Lb.toFixed(1), T.tower ? S.ang.toFixed(2) : '', m.toFixed(1), C.mCw, C.yOn, C.jib ? C.jibRel.toFixed(2) : '', C.slR.toFixed(1)].join('|');
      const now = performance.now();
      if (key !== this.maxRing.key && now - this.maxRing.at > 300) this.maxRing = { key, at: now, pts: maxReachContour(T, C, md, S.Lb, S.ang, m) };
      ring = (this.maxRing.pts ?? []).map((p) => {
        const w = apply(fa.pose, { x: T.piv + (p.R ?? 0) * Math.cos(p.slew), y: 0, z: -(p.R ?? 0) * Math.sin(p.slew) });
        return { x: w.x, z: w.z };
      });
    }
    this.aids.update(true, {
      from, piv, radius: Math.max(0, reach(T, C, fa.S.Lb, fa.S.ang)), maxRing: ring,
      load: lb && att ? { t: lb.t, q: lb.q, half: att.half } : null,
      ground: (x, z) => ses.terrain.height(x, z),
    });
  }

  /** Lo que muestra la pantalla de la cabina */
  private cabData() {
    const { ses, settings } = this, u = ses.act, { T, S, C, phys } = u;
    const md = supportMode(S, T);
    return {
      name: T.name, radius: Math.max(0, reach(T, C, S.Lb, S.ang)), load: phys.attached ? ses.loadOnHook(u) : null,
      rated: ratedCap(T, C, md, S.Lb, S.ang, S.slew), lmi: u.dyn.lmi, Lb: S.Lb, angDeg: (S.ang * 180) / Math.PI,
      tower: !!T.tower, cut: u.cut, expert: settings.experto,
    };
  }

  /** Quita los oyentes del bus y deja la cámara sin piezas ocultas de esta partida */
  dispose() {
    for (const f of this.off) f();
    this.off.length = 0;
    if (this.fx?.raining) this.setRain(false);
    this.fx?.dispose();
    this.daylight?.dispose();
    this.cabScreen.dispose();
    this.aids.dispose();
    this.pip.dispose();
    this.toast.dispose();
    this.safety.dispose();
  }
}
