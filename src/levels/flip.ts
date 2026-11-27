import type { Level } from './levels';

// Fase 26: voltear una carga con dos grúas (de tumbada a de pie), más pequeño que el nivel 14. Medidas y pesos del
// juego (la referencia no tiene este trabajo): depósito de 16 m, Ø 3,5 m y 35 t sobre dos cunas; AT 500-8 en la
// cabeza y AT 220 en el pie.

const D = Math.PI / 180;

/** Alto de las cunas sobre las que llega tumbado el depósito */
const SADDLE_H = 1.0;

/**
 * Nivel 23: el depósito llega tumbado a lo largo de x, con la cabeza al oeste (orejeta 0 en la cara del extremo, que
 * sobresale 1,5 m, como la columna del nivel 14) y la del pie arriba, a 2 m del extremo este, en un poste de 1,2 m: a ras
 * del depósito el gancho de cola se apoyaba en él a mitad del giro, y en el costado lo ladeaba. La AT 500-8 queda
 * al sur de la cabeza con la pluma al norte; la AT 220, al norte del pie con la pluma al sur. La cimentación, al oeste
 * de donde estaba la cabeza, a unos 12 m de la principal: la alcanza girando con el depósito de pie.
 */
export const FLIP_LEVEL: Level = {
  name: 'Volteo de un depósito', type: 'Tándem', par: 900, wind: [1, 1, 0], ground: '#4a4d50', env: 'refinery',
  size: [90, 64],
  cranes: ['xl'], rec: 'xl', why: {},
  start: { x: 0, z: 0, h: 0 },
  tandem: {
    main: { id: 'xl', h: 0, slew: 90 * D, ang: 64 * D, Lb: 34 },
    tail: { id: 'large', h: 0, slew: -90 * D, ang: 60 * D, Lb: 20 },
  },
  brief: 'Un depósito de 35 t y 16 m llegó tumbado sobre dos cunas: hay que ponerlo de pie y apoyarlo en su cimentación. La AT 500-8 lo levanta por la cabeza y la AT 220 sostiene el pie mientras gira; {switch} cambia de grúa (la otra se queda quieta).',
  tips: [
    'Engancha las dos y separa el depósito de las cunas izando un poco con cada una.',
    'Iza con la AT 500-8 y sigue la cabeza del depósito con su pluma (gira y saca pluma) para que el cable no se tuerza; la AT 220 mantiene el pie a la misma altura y lo baja poco a poco.',
    'De pie, cuando la AT 220 ya casi no lleve nada, suéltala. Después gira con la AT 500-8 hasta la cimentación y apóyalo despacio.',
    'Falla si una grúa pasa del 100 % de LMI, si un cable se aparta más de 6° de la vertical, si el depósito se ladea más de 10° sobre su eje o si un gancho choca con la cabeza de su pluma.',
  ],
  boxes: [
    { x: 34, z: 32, w: 1.6, d: 4, h: SADDLE_H, kind: 'bed' },
    { x: 46, z: 32, w: 1.6, d: 4, h: SADDLE_H, kind: 'bed' },
    { x: 24, z: 34, w: 6, d: 6, h: 0.6, kind: 'pad' },
  ],
  crates: [{
    x: 40, z: 32, w: 16, d: 3.5, h: 3.5, m: 35, label: 'D-23', color: '#c9ced3', kind: 'vessel', stand: 'x',
    lugs: [{ x: -9.5, y: 0, z: 0 }, { x: 6, y: 2.95, z: 0 }],
  }],
  zones: [{ x: 24, z: 34, w: 6, d: 6, y: 0.6, label: 'CIMENTACIÓN' }],
};
