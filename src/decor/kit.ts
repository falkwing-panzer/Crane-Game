// Fase 17: piezas del decorado (sin three.js). Cada pieza (caseta, excavadora, árbol, edificio…) se describe con
// primitivas en el mundo: cajas giradas alrededor de la vertical, cilindros (o conos) entre dos puntos y tejados a
// dos aguas. `render/decorView.ts` las fusiona en pocas mallas. Formas simples, sin marcas. Todo es aproximación
// visual: la referencia no tiene decorado.

export type P3 = [number, number, number];
/** Capa: cerca (con sombra y colisionadores), lejos (sin sombra) y detalle (pequeño, se oculta de lejos) */
export type Layer = 'near' | 'far' | 'detail';

export type Prim =
  | { k: 'box'; c: string; x: number; y: number; z: number; sx: number; sy: number; sz: number; r: number }
  | { k: 'cyl'; c: string; a: P3; b: P3; r0: number; r1: number; seg: number }
  /** tejado a dos aguas: base (x, y, z) en el centro, cumbrera a lo largo del eje x local, alto sy */
  | { k: 'gable'; c: string; x: number; y: number; z: number; sx: number; sy: number; sz: number; r: number };

/** Caja de choque (colisionador estático): centro, medios lados y giro alrededor de la vertical */
export interface Solid { x: number; y: number; z: number; hx: number; hy: number; hz: number; r: number }

/** Tramo de valla de malla (de a a b, alto h) */
export interface FenceSeg { a: [number, number]; b: [number, number]; h: number }

/** Colores del decorado */
export const DC = {
  white: '#d9dcd6', offWhite: '#c9ccc4', blue: '#3c6f9a', toiletBlue: '#2f7fb8', toiletGreen: '#3f8a52',
  glass: '#3d5566', dark: '#2e3236', black: '#1b1d20', grey: '#8d9296', greyLight: '#b4b8b9', greyDark: '#5f6468',
  concrete: '#a7a399', wood: '#9b7a4c', woodDark: '#6e5638', rust: '#7b4a2e', yellow: '#d9a326', orange: '#e2702a',
  red: '#b63a2c', green: '#4f7a4a', lamp: '#f1ead0', trunk: '#5a4632', leaf: '#4d6b35', leafDark: '#3a5629',
  pine: '#35502e', tarp: '#3f5f4a', steel: '#9aa2aa', tank: '#cdd0d3', pipeY: '#c9a23a', pipeG: '#6f8a72', roof: '#7c8287',
};

export class Kit {
  near: Prim[] = [];
  far: Prim[] = [];
  detail: Prim[] = [];
  solids: Solid[] = [];
  fence: FenceSeg[] = [];
  /** Capa de lo que se añade (la fija quien coloca, según la distancia a la obra) */
  layer: Layer = 'near';
  /** Las cajas y los cilindros verticales de lo que se añade son colisionadores */
  solid = true;
  private ox = 0;
  private oz = 0;
  private rot = 0;
  private c = 1;
  private s = 0;

  /** Marco local: origen (x, z) y giro r (mismo sentido que three.js: x' = x cos r + z sin r, z' = −x sin r + z cos r) */
  at(x: number, z: number, r: number, fn: () => void) {
    const save = [this.ox, this.oz, this.rot, this.c, this.s] as const;
    const [wx, wz] = this.w(x, z);
    this.ox = wx; this.oz = wz; this.rot += r;
    this.c = Math.cos(this.rot); this.s = Math.sin(this.rot);
    try { fn(); } finally { [this.ox, this.oz, this.rot, this.c, this.s] = save; }
  }

  /** Lo que se añade dentro de `fn` es detalle (sin colisionador; desaparece en la capa lejana) */
  det(fn: () => void) {
    const was = this.layer;
    if (was === 'near') this.layer = 'detail';
    const ws = this.solid;
    this.solid = false;
    try { if (was !== 'far') fn(); } finally { this.layer = was; this.solid = ws; }
  }

  /** Sin colisionadores (por ejemplo, la copa de un árbol: choca el tronco) */
  ghost(fn: () => void) {
    const ws = this.solid;
    this.solid = false;
    try { fn(); } finally { this.solid = ws; }
  }

