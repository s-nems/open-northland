import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { setActiveLocale, tribeName } from '../../../src/i18n/index.js';
import { translatedTribeName } from '../../../src/i18n/translate/tribe-name.js';

const tribe = CIVILIZATION_TRIBES[0];
if (tribe === undefined) throw new Error('tribe name test: no civilization tribes');
const english = 'Vikings';

beforeEach(() => setActiveLocale('ger'));

describe('translatedTribeName', () => {
  it('keeps the localized label until the device translation lands', () => {
    const fallback = tribeName(tribe);
    expect(translatedTribeName(tribe, english, ({ text }) => text, 'ger', true)).toBe(fallback);
    expect(translatedTribeName(tribe, english, () => 'Wikinger', 'ger', true)).toBe('Wikinger');
  });

  it('uses the game-data source name when English is the requested language', () => {
    expect(translatedTribeName(tribe, english, () => 'unused', 'eng', true)).toBe(english);
  });

  it('keeps the normal localized name if the source name is unavailable or translation is off', () => {
    const fallback = tribeName(tribe);
    expect(translatedTribeName(tribe, undefined, () => 'Wikinger', 'ger', true)).toBe(fallback);
    expect(translatedTribeName(tribe, english, () => 'Wikinger', 'ger', false)).toBe(fallback);
    expect(translatedTribeName(tribe, english, () => 'Wikinger', null, true)).toBe(fallback);
  });
});
