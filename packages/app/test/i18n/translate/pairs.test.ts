import { describe, expect, it } from 'vitest';
import { readsForeign, translateRoute } from '../../../src/i18n/translate/pairs.js';

describe('translateRoute', () => {
  it('chains over English where no direct model answers', () => {
    expect(translateRoute('pol', 'ger')).toEqual({ from: 'pol', to: 'ger', pairs: ['pl-en', 'en-de'] });
    expect(translateRoute('ger', 'pol')).toEqual({ from: 'ger', to: 'pol', pairs: ['de-en', 'en-pl'] });
    expect(translateRoute('ger', 'rus')).toEqual({ from: 'ger', to: 'rus', pairs: ['de-en', 'en-ru'] });
    expect(translateRoute('pol', 'chs')).toEqual({ from: 'pol', to: 'chs', pairs: ['pl-en', 'en-zh'] });
    expect(translateRoute('rus', 'ita')).toEqual({ from: 'rus', to: 'ita', pairs: ['ru-en', 'en-it'] });
  });

  it('takes the pinned direct model where one exists', () => {
    expect(translateRoute('eng', 'ger')).toEqual({ from: 'eng', to: 'ger', pairs: ['en-de'] });
    expect(translateRoute('ger', 'eng')).toEqual({ from: 'ger', to: 'eng', pairs: ['de-en'] });
    expect(translateRoute('eng', 'chs')).toEqual({ from: 'eng', to: 'chs', pairs: ['en-zh'] });
    expect(translateRoute('eng', 'cht')).toEqual({ from: 'eng', to: 'cht', pairs: ['en-zh_hant'] });
    expect(translateRoute('ita', 'eng')).toEqual({ from: 'ita', to: 'eng', pairs: ['it-en'] });
  });

  it("answers null for a reader's own language and for a pair no model chain answers", () => {
    expect(translateRoute('ger', 'ger')).toBeNull();
    // Every en-centric registry answers en↔X directly, so the pivot can never be needed there.
    expect(translateRoute('pol', 'eng')).toEqual({ from: 'pol', to: 'eng', pairs: ['pl-en'] });
    // A map authored in Traditional Chinese reads translated everywhere else.
    expect(translateRoute('cht', 'eng')).toEqual({ from: 'cht', to: 'eng', pairs: ['zh_hant-en'] });
    expect(translateRoute('cht', 'ger')).toEqual({ from: 'cht', to: 'ger', pairs: ['zh_hant-en', 'en-de'] });
    // A map authored in Simplified Chinese reads translated everywhere else, too — over the pinned
    // zh-en model, without which such a map answered nothing in any language.
    expect(translateRoute('chs', 'eng')).toEqual({ from: 'chs', to: 'eng', pairs: ['zh-en'] });
    expect(translateRoute('chs', 'ger')).toEqual({ from: 'chs', to: 'ger', pairs: ['zh-en', 'en-de'] });
    expect(translateRoute('chs', 'cht')).toEqual({ from: 'chs', to: 'cht', pairs: ['zh-en', 'en-zh_hant'] });
    expect(translateRoute('cht', 'chs')).toEqual({ from: 'cht', to: 'chs', pairs: ['zh_hant-en', 'en-zh'] });
  });
});

describe('readsForeign', () => {
  it('counts only languages the reader does not read by choice', () => {
    expect(readsForeign('pol', 'ger')).toBe(true);
    expect(readsForeign('ger', 'ger')).toBe(false);
    // A Traditional Chinese reader reads Simplified by its own fallbacks.
    expect(readsForeign('chs', 'cht')).toBe(false);
    expect(readsForeign('pol', 'cht')).toBe(true);
    expect(readsForeign('rus', 'ita')).toBe(true);
  });

  it('reads the English a map falls back to as foreign in every other language', () => {
    // English is the table nearly every map ships, so it must translate for each other reader —
    // an Italian, Simplified or Traditional Chinese reader does not read it by choice after all.
    expect(readsForeign('eng', 'ita')).toBe(true);
    expect(readsForeign('eng', 'chs')).toBe(true);
    expect(readsForeign('eng', 'cht')).toBe(true);
    expect(readsForeign('eng', 'ger')).toBe(true);
    expect(readsForeign('eng', 'pol')).toBe(true);
    expect(readsForeign('eng', 'rus')).toBe(true);
    expect(readsForeign('eng', 'eng')).toBe(false);
  });
});
