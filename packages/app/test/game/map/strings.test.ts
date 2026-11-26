import { describe, expect, it } from 'vitest';
import {
  localizedMapText,
  localizedMapTextWithLang,
  mapStringLookup,
  mapStringLookupWithLang,
} from '../../../src/game/map/strings.js';

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

describe('localizedMapText', () => {
  it('reads the chosen language, else the first shipped one in preference order', () => {
    const name = { pol: 'ARABSKIE WYSPY', eng: 'ARABIAN ISLANDS' };
    expect(localizedMapText(name, 'eng')).toBe('ARABIAN ISLANDS');
    expect(localizedMapText(name, 'pol')).toBe('ARABSKIE WYSPY');
    expect(localizedMapText({ eng: 'Only English' }, 'pol')).toBe('Only English');
    expect(localizedMapText({ rus: 'НОВАЯ' }, 'eng')).toBe('НОВАЯ');
    expect(localizedMapText(undefined, 'eng')).toBeUndefined();
  });
});

describe('localizedMapTextWithLang', () => {
  it("names the language each text read in, and the reader's own as null", () => {
    const name = { pol: 'ARABSKIE WYSPY', eng: 'ARABIAN ISLANDS' };
    expect(localizedMapTextWithLang(name, 'eng')).toEqual({ text: 'ARABIAN ISLANDS', lang: null });
    expect(localizedMapTextWithLang(name, 'ger')).toEqual({ text: 'ARABSKIE WYSPY', lang: 'pol' });
    expect(localizedMapTextWithLang(undefined, 'eng')).toBeUndefined();
  });
});

describe('mapStringLookupWithLang', () => {
  const strings = { pol: { '1': 'Drewno dla sąsiada' }, eng: { '1': 'Timber for the neighbour' } };

  it('carries the table language beside the string', () => {
    const german = mapStringLookupWithLang(strings, 'ger');
    expect(german(1)).toEqual({ text: 'Drewno dla sąsiada', lang: 'pol' }); // the registry order reads Polish first
    const english = mapStringLookupWithLang(strings, 'eng');
    expect(english(1)).toEqual({ text: 'Timber for the neighbour', lang: null });
    expect(english(9)).toBeUndefined();
    expect(mapStringLookupWithLang(null, 'pol')(1)).toBeUndefined();
  });
});