  /** Punto local → mundo */
  w(x: number, z: number): [number, number] {
    return [this.ox + this.c * x + this.s * z, this.oz - this.s * x + this.c * z];
  }

  private list() { return this[this.layer]; }

  box(c: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    if (sx < 1e-3 || sy < 1e-3 || sz < 1e-3) return;
    const [x, z] = this.w((x0 + x1) / 2, (z0 + z1) / 2);
    const y = (y0 + y1) / 2;
    this.list().push({ k: 'box', c, x, y, z, sx, sy, sz, r: this.rot });
    if (this.solid && this.layer === 'near' && sy > 0.3) this.solids.push({ x, y, z, hx: sx / 2, hy: sy / 2, hz: sz / 2, r: this.rot });
  }

  /** Cilindro (o cono, r1 ≠ r0) entre a y b en el marco local. Vertical y sólido: colisionador cuadrado */
  cyl(c: string, a: P3, b: P3, r0: number, r1 = r0, seg = 8) {
    const [ax, az] = this.w(a[0], a[2]), [bx, bz] = this.w(b[0], b[2]);
    this.list().push({ k: 'cyl', c, a: [ax, a[1], az], b: [bx, b[1], bz], r0, r1, seg });
    const vertical = Math.hypot(bx - ax, bz - az) < 1e-6;
    const r = Math.max(r0, r1);
    if (this.solid && this.layer === 'near' && vertical && r > 0.15 && Math.abs(b[1] - a[1]) > 0.3) {
      this.solids.push({ x: ax, y: (a[1] + b[1]) / 2, z: az, hx: r, hy: Math.abs(b[1] - a[1]) / 2, hz: r, r: 0 });
    }
  }

  gable(c: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const [wx, wz] = this.w(x, z);
    this.list().push({ k: 'gable', c, x: wx, y, z: wz, sx, sy, sz, r: this.rot });
  }

  /** Tramo de valla en el marco local */
  fenceRun(x0: number, z0: number, x1: number, z1: number, h = 2, tarp = false) {
    const a = this.w(x0, z0), b = this.w(x1, z1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) return;
    // malla (se dibuja aparte, con transparencia) o, en la ciudad, paneles con lona
    if (!tarp) this.fence.push({ a, b, h });
    else this.ghost(() => {
      const ux = (x1 - x0) / Math.hypot(x1 - x0, z1 - z0), uz = (z1 - z0) / Math.hypot(x1 - x0, z1 - z0);
      const r = Math.atan2(-uz, ux);
      this.at((x0 + x1) / 2, (z0 + z1) / 2, r, () => {
        this.box(DC.tarp, -len / 2, len / 2, 0.15, h - 0.05, -0.03, 0.03);
        this.det(() => { for (let t = -len / 2; t <= len / 2; t += 3.5) this.box(DC.concrete, t - 0.35, t + 0.35, 0, 0.15, -0.2, 0.2); });
      });
    });
    // postes cada 3,5 m y barra de arriba
    const n = Math.max(1, Math.round(len / 3.5));
    const ws = this.solid;
    this.solid = false;
    for (let i = 0; i <= n; i++) {
      const t = i / n, lx = x0 + (x1 - x0) * t, lz = z0 + (z1 - z0) * t;
      this.cyl(DC.greyDark, [lx, 0, lz], [lx, h + 0.05, lz], 0.045, 0.045, 5);
    }
    this.cyl(DC.greyDark, [x0, h, z0], [x1, h, z1], 0.03, 0.03, 4);
    this.solid = ws;
    if (this.solid && this.layer !== 'far') {
      const r = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      this.solids.push({ x: (a[0] + b[0]) / 2, y: h / 2, z: (a[1] + b[1]) / 2, hx: len / 2, hy: h / 2, hz: 0.08, r });
    }
  }
}

// ——— Piezas (marco local: frente hacia +x, suelo en y = 0) ———

