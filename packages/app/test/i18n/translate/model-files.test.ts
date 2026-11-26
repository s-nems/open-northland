import { describe, expect, it } from 'vitest';
import { TRANSLATE_MODELS } from '../../../src/i18n/translate/model-files.js';
import { translateRoute } from '../../../src/i18n/translate/pairs.js';

describe('TRANSLATE_MODELS', () => {
  const SHA256 = /^[0-9a-f]{64}$/;

  it('describes every pinned file exactly: name, Mozilla URL, size and hash', () => {
    expect(Object.keys(TRANSLATE_MODELS).sort()).toEqual(
      [
        'de-en',
        'en-de',
        'en-it',
        'en-pl',
        'en-ru',
        'en-zh',
        'en-zh_hant',
        'it-en',
        'pl-en',
        'ru-en',
        'zh-en',
        'zh_hant-en',
      ].sort(),
    );
    for (const [pair, model] of Object.entries(TRANSLATE_MODELS)) {
      expect(model.id).toBe(pair);
      expect(model.vocabs.length).toBeGreaterThan(0);
      for (const file of [model.model, model.shortlist, ...model.vocabs]) {
        expect(file.name).toMatch(/^(model|lex\.|vocab\.|srcvocab\.|trgvocab\.)/);
        expect(file.url.startsWith('https://storage.googleapis.com/moz-fx-translations-data')).toBe(true);
        expect(file.url.endsWith(`${file.name}.gz`)).toBe(true);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(SHA256);
      }
    }
  });

  it("answers every route the game's languages can ask for", () => {
    const gameLanguages = ['pol', 'eng', 'ger', 'rus', 'ita', 'chs', 'cht'] as const;
    // Traditional Chinese too: a map authored in it must read translated everywhere else, so the
    // snapshot pins its outbound pair alongside the en-centred ones.
    for (const from of ['pol', 'eng', 'ger', 'rus', 'ita', 'cht'] as const) {
      for (const to of gameLanguages) {
        const route = translateRoute(from, to);
        if (route === null) continue;
        for (const pair of route.pairs) {
          expect(TRANSLATE_MODELS[pair], `${from} to ${to} needs ${pair}`).toBeDefined();
        }
      }
    }
  });

  it('keeps the network weights apart per direction and two vocabularies for Chinese', () => {
    expect(TRANSLATE_MODELS['en-de']?.model.sha256).not.toBe(TRANSLATE_MODELS['de-en']?.model.sha256);
    expect(TRANSLATE_MODELS['en-zh_hant']?.vocabs.length).toBe(2);
  });
});
