import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { messages, setActiveLocale, tribeName } from '../../../src/i18n/index.js';
import { translatedTribeName } from '../../../src/i18n/translate/tribe-name.js';

const tribe = CIVILIZATION_TRIBES[0];
if (tribe === undefined) throw new Error('tribe name test: no civilization tribes');
const english = messages('eng').tribeNames[tribe];
if (english === undefined) throw new Error('tribe name test: no English catalogue name');

beforeEach(() => setActiveLocale('ger'));

describe('translatedTribeName', () => {
  it('keeps the localized label until the device translation lands', () => {
    const fallback = tribeName(tribe);
    expect(translatedTribeName(tribe, ({ text }) => text, 'ger', true)).toBe(fallback);
    expect(translatedTribeName(tribe, () => 'Übersetzter Stamm', 'ger', true)).toBe('Übersetzter Stamm');
  });

  it('uses the original catalogue name when English is the requested language', () => {
    expect(translatedTribeName(tribe, () => 'unused', 'eng', true)).toBe(english);
  });

  it('keeps the normal localized name when translation is off', () => {
    expect(translatedTribeName(tribe, () => 'Übersetzter Stamm', 'ger', false)).toBe(tribeName(tribe));
    expect(translatedTribeName(tribe, () => 'Übersetzter Stamm', null, true)).toBe(tribeName(tribe));
  });
});
