import type * as THREE from 'three';
import { CRANES, type CraneId, type CraneSpec } from '../crane/cranes';
import { initialState, type CraneState } from '../crane/kinematics';
import { baseConfig, type CraneConfig } from '../crane/stability';
import { supportMode, type Dyn } from '../crane/ops';
import { carrierPose, type Pose } from '../crane/pose';
import type { CraneView, ModelFactory } from '../render/models/load';
import { Rigging } from '../render/rigging';
import { buildSite, TEST_HEAVY, TEST_OBSTACLES, TEST_SOFT } from '../render/site';
import { buildLevelSite } from '../render/levelSite';
import { decorFor, type Decor } from '../decor/layout';
import { terrainFor } from '../terrain/build';
import { terrainMeshes } from '../render/terrainView';
import type { Terrain } from '../terrain/terrain';
import { groundFit } from '../crane/ground';
import { TRUCK_IDS } from '../render/models/layout';
import { Physics } from '../physics/world';
import { levelBounds, placeCrane, populate } from '../levels/setup';
import { ALL_LEVELS as LEVELS, TANDEM_IDS, TEST_COLUMN, placeTandem, tandemColumn } from '../levels/tandemSetup';
import type { Level } from '../levels/levels';
import { Bus, type GameEvents } from './events';
import { t } from '../i18n';

/** Grúas del menú: las de ruedas (fase 4), la grúa torre sobre camión (fase 8) y las de orugas (fase 6) */
export const MENU_IDS: CraneId[] = [...TRUCK_IDS, 'crawler', 'lr'];

/**
 * Una grúa en la obra: datos, estado, configuración de montaje, modelo 3D, física y lo que se mide de ella.
 * Normalmente hay una; en el tándem (fase 10) dos, en el mismo mundo de Rapier, y Tab cambia la que se maneja.
 */
export interface Unit {
  /** Posición en `Session.units` (la llevan los eventos) */
  i: number;
  id: CraneId;
  T: CraneSpec;
  S: CraneState;
  C: CraneConfig;
  crane: CraneView;
  phys: Physics;
  rig: Rigging;
  pose: Pose;
  dyn: Dyn;
  cut: boolean;
  cutMsg: boolean;
  /** Tiempo desde el vuelco: el cartel sale después, para ver caer la grúa */
  tipClock: number;
  tipText: string;
  /** Plumín abatible permitido (nivel "Sobre la nave" y prueba libre) */
  jibOk: boolean;
  /** Nivel de tándem: tiempo seguido con el LMI por encima del 100 % y con el cable inclinado más del límite (s) */
  over: number;
  side: number;
  /** Ángulo del cable con la vertical (rad) */
  sideAng: number;
}

/**
 * Estado del turno en un nivel: tiempo, terminado, aterrizajes duros, golpes, alarmas de línea, LMI máximo con la
 * carga colgada. (parte B) bumpCd: espera entre golpes; lineD: margen a la línea eléctrica más cercana; inProx: dentro
 * de la alarma; wind: viento actual (m/s).
 */
export interface Run {
  t: number; done: boolean; hard: number; bumps: number; prox: number; maxLmi: number;
  bumpCd: number; lineD: number; inProx: boolean; wind: number;
}

export const newRun = (): Run => ({ t: 0, done: false, hard: 0, bumps: 0, prox: 0, maxLmi: 0, bumpCd: 0, lineD: Infinity, inProx: false, wind: 0 });

/** Qué se juega, sacado de la URL */
export interface SessionDef {
  /** Nivel 1…14, o 0 sin nivel */
  nivel: number;
  /** Índice en LEVELS (−1 sin nivel) */
  li: number;
  L: Level | null;
  /** Prueba libre del tándem (?tandem=1) */
  freeTandem: boolean;
  /** Tándem: la prueba libre o el nivel 14 */
  tandem: boolean;
  /** Menú de niveles (sin parámetros) */
  showMenu: boolean;
  ids: CraneId[];
}

