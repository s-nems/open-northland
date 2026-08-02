import type { MapsIndexPlayerSlot } from '@open-northland/content-resolver/wire';
import { describe, expect, it } from 'vitest';
import { filterItems, mapItem, pluralForm, sceneItem } from '../src/entries/main-menu/map-select-model.js';

function slot(player: number, hidden = false): MapsIndexPlayerSlot {
  return { player, type: 'ai', tribeId: 1, colorId: player, claimable: false, hidden, aiAllowed: true };
}

describe('mapItem', () => {
  it('categorizes by the script sidecar multiplayer table and counts listed slots', () => {
    const story = mapItem({ id: 'cn_1', name: 'Prolog', minimap: false, players: [slot(0), slot(1, true)] });
    expect(story.category).toBe('story');
    expect(story.playerCount).toBe(1); // the hidden slot is never listed
    const arena = mapItem({ id: 'arena', minimap: true, multiplayer: true });
    expect(arena.category).toBe('multiplayer');
    expect(arena.playerCount).toBe(0);
    expect(arena.minimap).toBe(true);
  });

  it('falls back to the id stem when the map ships no display name', () => {
    expect(mapItem({ id: 'bare_map', minimap: false }).title).toBe('bare_map');
  });
});

describe('filterItems', () => {
  const story = mapItem({ id: 'cn_1', name: 'Prolog', minimap: false });
  const arena = mapItem({ id: 'zatoka_arena', name: 'Zatoka Mgieł', minimap: true, multiplayer: true });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const items = [story, arena, scene];

  it('lists every decoded map under "all" and keeps test scenes to their own filter', () => {
    expect(filterItems(items, 'all', '')).toEqual([story, arena]);
    expect(filterItems(items, 'scenes', '')).toEqual([scene]);
  });

  it('splits story from multiplayer by category', () => {
    expect(filterItems(items, 'story', '')).toEqual([story]);
    expect(filterItems(items, 'multiplayer', '')).toEqual([arena]);
  });

  it('searches the title case-insensitively and the id stem', () => {
    expect(filterItems(items, 'all', 'MGIEŁ')).toEqual([arena]);
    expect(filterItems(items, 'all', 'cn_')).toEqual([story]);
    expect(filterItems(items, 'all', 'nic takiego')).toEqual([]);
  });
});

describe('pluralForm', () => {
  const forms = { one: '{count} mapa', few: '{count} mapy', many: '{count} map' };

  it('follows Polish CLDR categories, including the tens (22 is few)', () => {
    expect(pluralForm(1, forms, 'pl')).toBe('{count} mapa');
    expect(pluralForm(3, forms, 'pl')).toBe('{count} mapy');
    expect(pluralForm(5, forms, 'pl')).toBe('{count} map');
    expect(pluralForm(22, forms, 'pl')).toBe('{count} mapy');
  });

  it('maps English "other" onto the many form', () => {
    expect(pluralForm(1, forms, 'en')).toBe('{count} mapa');
    expect(pluralForm(4, forms, 'en')).toBe('{count} map');
  });
});
