// @vitest-environment jsdom
import {
  LANGUAGES,
  MAP_TEXT_LANGUAGES,
  MAP_TYPE,
  type MapsIndexEntry,
  type MapsIndexPlayerSlot,
} from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TranslateChoice } from '../../../../src/i18n/translate/mission-translate.js';
import {
  createMapDetailsCard,
  metaLine,
  narrationLabel,
  narratorBadge,
} from '../../../../src/entries/main-menu/map-select/card.js';
import { mapItem, sceneItem } from '../../../../src/entries/main-menu/map-select/model.js';
import { LOCALE_CODES, messages, setActiveLocale } from '../../../../src/i18n/index.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';

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

it('uses the translated map description on the details card', () => {
  const item = mapItem({ ...entry(), description: { pol: 'Opis misji' } });
  const card = createMapDetailsCard({
    translateText: ({ text }) => `translated: ${text}`,
  });
  card.show(item);
  expect(card.root.querySelector('.main-menu__map-desc')?.textContent).toBe('translated: Opis misji');
});


it('provides the mission-book language menu beside the map description', () => {
  let selected: TranslateChoice = 'auto';
  const picks: TranslateChoice[] = [];
  const card = createMapDetailsCard({
    translateTarget: () => selected,
    onTranslateTarget: (choice) => {
      selected = choice;
      picks.push(choice);
    },
  });
  card.show(mapItem({ ...entry(), description: { pol: 'Opis misji' } }));

  const button = card.root.querySelector<HTMLButtonElement>('.main-menu__map-translate');
  const menu = card.root.querySelector<HTMLElement>('.main-menu__map-translate-menu');
  if (button === null || menu === null) throw new Error('map translation control: markup');
  expect(button.getAttribute('aria-label')).toBe(messages().hud.missionBook.translate);
  expect(button.hidden).toBe(false);
  expect(menu.hidden).toBe(true);

  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(false);
  const rows = [...menu.querySelectorAll<HTMLButtonElement>('[data-translate-choice]')];
  expect(rows.map((row) => row.dataset.translateChoice)).toEqual([
    'auto',
    ...LANGUAGES,
    'original',
  ]);
  expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
  expect(rows[3]?.textContent).toBe(messages().mainMenu.settings.languageNames.ger);

  const german = menu.querySelector<HTMLButtonElement>('[data-translate-choice="ger"]');
  if (german === null) throw new Error('map translation control: German choice');
  german.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(picks).toEqual(['ger']);
  expect(selected).toBe('ger');
  expect(menu.hidden).toBe(true);
  expect(button.getAttribute('aria-expanded')).toBe('false');

  card.show(mapItem({ ...entry(), description: { pol: 'Opis misji' } }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(menu.querySelector('[data-translate-choice="ger"]')?.getAttribute('aria-checked')).toBe(
    'true',
  );
  card.dispose();
});

describe('meta line', () => {
  function slot(player: number, claimable: boolean, hidden = false): MapsIndexPlayerSlot {
    return {
      player,
      type: claimable ? 'human' : 'ai',
      tribeId: 1,
      colorId: player,
      claimable,
      hidden,
      aiAllowed: true,
      noneAllowed: true,
      hasComputerControl: true,
    };
  }

  it('counts only the listed seats a person may take', () => {
    const map = mapItem({
      ...entry(),
      mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
      players: [slot(0, true), slot(1, true), slot(2, false), slot(3, false), slot(4, true, true)],
      relations: [{ a: 0, b: 1, stance: 'enemy' }],
    });
    expect(metaLine(map)).toBe('multiplayer · 2 graczy · 1 na 1');
  });
});
