// Los 13 niveles de la referencia (LEVELS de referencia/crane-v20.html), copiados tal cual con sus ayudas
// (B, truck, fence, CT). levels.test.ts los compara con el HTML. Coordenadas de la planta de la referencia:
// obra de 84 × 56 m (x de 0 a WW, z de 0 a WD), y arriba; coinciden con las del juego sin espejo (vista desde
// arriba, x a la derecha y z hacia abajo). Cajas y zonas: centro (x, z), medidas w (en x) y d (en z), alto h
// desde el suelo; las zonas de destino tienen la altura de apoyo y.

import type { CraneId } from '../crane/cranes';
import type { SoftKind } from '../crane/terrain';

/** Medidas de la obra (WW × WD de la referencia) */
export const WW = 84, WD = 56;

export type BoxKind = 'building' | 'wall' | 'pier' | 'pad' | 'bed' | 'cab' | 'pole' | 'container' | 'rack' | 'shelter' | 'tank';
/** Colores por tipo (KIND_COL de la referencia) */
export const KIND_COL: Record<BoxKind, string> = { building: '#69717a', wall: '#8e959c', pier: '#8a8378', pad: '#9a958c', bed: '#2b2f36', cab: '#c4473a', pole: '#5b4632', container: '#3d6f8f', rack: '#7a6a55', shelter: '#7d8a80', tank: '#8a8f96' };

export interface LevelBox { x: number; z: number; w: number; d: number; h: number; kind: BoxKind; color?: string }
export interface LevelCrate { x: number; z: number; w: number; d: number; h: number; m: number; label: string; color: string; kind: string; fragile?: number }
export interface LevelZone { x: number; z: number; w: number; d: number; y: number; label: string; stack?: number }
export interface PowerLine { a: [number, number]; b: [number, number]; y: number; kv: string; clear: number; poles: number[] }
export interface Level {
  name: string; type: string;
  /** Tiempo de referencia para la tercera estrella (s) */
  par: number;
  /** Límite de tiempo (s), solo en el contrarreloj */
  time?: number;
  /** Viento: base (m/s), ráfaga (m/s), dirección (°) */
  wind: [number, number, number];
  ground: string;
  /** El plumín abatible solo se puede montar en este nivel */
  jib?: boolean;
  cranes: CraneId[]; rec: CraneId;
  /** Por qué no se puede usar cada grúa */
  why: Partial<Record<CraneId, string>>;
  start: { x: number; z: number; h: number };
  brief: string; tips: string[];
  boxes: LevelBox[]; crates: LevelCrate[]; zones: LevelZone[];
  lines?: PowerLine[];
  soft?: { x: number; z: number; w: number; d: number; kind: SoftKind }[];
}

const B = (x: number, z: number, w: number, d: number, h: number, kind: BoxKind = 'building', extra: { color?: string } = {}): LevelBox => ({ x, z, w, d, h, kind, ...extra });
function truck(x: number, z: number, len: number, dir = 1): LevelBox[] { return [B(x, z, len, 2.5, 1.4, 'bed'), B(x + dir * (len / 2 + 1.6), z, 3, 2.5, 3.2, 'cab')]; }
function fence(x1: number, z1: number, x2: number, z2: number, h = 2.4, gap: [number, number] | null = null): LevelBox[] {
  const t = 0.3, out: LevelBox[] = [];
  out.push(B((x1 + x2) / 2, z1, x2 - x1, t, h, 'wall'), B(x1, (z1 + z2) / 2, t, z2 - z1, h, 'wall'), B(x2, (z1 + z2) / 2, t, z2 - z1, h, 'wall'));
  if (gap) { out.push(B((x1 + gap[0]) / 2, z2, gap[0] - x1, t, h, 'wall'), B((gap[1] + x2) / 2, z2, x2 - gap[1], t, h, 'wall')); }
  else out.push(B((x1 + x2) / 2, z2, x2 - x1, t, h, 'wall'));
  return out;
}
const CT = (x: number, z: number, m: number, label: string, color: string, extra = {}): LevelCrate => ({ x, z, w: 6.1, d: 2.44, h: 2.6, m, label, color, kind: 'container', ...extra });

