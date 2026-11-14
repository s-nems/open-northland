import { describe, expect, it } from 'vitest';
import { isPackLanguage, isSourceLanguage, LANGUAGES, textReadingOrder } from '../src/languages.js';

describe('textReadingOrder', () => {
  it('reads a source language first and then the registry order', () => {
    expect(textReadingOrder('ger')).toEqual(['ger', 'pol', 'eng', 'rus', 'ita', 'chs', 'cht']);
  });
  it('sends a Chinese reader to English before the mod language', () => {
    expect(textReadingOrder('chs').slice(0, 2)).toEqual(['chs', 'eng']);
    expect(textReadingOrder('cht').slice(0, 3)).toEqual(['cht', 'chs', 'eng']);
  });
  it('sends an Italian reader to English before the mod language', () => {
    expect(textReadingOrder('ita').slice(0, 2)).toEqual(['ita', 'eng']);
  });
  it('lets the pack ship Italian without making it a source language', () => {
    expect(isPackLanguage('ita')).toBe(true);
    expect(isSourceLanguage('ita')).toBe(false);
    expect(isPackLanguage('chs')).toBe(false);
  });
  it('lists every language exactly once', () => {
    for (const lang of LANGUAGES) expect([...textReadingOrder(lang)].sort()).toEqual([...LANGUAGES].sort());
  });
});
