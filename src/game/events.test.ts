import { describe, expect, it } from 'vitest';
import { Bus } from './events';

interface E { a: { n: number }; b: { s: string } }

describe('bus de eventos', () => {
  it('llama a los oyentes en orden y se pueden quitar', () => {
    const bus = new Bus<E>();
    const got: string[] = [];
    const off1 = bus.on('a', (p) => got.push(`1:${p.n}`));
    bus.on('a', (p) => got.push(`2:${p.n}`));
    bus.on('b', (p) => got.push(`b:${p.s}`));
    bus.emit('a', { n: 1 });
    off1();
    bus.emit('a', { n: 2 });
    bus.emit('b', { s: 'x' });
    expect(got).toEqual(['1:1', '2:1', '2:2', 'b:x']);
    expect(bus.count('a')).toBe(1);
    expect(bus.count()).toBe(2);
  });

  it('un oyente que se quita durante la emisión no rompe la lista; clear los quita todos', () => {
    const bus = new Bus<E>();
    let n = 0;
    const off = bus.on('a', () => { n++; off(); });
    bus.on('a', () => { n += 10; });
    bus.emit('a', { n: 0 });
    bus.emit('a', { n: 0 });
    expect(n).toBe(21);
    bus.clear();
    bus.emit('a', { n: 0 });
    expect(n).toBe(21);
    expect(bus.count()).toBe(0);
  });
});