/** Caseta de obra (módulo de oficina de 6 × 2,4 m) */
export function caseta(k: Kit, col = DC.white, stacked = false) {
  const lv = stacked ? 2 : 1;
  for (let i = 0; i < lv; i++) {
    const y = i * 2.75;
    k.box(DC.greyDark, -3, 3, y, y + 0.2, -1.2, 1.2);
    k.box(col, -3, 3, y + 0.2, y + 2.65, -1.2, 1.2);
    k.box(DC.offWhite, -3.05, 3.05, y + 2.65, y + 2.75, -1.25, 1.25);
    k.det(() => {
      for (const wx of [-1.6, 1.3]) k.box(DC.glass, wx - 0.6, wx + 0.6, y + 1.1, y + 2.0, 1.2, 1.23);
      k.box(DC.blue, -0.1, 0.8, y + 0.25, y + 2.2, 1.2, 1.24);
    });
  }
  if (stacked) k.det(() => {
    // escalera exterior al piso de arriba
    for (let j = 0; j < 10; j++) k.box(DC.greyDark, 0.9 + j * 0.2, 1.15 + j * 0.2, 0.25 + j * 0.27, 0.32 + j * 0.27, 1.3, 2.2);
    k.box(DC.greyDark, 2.9, 3.0, 0, 3.8, 1.3, 2.2);
  });
}

/** Baño portátil */
export function bano(k: Kit, col = DC.toiletBlue) {
  k.box(col, -0.58, 0.58, 0, 2.2, -0.58, 0.58);
  k.box(DC.offWhite, -0.64, 0.64, 2.2, 2.32, -0.64, 0.64);
  k.det(() => k.cyl(DC.greyDark, [-0.4, 2.3, -0.4], [-0.4, 2.6, -0.4], 0.05));
}

/** Pila de palés con sacos */
export function pales(k: Kit, n = 3) {
  for (let i = 0; i < n; i++) {
    const y = i * 1.05;
    k.box(DC.wood, -0.6, 0.6, y, y + 0.15, -0.5, 0.5);
    k.box(DC.offWhite, -0.55, 0.55, y + 0.15, y + 1.0, -0.45, 0.45);
  }
}

/** Acopio de tubos sobre durmientes */
export function tubos(k: Kit, len = 6, col = DC.greyDark) {
  for (const x of [-len / 2 + 0.5, len / 2 - 0.5]) k.box(DC.woodDark, x - 0.15, x + 0.15, 0, 0.15, -1.1, 1.1);
  const r = 0.28;
  const rows = [[-0.6, 0, 0.6], [-0.3, 0.3]];
  rows.forEach((row, j) => row.forEach((z) => k.cyl(col, [-len / 2, 0.15 + r + j * r * 1.7, z], [len / 2, 0.15 + r + j * r * 1.7, z], r, r, 8)));
  // los cilindros tumbados no son sólidos: una caja de todo el acopio
  if (k.solid && k.layer === 'near') {
    const [x, z] = k.w(0, 0);
    k.solids.push({ x, y: 0.65, z, hx: len / 2, hy: 0.65, hz: 1.0, r: rotOf(k) });
  }
}

/** Ferralla: paquetes de barras corrugadas sobre durmientes */
export function ferralla(k: Kit, len = 6) {
  for (const x of [-len / 2 + 0.6, 0, len / 2 - 0.6]) k.box(DC.woodDark, x - 0.12, x + 0.12, 0, 0.14, -1.0, 1.0);
  k.box(DC.rust, -len / 2, len / 2, 0.14, 0.45, -0.85, -0.1);
  k.box(DC.rust, -len / 2 + 0.3, len / 2 + 0.3, 0.14, 0.38, 0.1, 0.85);
  k.det(() => { for (let i = 0; i < 6; i++) k.box(DC.rust, -len / 2 - 0.2, len / 2 - 0.4, 0.45, 0.5, -0.8 + i * 0.12, -0.76 + i * 0.12); });
}

