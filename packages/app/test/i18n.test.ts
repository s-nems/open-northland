import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizedBuildingName } from '../src/catalog/building-i18n.js';
import {
  defaultLocale,
  localeParam,
  type Messages,
  messages,
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
    expect(defaultLocale()).toBe('eng');
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

  it('has localized menu metadata for every registered scene', () => {
    for (const scene of SCENES) {
      const key = scene.id as keyof Messages['scene'];
      expect(messages('pol').scene[key]).toBeDefined();
      expect(messages('eng').scene[key]).toBeDefined();
    }
  });
});
