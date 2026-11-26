// Fase 19: Escuela de operadores. Seis lecciones cortas con la AT 60 para alguien que nunca ha manejado una grúa.
// Sin three.js ni Rapier: cada lección es una obra (un `Level` de los de siempre: arranque, cargas, zonas, viento),
// el estado inicial de la grúa, los aros (adonde llevar la cabeza de la pluma) y una lista de pasos con su objetivo.
// Los textos van en i18n (t.school.lessons, en el mismo orden); aquí solo las teclas y la comprobación.
// Las posiciones de las cargas, zonas y aros salen de la cinemática de la grúa (headPos con su pose), así quedan
// justo debajo de la cabeza o donde llega con un giro dado. Aproximación del juego: la referencia no tiene escuela.

import { CRANES, type CraneId, type CraneSpec } from '../crane/cranes';
import { headPos, initialState, tipPos, type CraneState } from '../crane/kinematics';
import { baseConfig, type CraneConfig } from '../crane/stability';
import { supportMode } from '../crane/ops';
import { apply, carrierPose, type V3 } from '../crane/pose';
import { inZone, placeCrane, type Placed } from '../levels/setup';
import type { Level, LevelCrate, LevelZone } from '../levels/levels';
import type { Action } from '../ui/keys';

const D2R = Math.PI / 180;

/** Aro en el aire: la cabeza de la pluma tiene que entrar (centro y radio, m) */
export interface Ring { x: number; y: number; z: number; r: number }

/** Una carga tal como la ven los pasos: planta, fondo e inclinación (Placed) y si está apoyada */
export interface LoadView { label: string; p: Placed; resting: boolean }

/** Lo que miran los pasos (lo arma SchoolRules desde la sesión y la física después de cada paso) */
export interface SchoolView {
  S: CraneState;
  /** LMI dinámico (0…1+) y corte del LMI en este paso */
  lmi: number;
  cut: boolean;
  /** Veces que se cambió de cámara (V) en la lección */
  views: number;
  /** Cabeza de la pluma en el mundo */
  head: V3;
  /** Carga enganchada (etiqueta) o null */
  attached: string | null;
  loads: LoadView[];
  /** La carga frágil tocó algo demasiado rápido desde que se izó por última vez */
  hard: boolean;
}

export interface LessonStep {
  /** Teclas que se resaltan en este paso */
  keys: Action[];
  done(v: SchoolView, L: Lesson): boolean;
}

export interface Lesson {
  /** 1…6 */
  n: number;
  /** La obra de la lección (no está en LEVELS: no cuenta como nivel) */
  site: Level;
  rings: Ring[];
  /** Estado inicial de la grúa (ya colocada en site.start) */
  setup(T: CraneSpec, S: CraneState, C: CraneConfig): void;
  steps: LessonStep[];
  /** Exámenes de licencia (fase 22): la grúa del examen y la familia que da */
  crane?: CraneId;
  license?: 'ruedas' | 'orugas' | 'torre';
}

/** Grúa de la escuela */
export const SCHOOL_CRANE = 'medium' as const;

/** Radio de los aros (m) */
export const RING_R = 1.5;
/** Fragilidad de la caja de vidrio (m/s): la del nivel 6 */
export const GLASS = 0.5;

// --- ayudas para escribir las comprobaciones ---

const stopped = (v: SchoolView) => Math.abs(v.S.vd) < 0.05;
const inRect = (x: number, z: number, r: LevelZone, m = 0) => Math.abs(x - r.x) <= r.w / 2 - m && Math.abs(z - r.z) <= r.d / 2 - m;
const load = (v: SchoolView, label: string) => v.loads.find((l) => l.label === label);
/** La carga va enganchada con el fondo a más de h m del suelo */
const liftedAbove = (v: SchoolView, label: string, h: number) => v.attached === label && (load(v, label)?.p.bottom ?? 0) > h;
/** La carga está apoyada y entera dentro de la zona (inZone de los niveles) */
const setDownIn = (v: SchoolView, label: string, z: LevelZone) => {
  const l = load(v, label);
  return !!l && l.resting && inZone(l.p, z);
};
const inRing = (v: SchoolView, r: Ring) => Math.hypot(v.head.x - r.x, v.head.y - r.y, v.head.z - r.z) < r.r;

// --- obra de prácticas ---

/** Obra plana de la escuela (84 × 56 m como los niveles de la referencia), sin obstáculos */
function site(start: { x: number; z: number }, extra: Partial<Level> = {}): Level {
  return {
    name: 'Escuela', type: 'Escuela', par: 0, wind: [0, 0, 0], ground: '#3b3d41', cranes: [SCHOOL_CRANE], rec: SCHOOL_CRANE, why: {},
    start: { ...start, h: 0 }, brief: '', tips: [], boxes: [], crates: [], zones: [], ...extra,
  };
}

