// Mando (fase 11): API Gamepad del navegador con el mapeo "standard" (Xbox / PlayStation). Se suma a las teclas.
// Sin DOM: padAxes() y padEdges() se prueban sueltas; Input las llama una vez por cuadro.
//
//   stick izquierdo   ↕ marcha · ↔ dirección          stick derecho   ↔ giro · ↕ pluma
//   LT / RT           subir / bajar cable              LB / RB         recoger / sacar telescopio (carro)
//   cruceta ↑/↓       plumín (T/G)                     cruceta ←/→     radio superlift (K/L)
//   A / ✕             enganchar / soltar (Espacio)     B / ○           estabilizadores (O)
//   X / □             lastre (B)                       Y / △           cámara (V)
//   View / Share      montaje (M)                      Menu / Options  arriostramiento (Y)
//   clic stick izq.   fino (Shift, mantener)           clic stick der. cambiar de grúa (Tab)

export const DEADZONE = 0.15;

/** Botones del mapeo standard */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Acciones de un toque (flanco de subida) */
export type PadAction = 'hook' | 'outriggers' | 'ballast' | 'view' | 'mount' | 'yguy' | 'switch';
const EDGE: [number, PadAction][] = [
  [PAD.A, 'hook'], [PAD.B, 'outriggers'], [PAD.X, 'ballast'], [PAD.Y, 'view'], [PAD.VIEW, 'mount'], [PAD.MENU, 'yguy'], [PAD.R3, 'switch'],
];

export interface PadAxes {
  throttle: number; steer: number; slew: number; luff: number; tele: number; hoist: number; jib: number; sl: number; fine: boolean;
}

/** Stick con zona muerta, reescalado para que empiece en 0 al salir de ella */
export function dz(v: number) {
  const a = Math.abs(v);
  return a < DEADZONE ? 0 : (Math.sign(v) * (a - DEADZONE)) / (1 - DEADZONE);
}

type Btn = { pressed: boolean; value: number };
// gatillos analógicos: su valor; botones digitales sin valor, 1 al pulsar
const val = (b: Btn | undefined) => (b ? b.value || (b.pressed ? 1 : 0) : 0);
const on = (b: Btn | undefined) => !!b && (b.pressed || b.value > 0.5);

/**
 * Mandos continuos con los mismos signos que las teclas: giro + = A (izquierda), pluma + = W (subir),
 * telescopio + = E (sacar), cable + = F (bajar), marcha + = adelante, dirección + = izquierda,
 * plumín + = G (bajar), superlift + = L (alejar).
 */
export function padAxes(axes: readonly number[], buttons: readonly Btn[]): PadAxes {
  const b = (i: number) => val(buttons[i]);
  const neg = (v: number) => (v ? -v : 0); // sin −0
  return {
    throttle: neg(dz(axes[1] ?? 0)),
    steer: neg(dz(axes[0] ?? 0)),
    slew: neg(dz(axes[2] ?? 0)),
    luff: neg(dz(axes[3] ?? 0)),
    tele: (on(buttons[PAD.RB]) ? 1 : 0) - (on(buttons[PAD.LB]) ? 1 : 0),
    hoist: dz(b(PAD.RT)) - dz(b(PAD.LT)),
    jib: (on(buttons[PAD.DOWN]) ? 1 : 0) - (on(buttons[PAD.UP]) ? 1 : 0),
    sl: (on(buttons[PAD.RIGHT]) ? 1 : 0) - (on(buttons[PAD.LEFT]) ? 1 : 0),
    fine: on(buttons[PAD.L3]),
  };
}

/** Acciones cuyo botón se acaba de pulsar (prev = botones pulsados en el cuadro anterior) */
export function padEdges(prev: readonly boolean[], buttons: readonly Btn[]): PadAction[] {
  const out: PadAction[] = [];
  for (const [i, a] of EDGE) if (on(buttons[i]) && !prev[i]) out.push(a);
  return out;
}

export const pressedList = (buttons: readonly Btn[]) => buttons.map(on);
