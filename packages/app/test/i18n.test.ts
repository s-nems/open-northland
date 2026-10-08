import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizedBuildingName } from '../src/catalog/building-i18n.js';
import {
  bcp47Tag,
  defaultLocale,
  formatClockTime,
  LOCALE_CODES,
  localeParam,
  type Messages,
  messages,
  pluralForm,
  professionLabel,
  resolveLocale,
  setActiveLocale,
} from '../src/i18n/index.js';
import { SCENES } from '../src/scenes/index.js';

afterEach(() => {
  setActiveLocale('pol');
  vi.unstubAllGlobals();
});

function browserLanguages(languages: readonly string[]): void {
  vi.stubGlobal('navigator', { languages });
}

describe('locale detection', () => {
  it('takes the first preferred language with a shipped catalog', () => {
    expect(resolveLocale(['pl-PL'])).toBe('pol');
    expect(resolveLocale(['en-GB'])).toBe('eng');
    expect(resolveLocale(['PL'])).toBe('pol');
    expect(resolveLocale(['zh-CN', 'pl-PL', 'en'])).toBe('pol');
  });

  it('falls back to English when no preference has a catalog', () => {
    expect(resolveLocale(['zh-CN'])).toBe('eng');
    expect(resolveLocale([])).toBe('eng');
  });

  it('reads the default from the browser preference list', () => {
    browserLanguages(['zh-CN', 'pl-PL']);
    expect(defaultLocale()).toBe('pol');
    browserLanguages(['de-DE']);
    expect(defaultLocale()).toBe('ger');
    browserLanguages(['ru-RU']);
    expect(defaultLocale()).toBe('rus');
  });
});

describe('application locale', () => {
  it('accepts the public and short language codes, else the detected default', () => {
    browserLanguages(['pl-PL']);
    expect(localeParam(new URLSearchParams())).toBe('pol');
    browserLanguages(['en-US']);
    expect(localeParam(new URLSearchParams())).toBe('eng');
    expect(localeParam(new URLSearchParams('lang=pol'))).toBe('pol');
    expect(localeParam(new URLSearchParams('lang=pl'))).toBe('pol');
    expect(localeParam(new URLSearchParams('lang=eng'))).toBe('eng');
    expect(localeParam(new URLSearchParams('lang=en'))).toBe('eng');
  });

  it('drives hand-authored profession and building labels from one active locale', () => {
    setActiveLocale('eng');
    expect(professionLabel('smith')).toBe('Smith');
    expect(localizedBuildingName('barracks', 'fallback')).toBe('Barracks');

    setActiveLocale('pol');
    expect(professionLabel('smith')).toBe('Kowal');
    expect(localizedBuildingName('barracks', 'fallback')).toBe('Koszary');
  });

  it('writes a chat stamp as the local hour and minute', () => {
    const evening = new Date(2026, 0, 1, 21, 7, 45).getTime();
    expect(formatClockTime(evening, 'pl')).toBe('21:07');
    expect(formatClockTime(evening, 'de')).toBe('21:07');
  });

  it('has localized menu metadata for every registered scene', () => {
    for (const scene of SCENES) {
      const key = scene.id as keyof Messages['scene'];
      for (const locale of LOCALE_CODES) expect(messages(locale).scene[key]).toBeDefined();
    }
  });
});

describe('German and Russian catalogs', () => {
  it.each([
    ['ger', 'de', 'de-AT'],
    ['rus', 'ru', 'ru-RU'],
  ] as const)('recognizes %s in preferences, URLs and document language', (locale, tag, regional) => {
    expect(resolveLocale([regional, 'en-US'])).toBe(locale);
    expect(localeParam(new URLSearchParams({ lang: locale }))).toBe(locale);
    expect(localeParam(new URLSearchParams({ lang: tag }))).toBe(locale);
    expect(bcp47Tag(locale)).toBe(tag);
    setActiveLocale(locale);
    expect(localizedBuildingName('barracks', 'fallback')).toBe(messages(locale).building.barracks);
    expect(localizedBuildingName('barracks', 'fallback', tag)).toBe(messages(locale).building.barracks);
  });

  function leaves(value: unknown, path = ''): Map<string, string> {
    if (typeof value === 'string') return new Map([[path, value]]);
    if (value === null || typeof value !== 'object') throw new Error(`Not catalog text: ${path}`);
    return new Map(Object.entries(value).flatMap(([key, child]) => [...leaves(child, `${path}.${key}`)]));
  }

  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{[A-Za-z][A-Za-z0-9]*\}|%(?:\d+\$)?[sdiuf]/g)].map((m) => m[0]).sort();

  it.each(['ger', 'rus'] as const)(
    '%s translates every entry and preserves interpolation tokens',
    (locale) => {
      const source = leaves(messages('eng'));
      const translated = leaves(messages(locale));
      expect([...translated.keys()]).toEqual([...source.keys()]);
      for (const [key, text] of translated) {
        expect(text.trim(), key).not.toBe('');
        expect(text, key).not.toContain('�');
        expect(placeholders(text), key).toEqual(placeholders(source.get(key) ?? ''));
      }
    },
  );

  it('uses the Russian one/few/many forms at teen and tens boundaries', () => {
    const forms = messages('rus').network.members;
    for (const [count, word] of [
      [1, 'игрок'],
      [2, 'игрока'],
      [5, 'игроков'],
      [11, 'игроков'],
      [21, 'игрок'],
      [22, 'игрока'],
      [25, 'игроков'],
    ] as const) {
      expect(pluralForm(count, forms, 'ru')).toBe(`{count} ${word}`);
    }
    expect(pluralForm(2, messages('ger').mainMenu.mapSelect.maps, 'de')).toBe('{count} Karten');
  });
});
