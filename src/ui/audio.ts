// Sonidos simples (fase 11), sintetizados con Web Audio: sin archivos.
// - motor: zumbido grave que sube de tono al conducir o al mover la grúa;
// - cabrestante: silbido cuando el cable sube o baja (R/F);
// - alarma del LMI: pitido intermitente desde el 90 %, rápido en el corte (≥ 100 % o corte);
// - alarma de proximidad a líneas eléctricas: pitido agudo y rápido;
// - golpe sordo al apoyar o golpear la carga.
// soundTargets() decide qué suena (sin Web Audio, para probarlo); Sound lo sintetiza.
// Fase 16: sonido 3D (PannerNode). El motor suena desde el chasis, el cabrestante desde la superestructura y los golpes
// desde la carga; el oyente es la cámara. En el tándem, la otra grúa suena al ralentí desde su sitio. Las alarmas no
// tienen sitio (son de la cabina).

export interface SoundInput {
  /** velocidad de marcha (m/s, con signo) */
  speed: number;
  /** mandos de la grúa en uso (giro, pluma, telescopio, plumín, superlift, montajes) 0…1 */
  work: number;
  /** cable subiendo o bajando, 0…1 */
  hoist: number;
  /** LMI (fracción) */
  lmi: number;
  /** corte del LMI activo */
  cut: boolean;
  /** dentro de la alarma de una línea eléctrica */
  prox: boolean;
  /** grúa volcada o turno parado: solo silencio */
  off: boolean;
}

export type Alarm = 'none' | 'warn' | 'cut';

export interface SoundTargets {
  engineGain: number;
  engineHz: number;
  winchGain: number;
  winchHz: number;
  lmi: Alarm;
  prox: boolean;
}

/** Umbral del aviso del LMI (el HUD lo pinta en ámbar desde aquí) */
export const LMI_WARN = 0.9;

export function soundTargets(i: SoundInput): SoundTargets {
  if (i.off) return { engineGain: 0, engineHz: 38, winchGain: 0, winchHz: 180, lmi: 'none', prox: false };
  const drive = Math.min(1, Math.abs(i.speed) / 4);
  const load = Math.max(drive, Math.min(1, i.work), Math.min(1, i.hoist) * 0.8);
  return {
    engineGain: 0.05 + 0.1 * load,
    engineHz: 38 + 30 * load,
    winchGain: 0.06 * Math.min(1, i.hoist),
    winchHz: 180 + 60 * Math.min(1, i.hoist),
    lmi: i.cut || i.lmi >= 1 ? 'cut' : i.lmi >= LMI_WARN ? 'warn' : 'none',
    prox: i.prox,
  };
}

/** Patrón de pitido: [periodo, encendido] en segundos */
const BEEP: Record<Exclude<Alarm, 'none'> | 'prox', [number, number, number]> = {
  warn: [1, 0.25, 1650],
  cut: [0.3, 0.15, 1900],
  prox: [0.22, 0.11, 1250],
};

/** Encendido del pitido en el instante t (s) */
export function beepOn(kind: keyof typeof BEEP, t: number) {
  const [p, on] = BEEP[kind];
  return t % p < on;
}

export interface V3 { x: number; y: number; z: number }

/** Dónde suena cada cosa (mundo, m) */
export interface SoundAt {
  engine: V3;
  winch: V3;
  /** tándem: la otra grúa (solo motor al ralentí) */
  other?: V3 | null;
}

/** Distancia hasta la que un sonido se oye entero (m); más lejos baja como ref / (ref + (d − ref)) */
export const REF_ENGINE = 25;
export const REF_WINCH = 18;
export const REF_THUMP = 20;

/** Ganancia de un sonido a `d` m con el modelo 'inverse' de Web Audio (rolloff 1), para las pruebas */
export function distanceGain(d: number, ref: number) {
  return ref / (ref + Math.max(0, d - ref));
}

function place(p: PannerNode, v: V3) {
  if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z);
}

export class Sound {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private engine!: { a: OscillatorNode; b: OscillatorNode; g: GainNode };
  private winch!: { o: OscillatorNode; g: GainNode };
  private beep!: { o: OscillatorNode; g: GainNode };
  private other!: { o: OscillatorNode; g: GainNode; p: PannerNode };
  private pe!: PannerNode;
  private pw!: PannerNode;
  private t = 0;

  constructor(private on: boolean, private volume: number) {
    // Los navegadores solo dejan empezar el audio tras un gesto del jugador
    const start = () => { this.ensure(); removeEventListener('keydown', start); removeEventListener('pointerdown', start); };
    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
  }

  get enabled() { return this.on; }

  /** N: silenciar o volver a oír */
  toggle() {
    this.on = !this.on;
    if (this.ac) this.master.gain.setTargetAtTime(this.on ? this.volume : 0, this.ac.currentTime, 0.05);
    return this.on;
  }

