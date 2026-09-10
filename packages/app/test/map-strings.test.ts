import { describe, expect, it } from 'vitest';
import { mapStringLookup } from '../src/game/map-strings.js';

describe('mapStringLookup', () => {
  const strings = {
    pol: { '1': 'Drewno dla sąsiada', '2': 'Sakiewka monet' },
    eng: { '1': 'Timber for the neighbour', '3': 'English only' },
  };

  it('reads the chosen language first and falls back through the shipped ones', () => {
    const english = mapStringLookup(strings, 'eng');
    expect(english(1)).toBe('Timber for the neighbour');
    expect(english(2)).toBe('Sakiewka monet'); // only the Polish table carries it
    const polish = mapStringLookup(strings, 'pol');
    expect(polish(1)).toBe('Drewno dla sąsiada');
    expect(polish(3)).toBe('English only');
  });

  it('answers nothing for an id no table carries or with no table at all, whatever the language', () => {
    expect(mapStringLookup(strings, 'eng')(9)).toBeUndefined();
    expect(mapStringLookup(strings, 'ger')(2)).toBe('Sakiewka monet'); // no German table: the preference order decides
    expect(mapStringLookup(null, 'pol')(1)).toBeUndefined();
  });
});