/** Torre de focos sobre remolque */
export function foco(k: Kit, h = 8) {
  k.box(DC.yellow, -1.2, 1.2, 0.5, 1.4, -0.55, 0.55);
  k.det(() => { for (const z of [-0.65, 0.65]) k.cyl(DC.black, [0, 0.35, z], [0, 0.35, z + (z > 0 ? 0.2 : -0.2)], 0.35, 0.35, 8); });
  k.cyl(DC.greyLight, [0, 1.4, 0], [0, h, 0], 0.09, 0.07, 6);
  k.box(DC.greyDark, -0.15, 0.15, h - 0.4, h + 0.3, -0.9, 0.9);
  k.det(() => { for (const z of [-0.6, 0, 0.6]) k.box(DC.lamp, 0.15, 0.2, h - 0.3, h + 0.2, z - 0.25, z + 0.25); });
}

/** Cono de señalización (siempre detalle) */
export function cono(k: Kit) {
  k.det(() => {
    k.box(DC.black, -0.2, 0.2, 0, 0.04, -0.2, 0.2);
    k.cyl(DC.orange, [0, 0.04, 0], [0, 0.7, 0], 0.17, 0.03, 7);
  });
}

/** Chasis de camión de obra con cabina (base del volquete y la hormigonera) */
function camionBase(k: Kit, cab: string) {
  k.box(DC.dark, -4.2, 2.4, 0.55, 1.0, -1.0, 1.0);
  k.box(cab, 2.0, 3.7, 0.9, 3.1, -1.22, 1.22);
  k.box(DC.glass, 3.7, 3.74, 2.0, 2.9, -1.1, 1.1);
  k.box(DC.dark, 3.6, 3.85, 0.45, 0.95, -1.25, 1.25);
  for (const x of [-3.3, -2.0, 2.8]) for (const z of [-1.0, 1.0]) k.cyl(DC.black, [x, 0.52, z], [x, 0.52, z + (z > 0 ? 0.42 : -0.42)], 0.52, 0.52, 10);
}

export function volquete(k: Kit) {
  camionBase(k, DC.red);
  k.box(DC.greyDark, -4.3, 1.8, 1.0, 2.6, -1.25, 1.25);
  k.box(DC.grey, -4.25, 1.75, 2.5, 2.65, -1.2, 1.2);
}

export function hormigonera(k: Kit) {
  camionBase(k, DC.white);
  k.cyl(DC.offWhite, [-3.9, 2.0, 0], [-0.4, 2.7, 0], 1.05, 1.15, 12);
  k.cyl(DC.offWhite, [-0.4, 2.7, 0], [1.5, 3.1, 0], 1.15, 0.5, 12);
  k.det(() => k.cyl(DC.greyDark, [-4.2, 2.6, 0], [-4.9, 1.4, 0], 0.25, 0.2, 6));
}

/** Excavadora sobre orugas con el brazo apoyado */
export function excavadora(k: Kit) {
  for (const z of [-1.15, 1.15]) k.box(DC.dark, -1.9, 1.9, 0, 0.8, z - 0.32, z + 0.32);
  k.box(DC.greyDark, -1.2, 1.2, 0.8, 1.05, -0.9, 0.9);
  k.box(DC.yellow, -1.6, 1.3, 1.05, 2.1, -1.2, 1.2);
  k.box(DC.yellow, -1.9, -1.4, 1.05, 2.3, -1.2, 1.2);
  k.box(DC.yellow, 0.2, 1.3, 2.1, 3.3, -1.2, -0.25);
  k.box(DC.glass, 1.3, 1.33, 2.3, 3.2, -1.15, -0.3);
  k.ghost(() => {
    k.cyl(DC.yellow, [1.1, 1.8, 0.4], [3.6, 4.0, 0.4], 0.28, 0.22, 6);
    k.cyl(DC.yellow, [3.6, 4.0, 0.4], [4.8, 1.0, 0.4], 0.22, 0.18, 6);
    k.box(DC.greyDark, 4.3, 5.4, 0, 1.0, -0.3, 1.1);
  });
}