/**
 * ?nivel=1…14: un nivel (con ?grua= una de las permitidas; si no, la recomendada).
 * ?grua=id o ?libre=1: prueba libre con los obstáculos de prueba. ?tandem=1: prueba libre del tándem (dos grúas).
 * Sin parámetros: menú de niveles (con la AT 60 de fondo).
 */
export function sessionDef(search: string): SessionDef {
  const params = new URLSearchParams(search);
  const nivel = Number(params.get('nivel')) || 0;
  const li = nivel >= 1 && nivel <= LEVELS.length ? nivel - 1 : -1;
  const L = li >= 0 ? LEVELS[li] : null;
  const freeTandem = !L && params.has('tandem');
  const tandem = freeTandem || !!L?.tandem;
  const showMenu = !L && !freeTandem && !params.has('grua') && !params.has('libre');
  const q = params.get('grua') as CraneId | null;
  const ids: CraneId[] = L?.tandem ? [L.tandem.main.id, L.tandem.tail.id] : freeTandem ? [...TANDEM_IDS]
    : [L ? (q && L.cranes.includes(q) ? q : L.rec) : q && MENU_IDS.includes(q) ? q : 'medium'];
  return { nivel, li, L, freeTandem, tandem, showMenu, ids };
}

/** Suelo bajo el chasis en su sitio (gy, gb, gc, gspread de CraneState) */
export function groundState(T: CraneSpec, S: CraneState, terrain: Terrain) {
  const g = groundFit(T, (x, z) => terrain.height(x, z), S.x, S.z, S.h);
  return { gy: g.y, gb: g.b, gc: g.c, gspread: g.spread };
}

/**
 * Una partida: las grúas (estado, física, modelos), la obra, la grúa que se maneja, si el turno corre y el estado
 * del turno. Lo crea main.ts a partir de la URL. Emite sus eventos por `bus`.
 */
export class Session {
  readonly def: SessionDef;
  readonly L: Level | null;
  readonly units: Unit[] = [];
  readonly multi: boolean;
  /** Decorado de fondo (fase 17); lo dibuja el Presenter */
  readonly decor: Decor;
  /** Terreno (fase 18): plano en los niveles; meseta de prueba en la prueba libre; colinas del horizonte */
  readonly terrain: Terrain;
  readonly bus = new Bus<GameEvents>();
  /** Grúa que se maneja (Tab la cambia en el tándem) */
  act: Unit;
  /** El turno corre (no hay ficha, menú ni cartel abiertos) */
  running: boolean;
  /** Puenteo del LMI (tecla P): sin cortes, para poder probar el vuelco */
  bypass = false;
  run: Run = newRun();

