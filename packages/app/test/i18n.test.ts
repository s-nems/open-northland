import { afterEach, describe, expect, it } from 'vitest';
import { localizedBuildingName } from '../src/catalog/building-i18n.js';
import { localeParam, type Messages, messages, professionLabel, setActiveLocale } from '../src/i18n/index.js';
import { SCENES } from '../src/scenes/index.js';

afterEach(() => setActiveLocale('pol'));

describe('application locale', () => {
  it('accepts the public and short language codes with Polish as the default', () => {
    expect(localeParam(new URLSearchParams())).toBe('pol');
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