/** Grúa en su sitio y con los estabilizadores apoyados (como `rigged` del tándem) */
function onOutriggers(S: CraneState) { S.out = S.outT = 1; }

/** Estado de la grúa de una lección antes de empezar (para calcular dónde van las cargas y los aros) */
function preview(T: CraneSpec, L: Level, setup: Lesson['setup']) {
  const S = initialState(T), C = baseConfig(T);
  placeCrane(T, S, L);
  setup(T, S, C);
  return S;
}

/** Cabeza de la pluma en el mundo con el giro, el ángulo y el largo dados (la grúa como en S) */
function headAt(T: CraneSpec, S: CraneState, slewDeg: number, angDeg: number, Lb: number): V3 {
  const s = { ...S, slew: slewDeg * D2R, ang: angDeg * D2R, Lb };
  return apply(carrierPose(T, s, supportMode(s, T)), headPos(T, s));
}

/** Pluma y gancho: con el gancho colgando `gap` m por encima de `top` (gancho de 1 m, como aimHead) */
function boomAt(T: CraneSpec, S: CraneState, slewDeg: number, angDeg: number, Lb: number, top: number, gap: number) {
  S.slew = slewDeg * D2R; S.ang = angDeg * D2R; S.Lb = Lb;
  const h = headAt(T, S, slewDeg, angDeg, Lb);
  S.cable = Math.max(1, h.y - (top + gap) - 1);
}

const crate = (x: number, z: number, w: number, d: number, h: number, m: number, label: string, color: string, kind: string, fragile?: number): LevelCrate =>
  ({ x, z, w, d, h, m, label, color, kind, ...(fragile ? { fragile } : {}) });
const zone = (p: V3, w: number, d: number, label = 'ZONA'): LevelZone => ({ x: p.x, z: p.z, w, d, y: 0, label });

// --- las seis lecciones ---

/** 1. Cámara y conducción: cambiar de cámara, avanzar hasta un rectángulo y parar, girar hasta otro */
function lesson1(): Lesson {
  const A: LevelZone = { x: 34, z: 28, w: 10, d: 6, y: 0, label: 'PARA' };
  const B: LevelZone = { x: 64, z: 15, w: 12, d: 10, y: 0, label: 'PARA' };
  return {
    n: 1, site: site({ x: 8, z: 28 }, { zones: [A, B] }), rings: [], setup: () => {},
    steps: [
      { keys: ['view'], done: (v) => v.views >= 1 },
      { keys: ['fw', 'bk'], done: (v) => inRect(v.S.x, v.S.z, A) && stopped(v) },
      { keys: ['stl', 'str', 'fw', 'bk'], done: (v) => inRect(v.S.x, v.S.z, B) && stopped(v) },
    ],
  };
}

/** 2. Estabilizadores: sacarlos, recogerlos y volver a sacarlos */
function lesson2(): Lesson {
  return {
    n: 2, site: site({ x: 30, z: 28 }), rings: [], setup: () => {},
    steps: [
      { keys: ['outriggers'], done: (v) => v.S.out >= 1 },
      { keys: ['outriggers'], done: (v) => v.S.out <= 0 && v.S.outT === 0 },
      { keys: ['outriggers'], done: (v) => v.S.out >= 1 },
    ],
  };
}

/** 3. Pluma: subir, girar, telescopar y los tres a la vez, con la cabeza dentro de cada aro */
function lesson3(T: CraneSpec): Lesson {
  const setup: Lesson['setup'] = (_T, S) => { onOutriggers(S); S.ang = 25 * D2R; S.Lb = T.boom.min; S.slew = 0; };
  const L = site({ x: 30, z: 34 });
  const S = preview(T, L, setup);
  const ring = (slew: number, ang: number, Lb: number): Ring => ({ ...headAt(T, S, slew, ang, Lb), r: RING_R });
  const rings = [ring(0, 55, T.boom.min), ring(90, 55, T.boom.min), ring(90, 55, 20), ring(180, 40, 15)];
  return {
    n: 3, site: L, rings, setup,
    steps: [
      { keys: ['lu', 'ld'], done: (v, l) => inRing(v, l.rings[0]) },
      { keys: ['sll', 'slr'], done: (v, l) => inRing(v, l.rings[1]) },
      { keys: ['to', 'ti'], done: (v, l) => inRing(v, l.rings[2]) },
      { keys: ['sll', 'slr', 'lu', 'ld', 'to', 'ti', 'fine'], done: (v, l) => inRing(v, l.rings[3]) },
    ],
  };
}