  /** makeModel: los modelos 3D (`loadModels` en el juego, `allModels` en las pruebas) */
  constructor(def: SessionDef, scene: THREE.Scene, makeModel: ModelFactory) {
    this.def = def;
    const L = (this.L = def.L);
    // Estado de cada grúa y su colocación
    const states = def.ids.map((id) => {
      const T = CRANES[id];
      return { id, T, S: initialState(T), C: baseConfig(T) };
    });
    this.place(states);
    // decorado de fondo (fase 17) y terreno (fase 18): el terreno sale del decorado (colinas más allá de todo)
    this.decor = decorFor(def.nivel, L);
    this.terrain = terrainFor(this.decor, !L && !def.freeTandem);
    for (const { T, S } of states) Object.assign(S, groundState(T, S, this.terrain));

    // Física: la primera grúa crea el mundo; la segunda lo comparte
    for (const st of states) {
      const { T, S } = st;
      const pose = carrierPose(T, S, supportMode(S, T));
      const phys = this.units.length ? new Physics(T, S, pose, { site: this.units[0].phys })
        : new Physics(T, S, pose, L ? { testLoad: false, bounds: levelBounds(L) } : def.freeTandem ? { testLoad: false } : {});
      const crane = makeModel(T);
      scene.add(crane.root);
      this.units.push({
        ...st, i: this.units.length, crane, phys, pose, rig: null as unknown as Rigging, dyn: { u: 0, edge: 0, lmi: 0 }, cut: false,
        cutMsg: false, tipClock: -1, tipText: '', jibOk: !!T.jibDef && !def.tandem && (!L || !!L.jib), over: 0, side: 0, sideAng: 0,
      });
    }
    const site = this.units[0].phys;
    site.addTerrain(this.terrain);
    for (const m of terrainMeshes(this.terrain)) scene.add(m);
    if (L) {
      populate(site, L);
      buildLevelSite(scene, L);
    } else if (def.freeTandem) {
      const c = TEST_COLUMN;
      site.addLoad(c.label, c.mass, c.half, c.pos, { lugs: c.lugs, color: '#9aa3aa', kind: 'vessel' });
      buildSite(scene, site.obstacles, site.softs);
    } else {
      const T = this.units[0].T;
      for (const o of TEST_OBSTACLES) site.addObstacle(o);
      // carga pesada de prueba para la LR 3000
      if (T.superlift) site.addLoad(TEST_HEAVY.label, TEST_HEAVY.mass, TEST_HEAVY.half, TEST_HEAVY.pos);
      site.softs.push(...TEST_SOFT);
      buildSite(scene, site.obstacles, site.softs);
    }
    // decorado de fondo (fase 17): sus colisionadores (solo para la carga y el gancho), después de la obra
    site.addDecor(this.decor.kit.solids);
    // el aparejo de la primera grúa dibuja las cargas (después de crearlas)
    this.units.forEach((u, i) => { u.rig = new Rigging(scene, u.phys, u.T, i === 0); });
    this.act = this.units[0];
    this.multi = this.units.length > 1;
    this.running = !L && !def.showMenu;
  }

  /** Coloca las grúas (niveles y tándem; en el tándem, con los montajes hechos) */
  private place(states: { T: CraneSpec; S: CraneState; C: CraneConfig }[]) {
    const { L, freeTandem } = this.def;
    if (L?.tandem) placeTandem(states[0], states[1], L.tandem, tandemColumn(L));
    else if (freeTandem) placeTandem(states[0], states[1]);
    else if (L) placeCrane(states[0].T, states[0].S, L);
  }

  /** La grúa volcó */
  tipped(u = this.act) { return u.phys.tipped !== null; }

  /** Hay carga colgando del gancho (con orejetas siempre cuenta, aunque se apoye) */
  hanging(u = this.act) {
    const a = u.phys.attached;
    return !!a && (!!a.lugs || !u.phys.isResting(a));
  }

  /** Carga que cuenta en el gancho: en el tándem, su parte (medida); si no, toda */
  loadOnHook(u: Unit) {
    const att = u.phys.attached;
    if (!att) return 0;
    return u.phys.slingShare() ?? att.mass;
  }

  /** Las teclas actúan solo con el turno en marcha (no con la ficha o un cartel abiertos) y la grúa de pie */
  live() { return this.running && !this.tipped(); }

  /** Tab: la siguiente grúa del tándem */
  switchUnit() {
    this.act = this.units[(this.units.indexOf(this.act) + 1) % this.units.length];
    return this.act;
  }

  /** Reiniciar: estado inicial (sin lastre ni Y-guy; tándem: con los montajes hechos) */
  restart() {
    for (const u of this.units) {
      Object.assign(u.S, initialState(u.T));
      Object.assign(u.C, baseConfig(u.T));
    }
    this.place(this.units);
    for (const u of this.units) {
      u.pose = carrierPose(u.T, u.S, supportMode(u.S, u.T));
      u.phys.reset(u.S, u.pose);
      u.dyn = { u: 0, edge: 0, lmi: 0 };
      u.tipClock = -1;
    }
    this.bypass = false;
    this.bus.emit('restart', {});
    this.bus.emit('say', { text: t.msg.restarted, s: 1.5 });
  }
}