/** Carretilla elevadora */
export function carretilla(k: Kit) {
  k.box(DC.yellow, -1.2, 0.8, 0.3, 1.3, -0.55, 0.55);
  k.box(DC.dark, -1.5, -1.0, 0.3, 1.1, -0.5, 0.5);
  k.box(DC.greyDark, 0.8, 0.95, 0, 2.6, -0.45, 0.45);
  k.ghost(() => k.box(DC.greyDark, 0.95, 2.0, 0.05, 0.12, -0.35, 0.35));
  k.det(() => {
    for (const x of [-0.9, 0.6]) for (const z of [-0.55, 0.55]) k.box(DC.dark, x - 0.04, x + 0.04, 1.3, 2.2, z - 0.04, z + 0.04);
    k.box(DC.dark, -0.95, 0.65, 2.2, 2.26, -0.6, 0.6);
  });
  for (const x of [-0.8, 0.5]) for (const z of [-0.6, 0.6]) k.cyl(DC.black, [x, 0.3, z], [x, 0.3, z + (z > 0 ? 0.2 : -0.2)], 0.3, 0.3, 8);
}

/** Camión con remolque de caja (decorado y tráfico) */
export function camion(k: Kit, cab = DC.blue, box = DC.offWhite) {
  k.box(cab, 4.4, 6.4, 0.9, 3.2, -1.22, 1.22);
  k.box(DC.glass, 6.4, 6.44, 2.1, 3.0, -1.1, 1.1);
  k.box(DC.dark, -6.5, 4.5, 0.6, 1.1, -0.9, 0.9);
  k.box(box, -6.6, 4.2, 1.1, 3.9, -1.25, 1.25);
  for (const x of [-5.4, -4.2, 5.6]) for (const z of [-1.0, 1.0]) k.cyl(DC.black, [x, 0.5, z], [x, 0.5, z + (z > 0 ? 0.3 : -0.3)], 0.5, 0.5, 10);
}

/** Coche aparcado */
export function coche(k: Kit, col: string) {
  k.box(col, -2.1, 2.1, 0.3, 1.0, -0.85, 0.85);
  k.box(DC.glass, -1.1, 0.9, 1.0, 1.5, -0.78, 0.78);
  k.box(col, -1.0, 0.8, 1.5, 1.56, -0.75, 0.75);
  k.det(() => { for (const x of [-1.4, 1.4]) for (const z of [-0.85, 0.85]) k.cyl(DC.black, [x, 0.32, z], [x, 0.32, z + (z > 0 ? 0.08 : -0.08)], 0.32, 0.32, 8); });
}

/** Farola */
export function farola(k: Kit, h = 8) {
  k.cyl(DC.greyDark, [0, 0, 0], [0, h, 0], 0.11, 0.07, 6);
  k.det(() => {
    k.box(DC.greyDark, 0, 1.6, h - 0.08, h, -0.05, 0.05);
    k.box(DC.lamp, 1.1, 1.7, h - 0.2, h - 0.08, -0.15, 0.15);
  });
}

/** Árbol: conífera (cono) o frondoso (dos conos) */
export function arbol(k: Kit, h: number, pine: boolean, col: string) {
  k.cyl(DC.trunk, [0, 0, 0], [0, pine ? h * 0.3 : h * 0.42, 0], 0.18 + h * 0.012, 0.12, 5);
  if (k.solid && k.layer === 'near') { const [x, z] = k.w(0, 0); k.solids.push({ x, y: h / 2, z, hx: 0.3, hy: h / 2, hz: 0.3, r: 0 }); }
  k.ghost(() => {
    if (pine) k.cyl(col, [0, h * 0.18, 0], [0, h, 0], h * 0.26, 0.05, 7);
    else {
      k.cyl(col, [0, h * 0.32, 0], [0, h * 0.68, 0], h * 0.22, h * 0.3, 7);
      k.cyl(col, [0, h * 0.68, 0], [0, h, 0], h * 0.3, h * 0.06, 7);
    }
  });
}

