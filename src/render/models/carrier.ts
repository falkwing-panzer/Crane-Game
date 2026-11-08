import type { WheeledSpec } from '../../crane/cranes';
import type { Parts } from './builder';
import type { Layout } from './layout';

// Chasis de una grúa de ruedas de estilo europeo (port de craneModel() de la referencia, rama de ruedas):
// bastidor, ejes y suspensión, guardabarros curvos, cubierta con canto, cofres laterales con puertas, motor
// bajo la cubierta, depósito, cajones de estabilizadores con franjas, frente con parrilla y faros,
// trasera achaflanada con franjas y pilotos, equipo de cubierta y apoyo de pluma.
// La cabina del conductor va en `cabP` (se oculta en la vista de cabina).
// Cambios respecto de la referencia, para que nada se atraviese al girar o tumbar la pluma: el equipo de
// la cubierta y el escape quedan por debajo de la pluma tumbada, sin rotativo en el techo de la cabina,
// el bastidor y los cofres se estrechan si no caben entre las llantas.

const D = Math.PI / 180;

export function buildCarrier(T: WheeledSpec, L: Layout, P: Parts, cabP: Parts) {
  const [L0, L1] = T.len, hf = L.hf, wR = T.wheelR, dLo = T.deckLo, dHi = T.deckHi, wz = wR;
  const cabX0 = L.cab.x0, cabLow = L.cab.y0, cabTop = L.cab.y1, fh = L.frameHalf;
  const tireIn = L.tireZ - L.tireHalf;

  // bastidor (viga cajón) y ejes con suspensión
  P.box('grey', L0 + 0.35, L1 - 0.5, dLo + 0.1, dLo + 1.0, -fh, fh);
  const zs = Math.min(0.95, tireIn - 0.15);
  for (const a of T.axles) {
    P.box('black', a - 0.12, a + 0.12, wz - 0.12, wz + 0.12, -(hf - 0.62), hf - 0.62);
    for (const s of [-1, 1]) {
      P.cyl('greyDeep', [a + 0.3, wz + 0.05, s * zs], [a + 0.12, dLo + 0.45, s * (zs - 0.17)], 0.11, 10);
      P.cyl('chrome', [a - 0.3, wz + 0.05, s * zs], [a - 0.12, dLo + 0.45, s * (zs - 0.17)], 0.07, 8);
    }
  }

  // guardabarros curvos sobre cada rueda (arco de 18° a 162°)
  for (const a of T.axles) for (const s of [-1, 1]) {
    const r0 = wR + 0.07, r1 = wR + 0.15, prof: [number, number][] = [];
    for (let i = 0; i <= 9; i++) { const t = (18 + 16 * i) * D; prof.push([a + Math.cos(t) * r1, wz + Math.sin(t) * r1]); }
    for (let i = 9; i >= 0; i--) { const t = (18 + 16 * i) * D; prof.push([a + Math.cos(t) * r0, wz + Math.sin(t) * r0]); }
    const l0 = s * (hf - 0.66), l1 = s * (hf - 0.02);
    P.ext('dark', prof, Math.min(l0, l1), Math.max(l0, l1));
  }

  // cubierta: plataforma amarilla, chapa superior y filete lateral
  P.box('yellow', L0 + 0.1, cabX0, dHi - 0.3, dHi, -hf, hf);
  P.box('greyDeep', L0 + 0.3, cabX0 - 0.1, dHi, dHi + 0.04, -hf + 0.12, hf - 0.12);
  for (const s of [-1, 1]) P.box('black', L0 + 0.1, cabX0, dHi - 0.12, dHi - 0.08, s * hf, s * (hf + 0.02));

  // depósito de combustible (izquierda) en el hueco libre más largo que no sea el del motor
  const byLen = [...L.freeGaps].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  const fr = byLen.filter((g) => g !== L.engGap)[0];
  const tank = fr && fr[1] - fr[0] > 1.6 ? fr : null;
  if (tank) {
    const m = (tank[0] + tank[1]) / 2, hl = Math.min(1.1, (tank[1] - tank[0]) / 2 - 0.3);
    P.cyl('chrome', [m - hl, dLo + 0.35, -hf + 0.45], [m + hl, dLo + 0.35, -hf + 0.45], 0.32, 18);
  }

  // cofres laterales con puertas en relieve (no en el hueco del motor ni detrás del depósito)
  for (const s of [-1, 1]) for (const [x0, x1] of L.freeGaps) {
    if (x1 - x0 < 0.7 || (L.engGap && x0 === L.engGap[0]) || (s < 0 && tank && x0 === tank[0])) continue;
    const lo = dLo + 0.25, hi = dHi - 0.3, zin = Math.max(hf - 0.7, fh + 0.02);
    P.box('yellowDark', x0, x1, lo, hi, s * zin, s * (hf - 0.04));
    const nd = Math.max(1, Math.round((x1 - x0) / 1.1)), dw = (x1 - x0) / nd;
    for (let i = 0; i < nd; i++) {
      const a0 = x0 + i * dw + 0.05, a1 = x0 + (i + 1) * dw - 0.05, m = (a0 + a1) / 2;
      P.box('yellow', a0, a1, lo + 0.06, hi - 0.06, s * (hf - 0.04), s * (hf - 0.01));
      P.box('dark', m - 0.1, m + 0.1, hi - 0.32, hi - 0.25, s * (hf - 0.01), s * (hf + 0.03));
    }
  }

  // motor del chasis bajo la cubierta, con rejillas a ambos lados, silenciador y salida del escape
  if (L.engGap) {
    const e0 = L.engGap[0] + 0.1, e1 = L.engGap[1] - 0.1, eh0 = dLo - 0.05, eh1 = dHi - 0.32;
    P.box('greyDeep', e0, e1, eh0, eh1, -hf + 0.05, hf - 0.05);
    for (const s of [-1, 1]) {
      const nl = Math.max(3, Math.floor((e1 - e0 - 0.4) / 0.2));
      for (let i = 0; i < nl; i++) {
        const x = e0 + 0.2 + (i * (e1 - e0 - 0.4)) / nl;
        P.box('black', x, x + 0.1, eh0 + 0.25, eh1 - 0.15, s * (hf - 0.05), s * (hf - 0.02));
      }
      P.box('yellow', e0 + 0.05, e1 - 0.05, eh1 - 0.12, eh1 - 0.05, s * (hf - 0.05), s * (hf - 0.03));
    }
    P.cyl('steel', [e0 + 0.2, eh0 - 0.15, hf - 0.45], [e1 - 0.2, eh0 - 0.15, hf - 0.45], 0.26, 14);
    P.cyl('dark', [e1 - 0.35, eh0 - 0.15, hf - 0.45], [e1 - 0.35, eh0 - 0.15, hf + 0.15], 0.08, 8);
  }

  // cajones de estabilizadores con franjas de advertencia
  L.outBox.forEach(([x0, x1]) => {
    P.box('greyDark', x0, x1, dLo + 0.05, dLo + 1.1, -hf - 0.04, hf + 0.04);
    P.box('greyDeep', x0 - 0.03, x1 + 0.03, dLo + 1.1, dLo + 1.2, -hf - 0.06, hf + 0.06);
    const n = 6, w = (x1 - x0 - 0.1) / n;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const a = x0 + 0.05 + i * w;
      P.box(i % 2 ? 'black' : 'warn', a, a + w, dLo + 0.2, dLo + 0.95, s * (hf + 0.04), s * (hf + 0.06));
    }
  });

  // frente: parrilla, faros, intermitentes, parachoques en cuña y gancho de remolque
  if (!L.noCab) {
    if (cabTop - 1.12 > cabLow + 0.2) P.box('black', L1, L1 + 0.03, cabLow + 0.1, cabTop - 1.12, -hf + 0.2, hf - 0.2);
    for (let i = 0; i < 3; i++) {
      const y = cabLow + 0.18 + i * 0.18;
      if (y + 0.06 < cabTop - 1.12) P.box('greyDeep', L1 + 0.03, L1 + 0.05, y, y + 0.06, -hf + 0.3, hf - 0.3);
    }
  } else {
    P.ext('yellow', [[L1 - 0.4, dLo - 0.2], [L1, dLo + 0.2], [L1, dHi - 0.1], [L1 - 0.4, dHi]], -hf + 0.2, hf - 0.2);
  }
  P.ext('grey', [[L1 - 0.3, dLo - 0.25], [L1 + 0.22, dLo - 0.25], [L1 + 0.3, dLo + 0.05], [L1 + 0.2, dLo + 0.4], [L1 - 0.3, dLo + 0.4]], -hf, hf);
  for (const s of [-1, 1]) {
    P.box('lamp', L1 + 0.18, L1 + 0.24, dLo - 0.05, dLo + 0.12, Math.min(s * (hf - 0.55), s * (hf - 0.12)), Math.max(s * (hf - 0.55), s * (hf - 0.12)));
    P.box('beacon', L1 + 0.16, L1 + 0.22, dLo + 0.15, dLo + 0.25, Math.min(s * (hf - 0.55), s * (hf - 0.35)), Math.max(s * (hf - 0.55), s * (hf - 0.35)));
  }
  P.box('black', L1 + 0.3, L1 + 0.42, dLo - 0.15, dLo + 0.05, -0.35, 0.35);

  // trasera: voladizo achaflanado, panel de franjas, pilotos rojos y escape (horizontal, bajo la cubierta)
  P.ext('grey', [[L0, dLo + 0.2], [L0 + 0.45, dLo - 0.15], [L0 + 0.9, dLo - 0.15], [L0 + 0.9, dHi - 0.3], [L0, dHi - 0.3]], -hf, hf);
  for (let i = 0; i < 8; i++) P.box(i % 2 ? 'black' : 'warn', L0 - 0.03, L0, dLo + 0.3, dLo + 0.75, -hf + (i * hf) / 4, -hf + ((i + 1) * hf) / 4);
  for (const s of [-1, 1]) {
    const za = s * (hf - 0.45), zb = s * (hf - 0.1);
    P.box('red', L0 - 0.05, L0, dLo + 0.85, dLo + 1.1, Math.min(za, zb), Math.max(za, zb));
  }
  P.cyl('dark', [L0 + 0.9, dLo + 0.05, -hf + 0.35], [L0 - 0.08, dLo + 0.05, -hf + 0.35], 0.09, 8);

  // equipo sobre la cubierta delantera (caja de herramientas y depósito hidráulico), bajo la pluma tumbada
  const dk = L.deck;
  if (dk.x1 - dk.x0 > 1.4 && dk.top - dHi > 0.08) {
    const tx = dk.x0 + 0.9;
    P.box('yellowDark', tx - 0.7, tx + 0.7, dHi, dk.top, 0.1, hf - 0.25);
    P.cyl('chrome', [tx, dHi, -0.75], [tx, dk.top, -0.75], 0.32, 16);
    if (dk.x1 - dk.x0 > 2.4) P.box('black', tx + 0.6, tx + 1.3, dHi, dk.top, -hf + 0.3, -0.3);
  }
  // apoyo de pluma
  const rX = L.restX, rH = L.restH;
  for (const s of [-1, 1]) if (rH - 0.25 > dHi + 0.02) P.box('yellowDark', rX - 0.12, rX + 0.12, dHi, rH - 0.25, s * 0.45, s * 0.7);
  P.box('yellowDark', rX - 0.2, rX + 0.2, Math.max(dHi - 0.1, rH - 0.3), rH - 0.1, -0.75, 0.75);
  P.box('black', rX - 0.15, rX + 0.15, rH - 0.1, rH, -0.5, 0.5);

  if (!L.noCab) buildCab(T, L, cabP);
}

