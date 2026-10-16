// @vitest-environment jsdom
import { MAP_TEXT_LANGUAGES, type MapsIndexEntry } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMapDetailsCard, narrationLabel, narratorBadge } from '../src/entries/main-menu/map-card.js';
import { mapItem, sceneItem } from '../src/entries/main-menu/map-select-model.js';
import { LOCALE_CODES, messages, setActiveLocale } from '../src/i18n/index.js';
import { TINY_FINGERPRINT } from './support/catalog-maps.js';

function entry(voices?: readonly string[]): MapsIndexEntry {
  return {
    id: 'straznicy',
    name: { pol: 'Strażnicy' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    ...(voices === undefined ? {} : { voices: [...voices] }),
  };
}

beforeEach(() => setActiveLocale('pol'));

describe('narrated briefing mark', () => {
  it('marks only a map that ships briefing voices', () => {
    expect(mapItem(entry()).narration).toEqual([]);
    expect(narratorBadge(mapItem(entry()))).toBeNull();
    expect(narratorBadge(sceneItem('scene', 'Scene', 'summary'))).toBeNull();
    const badge = narratorBadge(mapItem(entry(['.voice-pol-0001.wav', '.voice-pol-0002.wav'])));
    expect(badge?.getAttribute('role')).toBe('img');
    expect(badge?.getAttribute('aria-label')).toBe('Odprawa z narratorem: polski');
    expect(badge?.title).toBe('Odprawa z narratorem: polski');
  });

  it('names every narrated language, also when the interface language is not among them', () => {
    const all = mapItem(
      entry(['.voice-rus-0001.wav', '.voice-ger-0001.wav', '.voice-eng-0001.wav', '.voice-pol-0001.wav']),
    );
    expect(narrationLabel(all)).toBe('Odprawa z narratorem: polski, angielski, niemiecki, rosyjski');
    setActiveLocale('eng');
    expect(narrationLabel(mapItem(entry(['.voice-pol-0001.wav'])))).toBe('Narrated briefing: Polish');
  });

  it('shows the narration line on the details card only for a narrated map', () => {
    const card = createMapDetailsCard();
    const line = (): HTMLElement | null => card.root.querySelector('.main-menu__map-narration');
    card.show(mapItem(entry(['.voice-pol-0001.wav'])));
    expect(line()?.hidden).toBe(false);
    expect(line()?.textContent).toBe('Odprawa z narratorem: polski');
    card.show(mapItem(entry()));
    expect(line()?.hidden).toBe(true);
  });

  it('has the line and a name for every map text language in every catalog', () => {
    for (const locale of LOCALE_CODES) {
      const select = messages(locale).mainMenu.mapSelect;
      expect(select.narrated).toContain('{languages}');
      for (const lang of MAP_TEXT_LANGUAGES) expect(select.narratedLanguageNames[lang]).not.toBe('');
    }
  });
});
