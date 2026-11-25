// @vitest-environment jsdom
import type { MapsIndexEntry } from '@open-northland/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMapDetailsCard } from '../../../../src/entries/main-menu/map-select/card.js';
import { mapItem } from '../../../../src/entries/main-menu/map-select/model.js';
import { menuMapTextReader } from '../../../../src/entries/main-menu/map-text.js';
import { messages, setActiveLocale } from '../../../../src/i18n/index.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';

// The language-menu wiring does not need GUI string downloads or a device translation engine.
vi.mock('../../../../src/content/gui/gfx.js', () => ({
  loadGuiStrings: async () => null,
}));
vi.mock('../../../../src/i18n/translate/service.js', () => ({
  sharedMapTextTranslator: () => ({ translate: async (texts: readonly string[]) => texts }),
}));

function entry(): MapsIndexEntry {
  return {
    id: 'mission-map',
    name: { eng: 'Mission map' },
    description: { eng: 'A mission description' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  setActiveLocale('eng');
});

describe('map-selection translation control', () => {
  it('is visible and writes the shared mission-book language choice', () => {
    const mapText = menuMapTextReader(() => undefined);
    const card = createMapDetailsCard({
      translateTarget: mapText.translateChoice,
      onTranslateTarget: mapText.setTranslateChoice,
    });
    card.show(mapItem(entry()));

    const button = card.root.querySelector<HTMLButtonElement>('.main-menu__map-translate');
    const menu = card.root.querySelector<HTMLElement>('.main-menu__map-translate-menu');
    expect(button?.hidden).toBe(false);
    expect(menu?.hidden).toBe(true);

    button?.click();
    const german = menu?.querySelector<HTMLButtonElement>('[data-translate-choice="ger"]');
    expect(german).not.toBeNull();
    german?.click();

    expect(mapText.translateChoice()).toBe('ger');
    expect(messages().mainMenu.settings.languageNames.ger).toBeTruthy();

    card.show(mapItem(entry()));
    button?.click();
    expect(menu?.querySelector('[data-translate-choice="ger"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );

    card.dispose();
    mapText.dispose();
  });
});