/** Edificio de bloque con bandas de ventanas, pretil y equipos en la azotea */
export function edificio(k: Kit, w: number, d: number, h: number, col: string, win = DC.glass) {
  k.box(col, -w / 2, w / 2, 0, h, -d / 2, d / 2);
  k.box(shadeHex(col, 0.85), -w / 2 - 0.05, w / 2 + 0.05, h, h + 0.9, -d / 2 - 0.05, d / 2 + 0.05);
  k.box(shadeHex(col, 0.7), -w / 2 + 0.4, w / 2 - 0.4, h, h + 0.2, -d / 2 + 0.4, d / 2 - 0.4);
  const floors = Math.min(16, Math.floor((h - 1) / 3.2));
  const every = floors > 10 ? 2 : 1;
  k.ghost(() => {
    for (let f = 0; f < floors; f += every) {
      const y = 1.4 + f * 3.2;
      k.box(win, -w / 2 - 0.04, w / 2 + 0.04, y, y + 1.4, -d / 2 - 0.04, d / 2 + 0.04);
    }
  });
  if (w > 10 && d > 10) {
    k.box(DC.greyLight, -w / 4, -w / 4 + 3, h + 0.2, h + 2.2, -1.5, 1.5);
    k.det(() => k.box(DC.greyDark, w / 4, w / 4 + 2.2, h + 0.2, h + 1.4, d / 4 - 1, d / 4 + 1));
  }
}

/** Nave industrial: paredes, tejado a dos aguas y portones en el frente (+x) */
export function nave(k: Kit, w: number, d: number, h: number, col = DC.greyLight, roof = DC.roof) {
  k.box(col, -w / 2, w / 2, 0, h, -d / 2, d / 2);
  k.box(shadeHex(col, 0.8), -w / 2 - 0.02, w / 2 + 0.02, 0, 1.2, -d / 2 - 0.02, d / 2 + 0.02);
  k.gable(roof, 0, h, 0, w + 0.6, Math.min(4, d * 0.12), d + 0.6);
  const doors = Math.max(1, Math.floor(d / 12));
  k.ghost(() => {
    for (let i = 0; i < doors; i++) {
      const z = -d / 2 + (d / doors) * (i + 0.5);
      k.box(DC.greyDark, w / 2, w / 2 + 0.06, 0, Math.min(5.5, h - 1), z - 2.4, z + 2.4);
    }
    k.box(DC.glass, -w / 2 - 0.04, w / 2 + 0.04, h - 1.6, h - 0.8, -d / 2 - 0.04, d / 2 + 0.04);
  });
}

/** Depósito cilíndrico con techo cónico y escalera */
export function tanque(k: Kit, r: number, h: number, col = DC.tank) {
  k.cyl(col, [0, 0, 0], [0, h, 0], r, r, 20);
  k.ghost(() => k.cyl(shadeHex(col, 0.9), [0, h, 0], [0, h + r * 0.18, 0], r, r * 0.12, 20));
  k.det(() => {
    k.box(DC.greyDark, r, r + 0.5, 0, h + 0.4, -0.3, 0.3);
    k.cyl(DC.greyDark, [0, h + 0.9, 0], [0, h + 0.9, 0.01], r * 0.99, r * 0.99, 20);
  });
}

/** Chimenea con franjas y antorcha */
export function chimenea(k: Kit, h: number) {
  k.cyl(DC.greyLight, [0, 0, 0], [0, h * 0.8, 0], 1.5, 1.1, 12);
  k.cyl(DC.red, [0, h * 0.8, 0], [0, h * 0.87, 0], 1.1, 1.05, 12);
  k.cyl(DC.white, [0, h * 0.87, 0], [0, h * 0.94, 0], 1.05, 1.0, 12);
  k.cyl(DC.red, [0, h * 0.94, 0], [0, h, 0], 1.0, 0.95, 12);
}

/** Columna de proceso con plataformas */
export function columna(k: Kit, r: number, h: number) {
  k.cyl(DC.tank, [0, 0, 0], [0, h, 0], r, r, 14);
  k.ghost(() => k.cyl(DC.tank, [0, h, 0], [0, h + r * 0.6, 0], r, 0.2, 14));
  k.det(() => { for (let y = 8; y < h; y += 8) k.cyl(DC.pipeY, [0, y, 0], [0, y + 0.15, 0], r + 0.9, r + 0.9, 14); });
}

