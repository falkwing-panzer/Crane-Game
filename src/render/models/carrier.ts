import type { WheeledSpec } from '../../crane/cranes';
import type { Parts } from './builder';
import type { Layout } from './layout';
import { ladder, slab } from './details';

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

  // cubierta: plataforma gris (como las imágenes: el chasis es gris y solo la cabina y el capó son del color de la
  // grúa), chapa superior y filete lateral claro
  P.box('greyDark', L0 + 0.1, cabX0, dHi - 0.3, dHi, -hf, hf);
  P.box('greyDeep', L0 + 0.3, cabX0 - 0.1, dHi, dHi + 0.04, -hf + 0.12, hf - 0.12);
  for (const s of [-1, 1]) P.box('chrome', L0 + 0.1, cabX0, dHi - 0.12, dHi - 0.08, s * hf, s * (hf + 0.02));

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
    P.box('greyDeep', x0, x1, lo, hi, s * zin, s * (hf - 0.04));
    const nd = Math.max(1, Math.round((x1 - x0) / 1.1)), dw = (x1 - x0) / nd;
    for (let i = 0; i < nd; i++) {
      const a0 = x0 + i * dw + 0.05, a1 = x0 + (i + 1) * dw - 0.05, m = (a0 + a1) / 2;
      P.box('grey', a0, a1, lo + 0.06, hi - 0.06, s * (hf - 0.04), s * (hf - 0.01));
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
      P.box('grey', e0 + 0.05, e1 - 0.05, eh1 - 0.12, eh1 - 0.05, s * (hf - 0.05), s * (hf - 0.03));
    }
    P.cyl('steel', [e0 + 0.2, eh0 - 0.15, hf - 0.45], [e1 - 0.2, eh0 - 0.15, hf - 0.45], 0.26, 14);
    P.cyl('dark', [e1 - 0.35, eh0 - 0.15, hf - 0.45], [e1 - 0.35, eh0 - 0.15, hf + 0.15], 0.08, 8);
  }

  // cajones de estabilizadores con franjas de advertencia rojas y blancas (como las imágenes)
  L.outBox.forEach(([x0, x1]) => {
    P.box('greyDark', x0, x1, dLo + 0.05, dLo + 1.1, -hf - 0.04, hf + 0.04);
    P.box('greyDeep', x0 - 0.03, x1 + 0.03, dLo + 1.1, dLo + 1.2, -hf - 0.06, hf + 0.06);
    const n = 6, w = (x1 - x0 - 0.1) / n;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const a = x0 + 0.05 + i * w;
      P.box(i % 2 ? 'chrome' : 'red', a, a + w, dLo + 0.2, dLo + 0.95, s * (hf + 0.04), s * (hf + 0.06));
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
  for (let i = 0; i < 8; i++) P.box(i % 2 ? 'chrome' : 'red', L0 - 0.03, L0, dLo + 0.3, dLo + 0.75, -hf + (i * hf) / 4, -hf + ((i + 1) * hf) / 4);
  for (const s of [-1, 1]) {
    const za = s * (hf - 0.45), zb = s * (hf - 0.1);
    P.box('red', L0 - 0.05, L0, dLo + 0.85, dLo + 1.1, Math.min(za, zb), Math.max(za, zb));
  }
  P.cyl('dark', [L0 + 0.9, dLo + 0.05, -hf + 0.35], [L0 - 0.08, dLo + 0.05, -hf + 0.35], 0.09, 8);
  // matrícula y enganche de remolque (fase 8B)
  P.box('chrome', L0 - 0.04, L0, dLo + 0.8, dLo + 0.95, -0.28, 0.28);
  P.box('black', L0 - 0.14, L0 + 0.1, dLo + 0.02, dLo + 0.22, -0.18, 0.18);
  P.cyl('chrome', [L0 - 0.1, dLo + 0.12, -0.08], [L0 - 0.1, dLo + 0.12, 0.08], 0.06, 8);
  detailCarrier(T, L, P);
  // escalerilla trasera a la derecha, para subir a la cubierta (fase 8B)
  const lz = hf - 0.75;
  ladder(P, 'greyDeep', [L0 - 0.1, lz], [L0 - 0.1, lz + 0.4], dLo - 0.2, dHi + 0.02);

  // equipo sobre la cubierta delantera (caja de herramientas y depósito hidráulico), bajo la pluma tumbada
  const dk = L.deck;
  if (dk.x1 - dk.x0 > 1.4 && dk.top - dHi > 0.08) {
    const tx = dk.x0 + 0.9;
    // capó del motor (como el bloque amarillo detrás de la cabina en las imágenes) con rejillas
    P.box('yellow', tx - 0.7, tx + 0.7, dHi, dk.top, 0.1, hf - 0.25);
    for (let i = 0; i < 4; i++) {
      const x = tx - 0.5 + i * 0.28;
      if (dk.top - dHi > 0.35) P.box('black', x, x + 0.12, dHi + 0.12, dk.top - 0.1, hf - 0.25, hf - 0.23);
    }
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
  // frente: vertical hasta el parabrisas, que se inclina hacia atrás, y techo redondeado (fase 8B; antes recto)
  const wa: [number, number] = [L1, cabTop - 1.06], wb: [number, number] = [L1 - 0.22, cabTop - 0.14];
  P.ext('yellow', [[cabX0, cabLow], [L1, cabLow], wa, wb, [L1 - 0.3, cabTop - 0.03], [L1 - 0.4, cabTop], [cabX0, cabTop]], cw0, cw1);
  const wt = (u: number): [number, number] => [wa[0] + (wb[0] - wa[0]) * u, wa[1] + (wb[1] - wa[1]) * u];
  // parabrisas en dos piezas (montante central) y franja oscura debajo
  const zm = (cw0 + cw1) / 2;
  slab(P, 'glass', wt(0.07), wt(0.95), cw0 + 0.1, zm - 0.04);
  slab(P, 'glass', wt(0.07), wt(0.95), zm + 0.04, cw1 - 0.08);
  slab(P, 'dark', wt(0), wt(0.07), cw0 + 0.06, cw1 - 0.04, 0.035);
  // ventanas laterales que siguen el parabrisas (las dos en la cabina ancha)
  const sides: [number, number][] = [[cw0 - 0.03, cw0]];
  if (L.fullCab) sides.push([cw1, cw1 + 0.03]);
  const wy0 = cabTop - 0.92, wy1 = cabTop - 0.2, wf = (y: number) => L1 - 0.12 - (0.22 * (y - wa[1])) / (wb[1] - wa[1]);
  for (const [a, b] of sides) P.ext('glass', [[cabX0 + 0.25, wy0], [wf(wy0), wy0], [wf(wy1), wy1], [cabX0 + 0.25, wy1]], a, b);
  const dX = cabX0 + 0.12;
  P.box('yellowShade', dX, dX + 0.03, cabLow + 0.1, cabTop - 0.1, cw0 - 0.04, cw0);
  P.box('dark', dX + 0.25, dX + 0.5, cabTop - 1.1, cabTop - 1.02, cw0 - 0.05, cw0);
  if (cabLow - 0.3 > 0.12) P.box('dark', dX + 0.1, dX + 0.75, cabLow - 0.3, cabLow - 0.23, cw0 - 0.25, cw0 + 0.05);
  if (cabLow - 0.62 > 0.25) P.box('dark', dX + 0.1, dX + 0.75, cabLow - 0.62, cabLow - 0.55, cw0 - 0.3, cw0 + 0.05);
  // limpiaparabrisas (sobre el cristal) y visera encima (fase 8B)
  const nx = (wb[1] - wa[1]) / Math.hypot(wb[0] - wa[0], wb[1] - wa[1]), ny = -(wb[0] - wa[0]) / Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
  const onGlass = (u: number, z: number): [number, number, number] => { const q = wt(u); return [q[0] + nx * 0.045, q[1] + ny * 0.045, z]; };
  for (const z of [cw0 + 0.3, zm + 0.15]) P.cyl('black', onGlass(0.1, z), onGlass(0.6, z + 0.35), 0.014, 4);
  P.box('dark', L1 - 0.36, L1 - 0.14, cabTop - 0.09, cabTop - 0.04, cw0 + 0.05, cw1 - 0.05);
  P.box('yellowDark', cabX0 + 0.05, L1 - 0.45, cabTop, cabTop + 0.06, cw0 + 0.05, cw1 - 0.05);
  // asidero junto a la puerta
  P.cyl('black', [dX - 0.06, cabLow + 0.35, cw0 - 0.07], [dX - 0.06, cabTop - 0.45, cw0 - 0.07], 0.022, 5);
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

/**
 * Detalles del chasis (fase 8B, aproximación visual): pilotos de gálibo ámbar a los lados, calderines de aire bajo los
 * cofres y faldones detrás de cada grupo de ejes. Todo por debajo de la cubierta y dentro del ancho del chasis.
 */
function detailCarrier(T: WheeledSpec, L: Layout, P: Parts) {
  const [L0] = T.len, hf = L.hf, dLo = T.deckLo, dHi = T.deckHi, wR = T.wheelR;
  const inOut = (x: number, m: number) => L.outBox.some(([a, b]) => x > a - m && x < b + m);
  // pilotos de gálibo sobre el filete, cada ~2,2 m (no sobre los cajones de los estabilizadores)
  for (let x = L0 + 0.6; x < L.cab.x0 - 0.3; x += 2.2) {
    if (inOut(x, 0.15)) continue;
    for (const s of [-1, 1]) P.box('beacon', x - 0.07, x + 0.07, dHi - 0.2, dHi - 0.13, Math.min(s * hf, s * (hf + 0.025)), Math.max(s * hf, s * (hf + 0.025)));
  }
  // calderines de aire bajo los cofres (en los huecos libres que no son el del motor ni el del depósito de la izquierda)
  const byLen = [...L.freeGaps].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  const tank = byLen.filter((g) => g !== L.engGap)[0];
  for (const g of L.freeGaps) {
    if (g === L.engGap || g[1] - g[0] < 1.3) continue;
    for (const s of [-1, 1]) {
      if (s < 0 && g === tank && g[1] - g[0] > 1.6) continue;
      const z = s * (hf - 0.42), hl = Math.min(0.6, (g[1] - g[0]) / 2 - 0.25), m = (g[0] + g[1]) / 2;
      P.cyl('grey', [m - hl, dLo + 0.04, z], [m + hl, dLo + 0.04, z], 0.16, 12);
      for (const e of [-1, 1]) P.box('dark', m + e * (hl - 0.15) - 0.03, m + e * (hl - 0.15) + 0.03, dLo - 0.13, dLo + 0.24, z - 0.18, z + 0.18);
    }
  }
  // faldones detrás de cada grupo de ejes (salvo el de más atrás si toca el voladizo trasero y el escape)
  const axles = [...T.axles].sort((p, q) => p - q), groups: number[][] = [];
  for (const a of axles) { const gg = groups[groups.length - 1]; if (gg && a - gg[gg.length - 1] < 2.0) gg.push(a); else groups.push([a]); }
  for (const gg of groups) {
    const x = gg[0] - wR - 0.17;
    if (x < L0 + 1.0 || inOut(x, 0.02)) continue;
    for (const s of [-1, 1]) P.box('black', x, x + 0.03, 0.3, wR + 0.25, Math.min(s * (hf - 0.62), s * (hf - 0.06)), Math.max(s * (hf - 0.62), s * (hf - 0.06)));
  }
}