/** 4. Enganchar un palé, izarlo, llevarlo a la zona de atrás, apoyarlo y soltarlo */
function lesson4(T: CraneSpec): Lesson {
  const ang = 40, Lb = 13, h = 1;
  const setup: Lesson['setup'] = (_T, S) => { onOutriggers(S); boomAt(T, S, 90, ang, Lb, h, 3); };
  const L = site({ x: 30, z: 34 });
  const S = preview(T, L, setup);
  const p = headAt(T, S, 90, ang, Lb), z = zone(headAt(T, S, 180, ang, Lb), 4, 4);
  L.crates = [crate(p.x, p.z, 1.2, 1.2, h, 2, 'PALÉ', '#b07a3f', 'pallet')];
  L.zones = [z];
  return {
    n: 4, site: L, rings: [], setup,
    steps: [
      { keys: ['hd', 'hook'], done: (v) => v.attached === 'PALÉ' },
      { keys: ['hu'], done: (v) => liftedAbove(v, 'PALÉ', 2) },
      { keys: ['sll', 'slr', 'hd'], done: (v) => setDownIn(v, 'PALÉ', z) },
      { keys: ['hook'], done: (v) => !v.attached && setDownIn(v, 'PALÉ', z) },
    ],
  };
}

/** 5. LMI y radio: con 15 t de lado, alargar la pluma hasta el aviso del 90 % y el corte; después dejarla detrás, más cerca */
function lesson5(T: CraneSpec): Lesson {
  const ang = 60, Lb = 16, h = 1.2;
  const setup: Lesson['setup'] = (_T, S) => { onOutriggers(S); boomAt(T, S, 90, ang, Lb, h, 2.5); };
  const L = site({ x: 30, z: 34 });
  const S = preview(T, L, setup);
  const p = headAt(T, S, 90, ang, Lb), z = zone(headAt(T, S, 180, ang, 18), 4, 4);
  L.crates = [crate(p.x, p.z, 1.6, 1.6, h, 15, 'BLOQUE', '#8d9196', 'block')];
  L.zones = [z];
  return {
    n: 5, site: L, rings: [], setup,
    steps: [
      { keys: ['hd', 'hook', 'hu'], done: (v) => liftedAbove(v, 'BLOQUE', 1) },
      { keys: ['to'], done: (v) => v.attached === 'BLOQUE' && v.lmi >= 0.9 },
      { keys: ['to'], done: (v) => v.attached === 'BLOQUE' && v.cut },
      { keys: ['ti', 'sll', 'slr', 'hd'], done: (v) => setDownIn(v, 'BLOQUE', z) },
      { keys: ['hook'], done: (v) => !v.attached && setDownIn(v, 'BLOQUE', z) },
    ],
  };
}

/** 6. Viento y movimientos finos: llevar una caja de vidrio a la zona y apoyarla a menos de 0,5 m/s */
function lesson6(T: CraneSpec): Lesson {
  const ang = 55, Lb = 14, h = 2.4;
  const setup: Lesson['setup'] = (_T, S) => { onOutriggers(S); boomAt(T, S, 90, ang, Lb, h, 2.5); };
  // viento suave con ráfagas, del sur (dirección como los niveles)
  const L = site({ x: 30, z: 34 }, { wind: [4, 3, 90] });
  const S = preview(T, L, setup);
  const p = headAt(T, S, 90, ang, Lb), z = zone(headAt(T, S, 180, ang, Lb), 5, 3.4);
  L.crates = [crate(p.x, p.z, 3.2, 1.6, h, 1.6, 'VIDRIO', '#a98454', 'glass', GLASS)];
  L.zones = [z];
  return {
    n: 6, site: L, rings: [], setup,
    steps: [
      { keys: ['hd', 'hook', 'hu'], done: (v) => liftedAbove(v, 'VIDRIO', 3) },
      { keys: ['sll', 'slr', 'fine'], done: (v) => { const l = load(v, 'VIDRIO'); return liftedAbove(v, 'VIDRIO', 0.5) && !!l && inRect(l.p.x, l.p.z, z, 0.8); } },
      { keys: ['fine', 'hd'], done: (v) => !v.hard && setDownIn(v, 'VIDRIO', z) },
      { keys: ['hook'], done: (v) => !v.attached && setDownIn(v, 'VIDRIO', z) },
    ],
  };
}

const T60 = CRANES[SCHOOL_CRANE];
export const LESSONS: Lesson[] = [lesson1(), lesson2(), lesson3(T60), lesson4(T60), lesson5(T60), lesson6(T60)];