/** Rack de tuberías a lo largo de x (de −len/2 a len/2), alto h */
export function rack(k: Kit, len: number, h = 6) {
  const n = Math.max(1, Math.round(len / 6));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len * i) / n;
    for (const z of [-2, 2]) k.box(DC.greyDark, x - 0.2, x + 0.2, 0, h, z - 0.2, z + 0.2);
    k.ghost(() => { k.box(DC.greyDark, x - 0.2, x + 0.2, h - 0.4, h, -2.2, 2.2); k.box(DC.greyDark, x - 0.15, x + 0.15, h - 2.6, h - 2.3, -2.2, 2.2); });
  }
  const pc = [DC.pipeY, DC.steel, DC.pipeG, DC.steel, DC.red];
  k.ghost(() => {
    pc.forEach((c, j) => k.cyl(c, [-len / 2, h + 0.3, -1.6 + j * 0.8], [len / 2, h + 0.3, -1.6 + j * 0.8], 0.3, 0.3, 6));
    pc.slice(0, 3).forEach((c, j) => k.cyl(c, [-len / 2, h - 1.95, -1.4 + j * 1.0], [len / 2, h - 1.95, -1.4 + j * 1.0], 0.25, 0.25, 6));
  });
}

/** Torre de alta tensión de celosía (115 kV): conductores a la altura `armY`, cruceta a lo largo de z local */
export function torreAT(k: Kit, armY: number) {
  const h = armY + 4, b = 2.6, t = 0.7;
  k.ghost(() => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(DC.steel, [sx * b, 0, sz * b], [sx * t, h, sz * t], 0.12, 0.08, 4);
    for (const y of [h * 0.25, h * 0.5, h * 0.75]) {
      const e = b + ((t - b) * y) / h;
      for (const s of [-1, 1]) {
        k.cyl(DC.steel, [-e, y, s * e], [e, y, s * e], 0.05, 0.05, 3);
        k.cyl(DC.steel, [s * e, y, -e], [s * e, y, e], 0.05, 0.05, 3);
      }
    }
    for (let i = 0; i < 4; i++) {
      const y0 = (h * i) / 4, y1 = (h * (i + 1)) / 4, e0 = b + ((t - b) * y0) / h, e1 = b + ((t - b) * y1) / h;
      for (const s of [-1, 1]) {
        k.cyl(DC.steel, [-e0, y0, s * e0], [e1, y1, s * e1], 0.04, 0.04, 3);
        k.cyl(DC.steel, [s * e0, y0, -e0], [s * e1, y1, e1], 0.04, 0.04, 3);
      }
    }
    k.box(DC.steel, -0.3, 0.3, armY - 0.2, armY + 0.05, -3, 3);
    k.cyl(DC.steel, [0, h, 0], [0, h + 2, 0], 0.15, 0.05, 4);
  });
  if (k.solid && k.layer === 'near') { const [x, z] = k.w(0, 0); k.solids.push({ x, y: h / 2, z, hx: b, hy: h / 2, hz: b, r: rotOf(k) }); }
  k.det(() => { for (const z of [-0.5, 0, 0.5]) k.cyl(DC.dark, [0, armY + 0.05, z], [0, armY + 0.25, z], 0.06, 0.06, 5); });
}

/** Poste de hormigón de media tensión (34,5 kV) con cruceta a lo largo de z local */
export function posteMT(k: Kit, armY: number) {
  k.cyl(DC.concrete, [0, 0, 0], [0, armY + 0.8, 0], 0.22, 0.14, 6);
  k.ghost(() => k.box(DC.concrete, -0.12, 0.12, armY - 0.3, armY - 0.05, -1.0, 1.0));
  k.det(() => { for (const z of [-0.5, 0, 0.5]) k.cyl(DC.dark, [0, armY - 0.05, z], [0, armY, z], 0.07, 0.07, 5); });
}

