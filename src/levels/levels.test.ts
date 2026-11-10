import { describe, expect, it } from 'vitest';
import { loadLevelsReference } from '../crane/reference';
import { CRANES } from '../crane/cranes';
import { LEVELS } from './levels';

describe('niveles', () => {
  it('son los 13 de la referencia, con los mismos datos', () => {
    const ref = loadLevelsReference();
    expect(LEVELS.length).toBe(13);
    expect(JSON.parse(JSON.stringify(LEVELS))).toEqual(JSON.parse(JSON.stringify(ref)));
  });
  it('solo nombran grúas que existen', () => {
    for (const L of LEVELS) {
      for (const id of [...L.cranes, L.rec, ...Object.keys(L.why)]) expect(CRANES[id as keyof typeof CRANES], `${L.name}: ${id}`).toBeTruthy();
      expect(L.cranes).toContain(L.rec);
    }
  });
});