/** Cabina del conductor estilo europeo: baja, frente plano, sin capó, a la izquierda (o a todo el ancho en la AT 60). */
function buildCab(T: WheeledSpec, L: Layout, P: Parts) {
  const L1 = T.len[1], hf = L.hf, dHi = T.deckHi;
  const { x0: cabX0, y0: cabLow, y1: cabTop, z0: cw0, z1: cw1 } = L.cab;
  P.ext('yellow', [[cabX0, cabLow], [L1, cabLow], [L1, cabTop - 0.16], [L1 - 0.14, cabTop], [cabX0, cabTop]], cw0, cw1);
  P.box('glass', L1, L1 + 0.03, cabTop - 1.0, cabTop - 0.2, cw0 + 0.1, cw1 - 0.08);
  P.box('black', L1, L1 + 0.035, cabTop - 1.06, cabTop - 1.0, cw0 + 0.06, cw1 - 0.04);
  // ventanas laterales (las dos en la cabina ancha), puerta, manilla y estribo
  const sides: [number, number][] = [[cw0 - 0.03, cw0]];
  if (L.fullCab) sides.push([cw1, cw1 + 0.03]);
  for (const [a, b] of sides) P.box('glass', cabX0 + 0.25, L1 - 0.12, cabTop - 0.92, cabTop - 0.18, a, b);
  const dX = cabX0 + 0.12;
  P.box('yellowShade', dX, dX + 0.03, cabLow + 0.1, cabTop - 0.1, cw0 - 0.04, cw0);
  P.box('dark', dX + 0.25, dX + 0.5, cabTop - 1.1, cabTop - 1.02, cw0 - 0.05, cw0);
  if (cabLow - 0.3 > 0.12) P.box('dark', dX + 0.1, dX + 0.75, cabLow - 0.3, cabLow - 0.23, cw0 - 0.25, cw0 + 0.05);
  P.box('yellowDark', cabX0 + 0.05, L1 - 0.2, cabTop, cabTop + 0.06, cw0 + 0.05, cw1 - 0.05);
  // retrovisores tipo autobús delante de la cabina
  const mirrors = L.fullCab ? [-1, 1] : [-1];
  for (const s of mirrors) {
    const ze = s < 0 ? cw0 : cw1;
    P.cyl('black', [L1 - 0.05, cabTop - 0.15, ze - s * 0.1], [L1 + 0.3, cabTop - 0.05, ze + s * 0.25], 0.03, 6);
    P.box('black', L1 + 0.22, L1 + 0.32, cabTop - 0.75, cabTop - 0.1, Math.min(ze + s * 0.18, ze + s * 0.42), Math.max(ze + s * 0.18, ze + s * 0.42));
  }
  if (!L.fullCab) {
    // a la derecha de la cabina: cubierta baja hasta el frente con rejillas
    P.ext('yellowDark', [[cabX0, cabLow], [L1, cabLow], [L1, dHi - 0.1], [L1 - 0.12, dHi + 0.02], [cabX0, dHi + 0.02]], cw1, hf);
    for (let i = 0; i < 3; i++) P.box('black', cabX0 + 0.3 + i * 0.32, cabX0 + 0.45 + i * 0.32, cabLow + 0.15, dHi - 0.2, hf, hf + 0.02);
  }
}