// --- exámenes de licencia (fase 22) ---
// Cortos: lo que distingue a la familia y un izaje completo (enganchar, izar, girar, apoyar en la zona y soltar).
// Aproximación del juego: masas y radios elegidos para quedar lejos del corte del LMI (la prueba lo comprueba).

/** Izaje de examen: carga bajo la cabeza con el giro `from`, zona con el giro `to` (grados) */
function examLift(T: CraneSpec, S: CraneState, L: Level, from: number, to: number, m: number, label: string, zw = 5) {
  // donde cuelga el cable (en la grúa torre, el carro; en las demás, la cabeza)
  const tip = (slew: number) => { const s = { ...S, slew: slew * D2R }; return apply(carrierPose(T, s, supportMode(s, T)), tipPos(T, s)); };
  const p = tip(from), q = tip(to);
  L.crates = [crate(p.x, p.z, 1.6, 1.6, 1.2, m, label, '#8d9196', 'block')];
  L.zones = [zone(q, zw, zw)];
  const z = L.zones[0];
  return [
    { keys: ['sll', 'slr', 'hd', 'hook'], done: (v: SchoolView) => v.attached === label },
    { keys: ['hu'], done: (v: SchoolView) => liftedAbove(v, label, 2) },
    { keys: ['sll', 'slr', 'hd', 'fine'], done: (v: SchoolView) => setDownIn(v, label, z) },
    { keys: ['hook'], done: (v: SchoolView) => !v.attached && setDownIn(v, label, z) },
  ] as LessonStep[];
}

/** Ruedas (AT 60): estabilizadores y un izaje de 6 t a un lado y al otro */
function examWheels(): Lesson {
  const T = CRANES.medium, ang = 50, Lb = 16;
  const setup: Lesson['setup'] = (_T, S) => { S.ang = ang * D2R; S.Lb = Lb; S.slew = 0; S.cable = 6; };
  const L = site({ x: 30, z: 30 });
  const S = preview(T, L, setup);
  S.out = 1;
  const steps = examLift(T, S, L, 90, -90, 6, 'EXAMEN');
  return { n: 7, site: L, rings: [], setup, crane: 'medium', license: 'ruedas',
    steps: [{ keys: ['outriggers'], done: (v) => v.S.out >= 1 }, ...steps] };
}

/** Orugas (LR 300): sin estabilizadores; girar en el sitio y un izaje de 12 t con la pluma de celosía */
function examCrawler(): Lesson {
  const T = CRANES.crawler, ang = 62;
  const setup: Lesson['setup'] = (_T, S) => { S.ang = ang * D2R; S.slew = 0; S.cable = Math.max(1, S.cable); };
  const L = site({ x: 20, z: 28 });
  const S = preview(T, L, setup);
  const steps = examLift(T, S, L, 0, 120, 12, 'EXAMEN');
  return { n: 8, site: L, rings: [], setup, crane: 'crawler', license: 'orugas', steps };
}

/** Torre (SK 60): estabilizadores, montaje (M) y un izaje de 1,5 t con el carro */
function examTower(): Lesson {
  const T = CRANES.sk;
  const setup: Lesson['setup'] = () => {};
  const L = site({ x: 20, z: 28 });
  const S = preview(T, L, setup);
  // montada, con el carro a 20 m (después de montar hay que sacarlo con el telescopio)
  S.out = S.outT = 1; S.er = 1; S.erT = 1; S.Lb = 20;
  // zona más grande: con 35 m de cable la carga tarda mucho en dejar de balancearse
  const steps = examLift(T, S, L, 90, -90, 1.5, 'EXAMEN', 9);
  steps[0].keys = ['to', 'ti', 'sll', 'slr', 'hd', 'hook'];
  return { n: 9, site: L, rings: [], setup, crane: 'sk', license: 'torre',
    steps: [{ keys: ['outriggers'], done: (v) => v.S.out >= 1 }, { keys: ['mount'], done: (v) => v.S.er >= 1 }, ...steps] };
}

/** Exámenes de licencia: van detrás de las lecciones (?escuela=7…9) */
export const EXAMS: Lesson[] = [examWheels(), examCrawler(), examTower()];
/** Lecciones y exámenes por número */
export const lessonByN = (n: number) => [...LESSONS, ...EXAMS].find((l) => l.n === n) ?? null;

/** Estado de la lección en la partida (va en las instantáneas: rebobinar lo devuelve atrás también) */
export interface SchoolState {
  /** Paso actual (0…); = steps.length cuando terminó */
  step: number;
  views: number;
  hard: boolean;
  done: boolean;
}

export const newSchool = (): SchoolState => ({ step: 0, views: 0, hard: false, done: false });