export const LEVELS: Level[] = [
  { name: 'Patio de contenedores', type: 'Básico', par: 300, wind: [0, 0, 0], ground: '#3b3d41',
    cranes: ['small', 'medium', 'rt'], rec: 'medium', why: { large: 'Demasiado grande para este patio', xl: 'Demasiado grande para este patio', crawler: 'No hace falta una grúa sobre orugas' },
    start: { x: 10, z: 46, h: 0 },
    brief: 'Mueve los dos contenedores a la zona de descarga. Aprende a usar las dos vistas: la planta para posicionar y la lateral para controlar la altura.',
    tips: ['Conduce con las flechas, despliega los estabilizadores con O.', 'La capacidad cambia con la dirección de la pluma: suele ser mayor por delante y por detrás que por los lados.', 'En planta, la sombra de la carga se separa más cuanto más alta va.'],
    boxes: [B(20, 9, 12.2, 2.5, 5.2, 'container', { color: '#7a3b33' }), B(20, 12, 12.2, 2.5, 7.8, 'container', { color: '#3d6f8f' }), B(64, 10, 12.2, 2.5, 5.2, 'container', { color: '#4f7a4a' }), B(64, 13, 12.2, 2.5, 2.6, 'container', { color: '#8a6a2a' }), B(40, 22, 0.6, 0.6, 14, 'pole')],
    crates: [CT(44, 32, 4.5, 'MSKU-01', '#3d7ea6'), CT(44, 37, 3.8, 'TGHU-02', '#a8473a')],
    zones: [{ x: 68, z: 42, w: 7.4, d: 6.4, y: 0, label: 'ZONA' }] },

  { name: 'Calle estrecha', type: 'Urbano', par: 330, wind: [2, 1.5, 90], ground: '#36383c',
    cranes: ['small', 'medium'], rec: 'small', why: { large: 'No cabe en la calle', xl: 'No cabe en la calle', crawler: 'No puede circular por la ciudad' },
    start: { x: 6, z: 25, h: 0 },
    brief: 'Sube la unidad de aire acondicionado del camión a la azotea de +12 m. La calle mide 8 m: comprueba que caben los estabilizadores y que el contrapeso no golpee las fachadas al girar.',
    tips: ['Los estabilizadores de la AT 60 abren 7,2 m más los apoyos: aquí no caben.', 'Sobre neumáticos la capacidad lateral es muy baja.', 'El radio de cola (contrapeso) también choca con los edificios.'],
    boxes: [B(11, 10.5, 22, 21, 18), B(31, 10.5, 18, 21, 12), B(62, 10.5, 44, 21, 24), B(18, 42.5, 36, 27, 15), B(60, 42.5, 48, 27, 9), B(25, 5, 4, 4, 16, 'tank'), ...truck(57, 25, 10, -1)],
    crates: [{ x: 57, z: 25, w: 3, d: 2.2, h: 2.0, m: 2.8, label: 'HVAC', color: '#8b98a5', kind: 'hvac' }],
    zones: [{ x: 31, z: 14, w: 6, d: 6, y: 12, label: 'AZOTEA' }] },

  { name: 'Subestación', type: 'Eléctrico', par: 420, wind: [2, 1.5, 0], ground: '#3d3a33',
    cranes: ['large', 'xl', 'crawler', 'at300', 'at450'], rec: 'large', why: { small: 'Alcance y capacidad insuficientes', medium: 'Alcance insuficiente desde terreno firme' },
    start: { x: 10, z: 47, h: 0 },
    brief: 'Coloca el transformador de 9 t en su base, dentro del recinto. Hay dos líneas energizadas y una zona de barro donde las grúas de ruedas no entran.',
    tips: ['Línea de 34,5 kV: mínimo 3 m. Línea de 115 kV: mínimo 5 m. La alarma suena 2 m antes.', 'Cuenta la pluma, el cable y la carga.', 'La grúa sobre orugas sí puede entrar en el barro.'],
    lines: [{ a: [0, 22], b: [84, 22], y: 11, kv: '34,5 kV', clear: 3, poles: [8, 42, 76] }, { a: [70, 0], b: [70, 56], y: 13, kv: '115 kV', clear: 5, poles: [4, 32, 52] }],
    soft: [{ x: 48, z: 31, w: 28, d: 10, kind: 'mud' }],
    boxes: [...fence(40, 2, 62, 18), B(52, 10, 5, 5, 0.3, 'pad'), B(45, 6, 3, 3, 3.5, 'tank'), B(45, 14, 3, 3, 3.5, 'tank'), ...truck(26, 42, 10, 1)],
    crates: [{ x: 26, z: 42, w: 3.4, d: 2.4, h: 3.2, m: 9, label: 'TRAFO', color: '#6f7d6a', kind: 'trafo' }],
    zones: [{ x: 52, z: 10, w: 5, d: 5, y: 0.3, label: 'BASE' }] },

  { name: 'Puente sobre el río', type: 'Infraestructura', par: 480, wind: [3, 2, 10], ground: '#3e3b34',
    cranes: ['large', 'xl', 'crawler', 'at300', 'at450', 'at650'], rec: 'large', why: { small: 'Capacidad insuficiente para 45 t', medium: 'Capacidad insuficiente para 45 t' },
    start: { x: 10, z: 30, h: 0 },
    brief: 'Coloca la viga de 22 m y 45 t sobre las dos pilas. Debe apoyar en ambas: tienes menos de un metro de margen a lo largo.',
    tips: ['Ninguna grúa puede entrar al agua ni apoyar estabilizadores en ella.', 'Una carga larga choca fácilmente al girar: súbela antes de girar.', 'Gira despacio: 45 t balanceándose cambian mucho el momento de vuelco.'],
    soft: [{ x: 44, z: 28, w: 16, d: 56, kind: 'water' }],
    boxes: [B(34, 24, 2.5, 4, 8, 'pier'), B(54, 24, 2.5, 4, 8, 'pier'), B(16, 47, 24, 2.8, 1.4, 'bed'), B(29.6, 47, 3, 2.8, 3.4, 'cab'), B(64, 10, 6, 3, 3, 'shelter')],
    crates: [{ x: 16, z: 47, w: 22, d: 1.6, h: 1.8, m: 45, label: 'VIGA 45 t', color: '#b5552f', kind: 'girder' }],
    zones: [{ x: 44, z: 24, w: 23.4, d: 4, y: 8, label: 'PILAS' }] },

  { name: 'Torre de telecomunicaciones', type: 'Precisión', par: 520, wind: [4, 3, 0], ground: '#3b3e38',
    cranes: ['medium', 'large', 'xl', 'at300', 'rt', 'sk'], rec: 'medium', why: { small: 'Altura de gancho insuficiente', crawler: 'No cabe entre los árboles del acceso' },
    start: { x: 8, z: 44, h: 0 },
    brief: 'Monta los tres tramos de 9 m uno encima del otro sobre la base. Cada tramo debe quedar centrado a menos de medio metro.',
    tips: ['El tercer tramo se apoya a +18,5 m: necesitas el gancho a más de 30 m.', 'Los tramos son altos y livianos: el viento los mueve mucho.', 'Usa la vista lateral desde el sur o el este para alinear.'],
    boxes: [B(54, 26, 4, 4, 0.5, 'pad'), B(62, 34, 4, 3, 3, 'shelter'), ...fence(48, 20, 60, 32, 2, [52, 56])],
    crates: [1, 2, 3].map(i => ({ x: 18 + i * 4.5, z: 12, w: 2.4, d: 2.4, h: 9, m: 2.6, label: `T${i}`, color: '#b44a3a', kind: 'tower' })),
    zones: [0, 1, 2].map(i => ({ x: 54, z: 26, w: 3.4, d: 3.4, y: 0.5 + i * 9, label: `TRAMO ${i + 1}`, stack: i })) },

  { name: 'Fachada de vidrio', type: 'Viento', par: 420, wind: [6, 4, 200], ground: '#37393d',
    cranes: ['medium', 'large', 'xl', 'at300', 'at450', 'sk'], rec: 'medium', why: { small: 'No llega a +30 m', crawler: 'No puede circular por la ciudad' },
    start: { x: 8, z: 46, h: 0 },
    brief: 'Sube las dos cajas de vidrio a la azotea de +30 m con viento fuerte y racheado. Se rompen si tocan a más de 0,5 m/s.',
    tips: ['Usa la velocidad fina para el último metro.', 'Espera a que pase la ráfaga antes de apoyar.', 'Las cajas grandes y livianas reciben mucho empuje del viento.'],
    boxes: [B(56, 20, 24, 20, 30), B(26, 7, 16, 14, 16), B(78, 44, 12, 20, 12), B(52, 15, 3, 3, 33, 'tank')],
    crates: [{ x: 22, z: 42, w: 3.2, d: 1.6, h: 2.4, m: 1.6, label: 'VIDRIO', color: '#a98454', kind: 'glass', fragile: 0.5 }, { x: 28, z: 42, w: 3.2, d: 1.6, h: 2.4, m: 1.6, label: 'VIDRIO', color: '#a98454', kind: 'glass', fragile: 0.5 }],
    zones: [{ x: 56, z: 22, w: 8, d: 6, y: 30, label: 'AZOTEA +30' }] },

  { name: 'Pick & carry en el barro', type: 'Orugas', par: 540, wind: [1.5, 1, 0], ground: '#3d3a33',
    cranes: ['crawler', 'rt'], rec: 'crawler', why: { small: 'No puede entrar al barro', medium: 'No puede entrar al barro', large: 'No puede entrar al barro', xl: 'No puede entrar al barro' },
    start: { x: 12, z: 46, h: 0 },
    brief: 'Lleva el recipiente de 38 t hasta la cimentación del otro lado. Está fuera de alcance: tendrás que desplazarte con la carga colgada a través del barro.',
    tips: ['Con la carga colgada la capacidad baja (tabla en desplazamiento).', 'Lleva la carga baja y cerca, con la pluma alineada con las orugas.', 'Rodea el rack de tuberías por el sur.'],
    soft: [{ x: 43, z: 28, w: 38, d: 56, kind: 'mud' }],
    boxes: [B(44, 20, 3, 24, 7, 'rack'), B(74, 28, 6, 6, 1.0, 'pad'), B(76, 8, 6, 6, 9, 'tank')],
    crates: [{ x: 12, z: 26, w: 3.6, d: 3.6, h: 5, m: 38, label: 'V-101', color: '#7f8c8d', kind: 'vessel' }],
    zones: [{ x: 74, z: 28, w: 6, d: 6, y: 1.0, label: 'CIMENTACIÓN' }] },

  { name: 'Descarga contrarreloj', type: 'Contrarreloj', par: 240, time: 330, wind: [2.5, 2, 90], ground: '#3b3d41',
    cranes: ['small', 'medium', 'rt'], rec: 'small', why: { large: 'Demasiado lenta para este trabajo', xl: 'Demasiado lenta para este trabajo', crawler: 'Demasiado lenta para este trabajo' },
    start: { x: 8, z: 28, h: 0 },
    brief: 'Descarga los cuatro palés de los dos camiones en la zona de acopio antes de 5:30. Elige bien dónde estacionar para no moverte.',
    tips: ['Mover dos funciones a la vez reparte el caudal hidráulico.', 'Si el tiempo llega a cero, el nivel termina.'],
    boxes: [...truck(26, 14, 10, 1), ...truck(26, 42, 10, 1), B(48, 28, 0.6, 0.6, 10, 'pole'), B(72, 12, 12.2, 2.5, 5.2, 'container', { color: '#7a3b33' })],
    crates: ([[23, 14, 1.5, 'P1'], [29, 14, 2.0, 'P2'], [23, 42, 1.8, 'P3'], [29, 42, 2.4, 'P4']] as [number, number, number, string][]).map(([x, z, m, l]) => ({ x, z, w: 2.4, d: 1.6, h: 1.6, m, label: l, color: '#8a6a3a', kind: 'pallet' })),
    zones: [{ x: 64, z: 30, w: 10, d: 8, y: 0, label: 'ACOPIO' }] },

  { name: 'Reactor de refinería', type: 'Izaje pesado', par: 720, wind: [3, 2, 300], ground: '#3a3c3f',
    cranes: ['xl', 'at450', 'at650'], rec: 'xl', why: { at300: 'Capacidad lateral insuficiente para 240 t', small: 'Capacidad insuficiente para 240 t', medium: 'Capacidad insuficiente para 240 t', large: 'Capacidad insuficiente para 240 t', crawler: 'Capacidad insuficiente a ese radio' },
    start: { x: 12, z: 28, h: 0 },
    brief: 'Levanta el reactor de 240 t del transportador y colócalo en su cimentación al otro lado. Solo la AT 500-8 puede hacerlo, y solo con el lastre montado.',
    tips: ['Estaciona entre el transportador y la cimentación: los dos izajes son por los lados, donde la grúa es más débil.', 'Con los estabilizadores puestos, monta el lastre con B (tarda unos segundos). Sin lastre la capacidad lateral cae a menos de la mitad.', 'El reactor mide 12 m: súbelo lo suficiente antes de girar.'],
    boxes: [B(44, 16, 16, 5, 1.6, 'bed'), B(44, 40, 7, 7, 1.5, 'pad'), B(70, 28, 3, 44, 9, 'rack'), B(60, 46, 8, 8, 16, 'tank'), B(28, 46, 6, 6, 10, 'tank'), B(62, 8, 10, 6, 6, 'shelter')],
    crates: [{ x: 44, z: 16, w: 5, d: 5, h: 12, m: 240, label: 'R-201', color: '#8c969e', kind: 'vessel' }],
    zones: [{ x: 44, z: 40, w: 7, d: 7, y: 1.5, label: 'CIMENTACIÓN' }] },

  { name: 'Enfriadora en azotea', type: 'Gran altura', par: 900, wind: [3.5, 2.5, 270], ground: '#37393d',
    cranes: ['xl', 'at300', 'at450', 'at650'], rec: 'xl', why: { small: 'No llega a +32 m', medium: 'Capacidad insuficiente a ese radio', large: 'Capacidad insuficiente con pluma larga', crawler: 'No puede circular por la ciudad' },
    start: { x: 12, z: 26, h: 0 },
    brief: 'Sube la enfriadora de 70 t a la azotea de +32 m. Para pasar sobre el borde del edificio necesitas más de 40 m de pluma: tendrás que montar el lastre y el arriostramiento en Y.',
    tips: ['Estabiliza, monta el lastre (B) y, con la pluma retraída del todo, monta el arriostramiento (Y). Tarda unos 24 s.', 'Sin arriostramiento tensado la pluma no pasa de 35 m y la capacidad estructural cae mucho.', 'Vigila que la pluma no toque el borde de la azotea: súbela antes de extenderla.'],
    boxes: [B(58, 26, 26, 28, 32), B(64, 18, 4, 4, 36, 'tank'), B(66, 34, 6, 4, 35, 'shelter'), B(20, 8, 6, 6, 12, 'tank'), ...truck(26, 45, 10, 1)],
    crates: [{ x: 26, z: 45, w: 6, d: 2.4, h: 2.8, m: 70, label: 'CHILLER', color: '#6e8a9a', kind: 'hvac' }],
    zones: [{ x: 50.5, z: 26, w: 8, d: 8, y: 32, label: 'AZOTEA +32' }] },

  { name: 'Sobre la nave', type: 'Plumín abatible', par: 1200, wind: [3, 2, 0], ground: '#3a3c3f', jib: true,
    cranes: ['at650'], rec: 'at650', why: { lr: 'Demasiado grande para esta parcela' },
    start: { x: 14, z: 26, h: 0 },
    brief: 'Coloca la unidad de climatización de 45 t detrás de la nave de 28 m de alto. La pluma recta chocaría con la cubierta: usa el plumín abatible para pasar por encima y bajar al otro lado.',
    tips: ['Prepara la grúa: estabilizadores (O), lastre (B) y, con la pluma retraída, arriostramiento (Y).', 'Monta el plumín (M) con la pluma retraída, casi horizontal y apuntando al oeste, donde hay 42 m libres para tenderlo en el suelo.', 'T sube el plumín y G lo baja. Plumín alto = radio corto; plumín bajo = mucho alcance pero menos capacidad.', 'Sube la pluma casi vertical antes de extenderla para no tocar la nave.'],
    boxes: [B(50, 28, 14, 44, 28), B(50, 28, 3, 46, 30, 'rack'), ...truck(22, 46, 10, 1), B(76, 8, 8, 8, 12, 'tank'), B(78, 48, 6, 6, 9, 'shelter')],
    crates: [{ x: 22, z: 46, w: 6, d: 2.6, h: 3, m: 45, label: 'AHU-2', color: '#7f9aa8', kind: 'hvac' }],
    zones: [{ x: 68, z: 28, w: 8, d: 8, y: 0, label: 'PATIO TRASERO' }] },

  { name: 'Patio interior', type: 'Grúa torre', par: 900, wind: [3, 2, 90], ground: '#36383c',
    cranes: ['sk'], rec: 'sk', why: {},
    start: { x: 10, z: 50.5, h: 0 },
    brief: 'Mete los tres palés en el patio interior de la manzana, detrás de un edificio de 16 m. Desde la calle solo llega una grúa torre: estaciona, estabiliza y móntala.',
    tips: ['Despliega los estabilizadores (O) y monta la torre (M): se levanta, se telescopa y despliega la pluma.', 'Q/E mueven el carro por la pluma; W/S inclinan la pluma hasta 30° si necesitas más altura.', 'La capacidad baja con el radio: 10 t hasta 13 m, menos de 2 t en la punta.'],
    boxes: [B(14, 18, 28, 28, 18), B(70, 18, 28, 28, 24), B(42, 6, 28, 12, 20), B(42, 36, 28, 8, 16), ...truck(16, 44.6, 10, 1), B(78, 50, 10, 6, 6, 'shelter')],
    crates: ([[13, 2.0, 'P1'], [16, 1.8, 'P2'], [19, 2.2, 'P3']] as [number, number, string][]).map(([x, m, l]) => ({ x, z: 44.6, w: 2.4, d: 1.6, h: 1.6, m, label: l, color: '#8a6a3a', kind: 'pallet' })),
    zones: [{ x: 42, z: 22, w: 10, d: 8, y: 0, label: 'PATIO' }] },

  { name: 'Columna de destilación', type: 'Izaje extremo', par: 1800, wind: [1.5, 1, 0], ground: '#3a3c3f',
    cranes: ['lr'], rec: 'lr', why: {},
    start: { x: 40, z: 30, h: 0 },
    brief: 'Levanta la columna de 1.200 t y 32 m del transportador y colócala de pie en su cimentación. La LR 3000 ya está montada en su posición: no hace falta moverla, pero todo es muy lento y el lastre superlift barre un círculo de 22 m.',
    tips: ['El lastre superlift apoya en el suelo y solo suma cuando la carga intenta volcar la grúa.', 'Al girar, la bandeja de lastre pasa por detrás: vigila el círculo libre.', 'Con 1.200 t, cualquier balanceo multiplica el momento: mueve una función a la vez.'],
    boxes: [B(40, 9, 22, 8, 1.8, 'bed'), B(68, 30, 11, 11, 2, 'pad'), B(8, 8, 8, 8, 18, 'tank'), B(78, 50, 8, 8, 14, 'tank'), B(80, 12, 6, 14, 8, 'rack')],
    crates: [{ x: 40, z: 9, w: 7, d: 7, h: 32, m: 1200, label: 'C-301', color: '#9aa3aa', kind: 'vessel' }],
    zones: [{ x: 68, z: 30, w: 11, d: 11, y: 2, label: 'CIMENTACIÓN' }] },
];