/** Pórtico de subestación con dos transformadores */
export function subestacion(k: Kit) {
  for (const x of [-10, 10]) {
    for (const z of [-6, 6]) k.box(DC.steel, x - 0.3, x + 0.3, 0, 12, z - 0.3, z + 0.3);
    k.ghost(() => k.box(DC.steel, x - 0.3, x + 0.3, 11.4, 12, -6.5, 6.5));
  }
  for (const x of [-5, 5]) {
    k.box(DC.concrete, x - 2.5, x + 2.5, 0, 0.4, -2, 2);
    k.box(DC.pipeG, x - 2, x + 2, 0.4, 3.6, -1.4, 1.4);
    k.det(() => { for (const z of [-0.8, 0, 0.8]) k.cyl(DC.offWhite, [x, 3.6, z], [x, 5.2, z], 0.12, 0.08, 5); });
  }
}

/** Pila de contenedores (n alturas), largo 6,1 o 12,2 m a lo largo de x */
export function contenedores(k: Kit, n: number, long: boolean, cols: string[]) {
  const L = long ? 12.2 : 6.1;
  for (let i = 0; i < n; i++) {
    const c = cols[i % cols.length];
    k.box(c, -L / 2, L / 2, i * 2.6, i * 2.6 + 2.59, -1.22, 1.22);
  }
}

/** Pórtico de muelle (silueta simple): patas en x = ±8 y pluma hacia −z (sobre el agua) */
export function porticoMuelle(k: Kit) {
  for (const x of [-8, 8]) for (const z of [-6, 6]) k.box(DC.red, x - 0.6, x + 0.6, 0, 34, z - 0.6, z + 0.6);
  k.ghost(() => {
    for (const x of [-8, 8]) k.box(DC.red, x - 0.6, x + 0.6, 30, 34, -6.5, 6.5);
    k.box(DC.red, -8.6, 8.6, 34, 36, -6, 6);
    k.box(DC.red, -1.4, 1.4, 36, 39, -55, 12);
    k.box(DC.offWhite, -4, 4, 36, 41, 2, 10);
    for (const x of [-7, 7]) k.cyl(DC.red, [x, 36, 0], [0, 48, 0], 0.3, 0.3, 4);
  });
}

/** Barco portacontenedores (lejano) a lo largo de x */
export function barco(k: Kit, cols: string[]) {
  k.box(DC.dark, -70, 70, -6, 8, -14, 14);
  k.box(DC.red, -70, 70, -6, -2, -14.2, 14.2);
  k.box(DC.white, -62, -50, 8, 26, -12, 12);
  for (let i = 0; i < 9; i++) k.box(cols[i % cols.length], -44 + i * 12, -33 + i * 12, 8, 8 + 2.6 * (2 + (i % 3)), -12, 12);
}

/** Pila de placas de lastre (patio de maquinaria) */
export function placasLastre(k: Kit, n: number) {
  for (let i = 0; i < n; i++) k.box(i === n - 1 ? DC.yellow : DC.greyDark, -1.8, 1.8, i * 0.45, i * 0.45 + 0.43, -1.3, 1.3);
}

/** Bolardo de muelle */
export function bolardo(k: Kit) {
  k.det(() => k.cyl(DC.black, [0, 0, 0], [0, 0.6, 0], 0.25, 0.3, 8));
}

/** Mástil con manga de viento o con bandera (el trapo es animado, ver decorView) */
export function mastil(k: Kit, h: number) {
  k.cyl(DC.greyLight, [0, 0, 0], [0, h + 0.2, 0], 0.06, 0.05, 6);
}

/** Puente de carretera lejano (tablero a lo largo de z local) */
export function puente(k: Kit, len: number) {
  k.box(DC.concrete, -5, 5, 9, 10.5, -len / 2, len / 2);
  k.ghost(() => {
    for (let z = -len / 2 + 15; z < len / 2; z += 30) k.box(DC.concrete, -2, 2, -2, 9, z - 1.2, z + 1.2);
    for (const x of [-4.9, 4.9]) k.box(DC.greyLight, x - 0.1, x + 0.1, 10.5, 11.5, -len / 2, len / 2);
  });
}

function rotOf(k: Kit) {
  const [x0, z0] = k.w(0, 0), [x1, z1] = k.w(1, 0);
  return Math.atan2(-(z1 - z0), x1 - x0);
}

export function shadeHex(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
