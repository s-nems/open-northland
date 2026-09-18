import type { MapsIndexPlayerSlot } from '@open-northland/data';
import { MAP_TYPE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  filterItems,
  listedIn,
  mapCategory,
  mapItem,
  pluralForm,
  ROOM_TABS,
  SINGLE_PLAYER_TABS,
  sceneItem,
} from '../src/entries/main-menu/map-select-model.js';

function slot(player: number, hidden = false): MapsIndexPlayerSlot {
  return { player, type: 'ai', tribeId: 1, colorId: player, claimable: false, hidden, aiAllowed: true };
}

describe('map filter tabs', () => {
  it('keeps every live filter clickable and parks the coming-soon modes next to "all"', () => {
    const filters = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'filter' ? [tab.filter] : []));
    expect(filters).toEqual(['all', 'free', 'multiplayer', 'scenes']);
    const comingSoon = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'comingSoon' ? [tab.id] : []));
    expect(comingSoon).toEqual(['campaign', 'tutorial']);
    expect(SINGLE_PLAYER_TABS[0]).toEqual({ kind: 'filter', filter: 'all' });
    expect(ROOM_TABS).toEqual([]);
  });
});

describe('mapItem', () => {
  it('carries the maptype header and lists visible seats', () => {
    const free = mapItem({
      id: 'dolina',
      name: 'Dolina',
      minimap: false,
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
      players: [slot(0), slot(1, true)],
    });
    expect(mapCategory(free)).toBe('free');
    expect(free.seats).toEqual([{ tribeId: 1, colorId: 0 }]); // the hidden slot is never listed
    expect(free.players).toHaveLength(2); // …but the lobby still negotiates the full roster
    const arena = mapItem({
      id: 'arena',
      minimap: true,
      mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
      fixedColors: true,
    });
    expect(mapCategory(arena)).toBe('multiplayer');
    expect(arena.seats).toEqual([]);
    expect(arena.minimap).toBe(true);
    expect(arena.fixedColors).toBe(true);
    const bare = mapItem({ id: 'arena', minimap: false });
    expect(bare.fixedColors).toBe(false);
    expect(bare.types).toEqual([]);
    expect(mapCategory(bare)).toBe('free');
  });

  it('falls back to the id stem when the map ships no display name', () => {
    expect(mapItem({ id: 'bare_map', minimap: false }).title).toBe('bare_map');
  });
});

describe('listedIn', () => {
  const typed = (...types: number[]) => mapItem({ id: types.join('_'), minimap: false, mapTypes: types });
  const campaign = typed(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN);
  const free = typed(MAP_TYPE.SINGLE_PLAYER_FREE);
  const userFree = typed(MAP_TYPE.USER_SINGLE_PLAYER_FREE);
  const multi = typed(MAP_TYPE.MULTI_PLAYER_FREE);
  const userMulti = typed(MAP_TYPE.USER_MULTI_PLAYER_FREE);
  const demo = typed(MAP_TYPE.SINGLE_PLAYER_DEMO);
  const untyped = mapItem({ id: 'untyped', minimap: false });
  const multiOnly = mapItem({
    id: 'only',
    minimap: false,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
    multiplayerOnly: true,
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');

  it('takes the multiplayer types and an untyped map into a room, like the original list', () => {
    const room = [campaign, free, userFree, multi, userMulti, demo, untyped, multiOnly, scene].filter(
      (item) => listedIn(item, 'multiplayer'),
    );
    expect(room).toEqual([multi, userMulti, untyped, multiOnly]);
  });

  it('takes the free types and unrestricted multiplayer maps into New Game, never a campaign map', () => {
    const single = [campaign, free, userFree, multi, userMulti, demo, untyped, multiOnly, scene].filter(
      (item) => listedIn(item, 'single'),
    );
    expect(single).toEqual([free, userFree, multi, untyped, scene]);
  });
});

describe('filterItems', () => {
  const subMission = mapItem({
    id: 'gringo_sub',
    name: 'Gringo - bitwa',
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
    campaign: { campaignId: 0, missionId: 66641 },
  });
  const free = mapItem({
    id: 'dolina',
    name: 'Dolina',
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
  });
  const arena = mapItem({
    id: 'zatoka_arena',
    name: 'Zatoka Mgieł',
    minimap: true,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const items = [subMission, free, arena, scene];

  it('lists every root map under "all" and keeps test scenes to their own filter', () => {
    expect(filterItems(items, 'single', 'all', '')).toEqual([free, arena]);
    expect(filterItems(items, 'single', 'scenes', '')).toEqual([scene]);
    expect(filterItems(items, 'multiplayer', 'all', '')).toEqual([arena]);
  });

  it('splits the tabs by maptype and keeps a multiplayer-only map off the New Game multiplayer tab', () => {
    expect(filterItems(items, 'single', 'free', '')).toEqual([free]);
    expect(filterItems(items, 'single', 'multiplayer', '')).toEqual([arena]);
    const both = mapItem({
      id: 'both',
      minimap: false,
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE, MAP_TYPE.MULTI_PLAYER_FREE],
      multiplayerOnly: true,
    });
    expect(filterItems([both], 'single', 'all', '')).toEqual([both]);
    expect(filterItems([both], 'single', 'multiplayer', '')).toEqual([]);
  });

  it('searches the title case-insensitively and the id stem', () => {
    expect(filterItems(items, 'single', 'all', 'MGIEŁ')).toEqual([arena]);
    expect(filterItems(items, 'single', 'all', 'zatoka')).toEqual([arena]);
    expect(filterItems(items, 'single', 'all', 'gringo')).toEqual([]); // search never surfaces a sub-mission
    expect(filterItems(items, 'single', 'all', 'nic takiego')).toEqual([]);
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