  private ensure() {
    if (this.ac) { if (this.ac.state === 'suspended') void this.ac.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = (this.ac = new Ctor());
    this.master = ac.createGain();
    this.master.gain.value = this.on ? this.volume : 0;
    this.master.connect(ac.destination);

    // motor: diente de sierra + cuadrada a media frecuencia, filtro paso bajo
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const eg = ac.createGain();
    eg.gain.value = 0;
    const a = ac.createOscillator(), b = ac.createOscillator();
    a.type = 'sawtooth';
    b.type = 'square';
    a.frequency.value = 38;
    b.frequency.value = 19;
    const bg = ac.createGain();
    bg.gain.value = 0.5;
    a.connect(lp);
    b.connect(bg).connect(lp);
    this.pe = this.panner(REF_ENGINE);
    lp.connect(eg).connect(this.pe).connect(this.master);
    a.start();
    b.start();
    this.engine = { a, b, g: eg };

    // cabrestante: triangular filtrada
    const wl = ac.createBiquadFilter();
    wl.type = 'bandpass';
    wl.frequency.value = 600;
    wl.Q.value = 0.7;
    const wo = ac.createOscillator(), wg = ac.createGain();
    wo.type = 'sawtooth';
    wo.frequency.value = 180;
    wg.gain.value = 0;
    this.pw = this.panner(REF_WINCH);
    wo.connect(wl).connect(wg).connect(this.pw).connect(this.master);
    wo.start();
    this.winch = { o: wo, g: wg };

    // tándem: motor de la otra grúa al ralentí, desde su sitio (fase 16)
    const ol = ac.createBiquadFilter();
    ol.type = 'lowpass';
    ol.frequency.value = 280;
    const oo = ac.createOscillator(), og = ac.createGain(), op = this.panner(REF_ENGINE);
    oo.type = 'sawtooth';
    oo.frequency.value = 36;
    og.gain.value = 0;
    oo.connect(ol).connect(og).connect(op).connect(this.master);
    oo.start();
    this.other = { o: oo, g: og, p: op };

    // pitidos: una sola onda cuadrada que se enciende y apaga
    const bo = ac.createOscillator(), bgn = ac.createGain();
    bo.type = 'square';
    bgn.gain.value = 0;
    bo.connect(bgn).connect(this.master);
    bo.start();
    this.beep = { o: bo, g: bgn };
  }

  private panner(ref: number) {
    const p = this.ac!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 5000;
    return p;
  }

  /** El oyente: la cámara (posición, hacia dónde mira y su arriba) */
  listen(pos: V3, fwd: V3, up: V3) {
    const ac = this.ac;
    if (!ac) return;
    const l = ac.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Cada cuadro, con el estado de la grúa que se maneja y dónde suena cada cosa */
  update(dt: number, i: SoundInput, at?: SoundAt) {
    const ac = this.ac;
    if (!ac) return;
    this.t += dt;
    const s = soundTargets(i), now = ac.currentTime;
    if (at) {
      place(this.pe, at.engine);
      place(this.pw, at.winch);
      if (at.other) place(this.other.p, at.other);
    }
    this.other.g.gain.setTargetAtTime(at?.other && !i.off ? 0.05 : 0, now, 0.2);
    this.engine.g.gain.setTargetAtTime(s.engineGain, now, 0.15);
    this.engine.a.frequency.setTargetAtTime(s.engineHz, now, 0.3);
    this.engine.b.frequency.setTargetAtTime(s.engineHz / 2, now, 0.3);
    this.winch.g.gain.setTargetAtTime(s.winchGain, now, 0.08);
    this.winch.o.frequency.setTargetAtTime(s.winchHz, now, 0.2);
    // el LMI manda sobre la línea eléctrica (las dos a la vez se confundirían)
    const kind = s.lmi !== 'none' ? s.lmi : s.prox ? 'prox' : null;
    const on = kind ? beepOn(kind, this.t) : false;
    if (kind) this.beep.o.frequency.setValueAtTime(BEEP[kind][2], now);
    this.beep.g.gain.setTargetAtTime(on ? 0.05 : 0, now, 0.005);
  }

  /** Golpe sordo (v = velocidad del golpe, m/s), desde `at` si se sabe dónde fue */
  thump(v: number, at?: V3) {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime, len = 0.25;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.exp((-k / ac.sampleRate) * 18);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = ac.createGain();
    g.gain.value = Math.min(0.9, 0.25 + 0.4 * v);
    if (at) {
      const p = this.panner(REF_THUMP);
      place(p, at);
      src.connect(lp).connect(g).connect(p).connect(this.master);
      src.onended = () => p.disconnect();
    } else src.connect(lp).connect(g).connect(this.master);
    src.start(now);
  }
}
