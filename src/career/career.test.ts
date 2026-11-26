import { describe, expect, it } from 'vitest';
import { buy, cranesFor, finish, maintain, newCareer, offerDoable, offerLevel, priceOf, rentOf, settle, wearFaults, importCareer, exportCareer, maintenanceOf, type Outcome } from './career';

const ALL = { ruedas: 1, orugas: 1, torre: 1, tandem: 1 };
const RUEDAS = { ruedas: 1 };
const typical = (ok = true): Outcome => ({ ok, stars: 2, medal: 'bronce', bumps: 1, hard: 0, prox: 0, excl: 0, skips: 0, late: 0, tipped: false });

describe('carrera (fase 25): equilibrio', () => {
  it('precios: alquiler y compra crecen con la grúa; el mantenimiento con el desgaste', () => {
    expect([rentOf('small'), rentOf('medium'), rentOf('large')]).toEqual([800, 1300, 3700]);
    expect(priceOf('medium')).toBe(39000);
    expect(maintenanceOf({ id: 'medium', wear: 50 })).toBe(1150);
  });

  it('30 minutos (8 contratos de ~4 min, 2 estrellas, un golpe, uno fallado): el dinero sube y se puede comprar la AT 60', () => {
    const c = newCareer(1234), log: number[] = [];
    for (let k = 0; k < 8; k++) {
      // el jugador elige la oferta que más deja con una grúa propia o la más barata de alquilar
      let best: { o: (typeof c.offers)[number]; crane: string; net: number } | null = null;
      for (const o of c.offers) {
        const L = offerLevel(o)!;
        for (const id of cranesFor(L, RUEDAS)) {
          const own = c.fleet.some((f) => f.id === id), net = o.pay - (own ? 0 : rentOf(id));
          if (!best || net > best.net) best = { o, crane: id, net };
        }
      }
      expect(best, `día ${c.day}`).not.toBeNull();
      const s = settle(best!.o, best!.crane as never, c.fleet.some((f) => f.id === best!.crane), typical(k !== 3));
      finish(c, s, RUEDAS);
      if (c.fleet[0].wear >= 40) maintain(c, c.fleet[0].id);
      log.push(c.money);
    }
    expect(c.money, log.join(', ')).toBeGreaterThan(15000 + 10000);
    expect(buy(c, 'medium'), `dinero ${c.money}`).toBe(true);
  });

  it('las ofertas siempre se pueden hacer: 15 días con la licencia de ruedas y con todas', () => {
    for (const lic of [RUEDAS, ALL]) {
      const c = newCareer(99);
      for (let d = 0; d < 15; d++) {
        expect(c.offers.length).toBeGreaterThanOrEqual(3);
        for (const o of c.offers) expect(offerDoable(o, lic), JSON.stringify(o)).toBe(true);
        finish(c, settle(c.offers[0], 'small', true, typical()), lic);
      }
    }
  }, 120_000);

  it('fallar y volcar cuestan; el desgaste trae averías; guardar y cargar', () => {
    const c = newCareer(5);
    const s = settle(c.offers[0], 'medium', false, { ...typical(false), tipped: true });
    expect(s.pay).toBe(0);
    expect(s.total).toBe(-(rentOf('medium') + 5000 + 1500 + 300));
    expect(wearFaults(50, 1)).toHaveLength(0);
    expect(wearFaults(60, 1)).toHaveLength(1);
    expect(wearFaults(95, 1)).toHaveLength(2);
    expect(offerLevel(c.offers[0], 95, 3)!.events!.length).toBeGreaterThanOrEqual(2);
    expect(importCareer(exportCareer(c))).toEqual(c);
    expect(importCareer('{"v":1}')).toBeNull();
  });
});
