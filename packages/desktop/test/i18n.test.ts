import { PIPELINE_STAGES } from '@open-northland/asset-pipeline/progress';
import { describe, expect, it } from 'vitest';
import {
  formatMessage,
  isLocale,
  LOCALE_CODES,
  LOCALES,
  localeTag,
  messages,
  resolveLocale,
} from '../src/i18n/index.js';

describe('installer i18n', () => {
  it('takes the first preferred system language with a shipped catalog', () => {
    expect(resolveLocale(['pl'])).toBe('pol');
    expect(resolveLocale(['pl-PL'])).toBe('pol');
    expect(resolveLocale(['PL'])).toBe('pol');
    expect(resolveLocale(['en-US'])).toBe('eng');
    expect(resolveLocale(['cs-CZ', 'pl-PL'])).toBe('pol');
  });

  it('falls back to English when no preference has a catalog', () => {
    expect(resolveLocale(['de-DE'])).toBe('eng');
    expect(resolveLocale([])).toBe('eng');
  });

  it('accepts only the shipped locale codes', () => {
    for (const code of LOCALE_CODES) expect(isLocale(code)).toBe(true);
    for (const bad of ['de', 'en', '', undefined, 3]) expect(isLocale(bad)).toBe(false);
  });

  it('tags locales for number formatting and the document lang attribute', () => {
    expect(localeTag('pol')).toBe('pl');
    expect(localeTag('eng')).toBe('en');
  });

  it('interpolates named placeholders and leaves unknown ones verbatim', () => {
    expect(formatMessage('{done} plików', { done: 12 })).toBe('12 plików');
    expect(formatMessage('{a} - {b}', { a: 'x', b: 'y' })).toBe('x - y');
    expect(formatMessage('keep {missing}', {})).toBe('keep {missing}');
  });

  it('lists Polish before English, the order the header builds its flag buttons in', () => {
    expect(LOCALE_CODES).toEqual(['pol', 'eng']);
  });

  it('labels each flag button with its own language, named in the reading locale', () => {
    expect(messages('eng').setup.language[LOCALES.pol.labelKey]).toBe('Polish');
    expect(messages('pol').setup.language[LOCALES.pol.labelKey]).toBe('Polski');
    expect(messages('eng').setup.language[LOCALES.eng.labelKey]).toBe('English');
    expect(messages('pol').setup.language[LOCALES.eng.labelKey]).toBe('Angielski');
  });

  it('has a non-empty stage label in every locale for every pipeline stage', () => {
    for (const code of LOCALE_CODES) {
      const stages = messages(code).setup.stages;
      for (const stage of PIPELINE_STAGES) {
        expect(stages[stage].length).toBeGreaterThan(0);
      }
    }
  });
});
