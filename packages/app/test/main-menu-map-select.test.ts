import type { MapsIndexPlayerSlot } from '@open-northland/data';
import { MAP_TYPE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  defaultMapPreview,
  filterItems,
  listedIn,
  type MapSelectItem,
  mapCategory,
  mapItem,
  mapPreviewUrl,
  mapPreviewViews,
  ROOM_TABS,
  SINGLE_PLAYER_TABS,
  sceneItem,
} from '../src/entries/main-menu/map-select-model.js';
import { pluralForm } from '../src/i18n/index.js';
import { parseStoredSettings } from '../src/view/settings-store.js';

function slot(player: number, hidden = false): MapsIndexPlayerSlot {
  return {
    player,
    type: 'ai',
    tribeId: 1,
    colorId: player,
    claimable: false,
    hidden,
    aiAllowed: true,
    noneAllowed: true,
    strategicAi: true,
  };
}

describe('map filter tabs', () => {
  it('keeps every live filter clickable and parks the coming-soon modes next to "all"', () => {
    const filters = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'filter' ? [tab.filter] : []));
    expect(filters).toEqual(['all', 'tutorial', 'free', 'multiplayer', 'scenes']);
    const comingSoon = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'comingSoon' ? [tab.id] : []));
    expect(comingSoon).toEqual(['campaign']);
    expect(SINGLE_PLAYER_TABS[0]).toEqual({ kind: 'filter', filter: 'all' });
    expect(ROOM_TABS).toEqual([]);
  });
});

describe('mapItem', () => {
  it('carries the maptype header and lists visible seats', () => {
    const free = mapItem({
      id: 'dolina',
      name: { pol: 'Dolina' },
      picture: false,
      minimap: false,
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
      players: [slot(0), slot(1, true)],
    });
    expect(mapCategory(free)).toBe('free');
    expect(free.seats).toEqual([{ tribeId: 1, colorId: 0 }]); // the hidden slot is never listed
    expect(free.players).toHaveLength(2); // …but the lobby still negotiates the full roster
    const arena = mapItem({
      id: 'arena',
      picture: true,
      minimap: true,
      mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
      fixedColors: true,
    });
    expect(mapCategory(arena)).toBe('multiplayer');
    expect(arena.seats).toEqual([]);
    expect(arena.picture).toBe(true);
    expect(arena.minimap).toBe(true);
    expect(arena.fixedColors).toBe(true);
    const bare = mapItem({ id: 'arena', picture: false, minimap: false });
    expect(bare.fixedColors).toBe(false);
    expect(bare.types).toEqual([]);
    expect(mapCategory(bare)).toBe('free');
  });

  it('falls back to the id stem when the map ships no display name', () => {
    expect(mapItem({ id: 'bare_map', picture: false, minimap: false }).title).toBe('bare_map');
  });

  it('reads the title and description in the given language, else in a shipped one', () => {
    const entry = {
      id: 'arabskie_wyspy',
      name: { pol: 'ARABSKIE WYSPY', eng: 'ARABIAN ISLANDS' },
      description: { pol: 'Opis' },
      picture: false,
      minimap: false,
    };
    expect(mapItem(entry, 'eng')).toMatchObject({ title: 'ARABIAN ISLANDS', description: 'Opis' });
    expect(mapItem(entry, 'pol')).toMatchObject({ title: 'ARABSKIE WYSPY', description: 'Opis' });
  });

  it('recognizes and orders tutorial lessons from campaign metadata instead of the map id', () => {
    const lesson = mapItem({
      id: 'renamed_lesson',
      name: { pol: 'Sterowanie' },
      picture: false,
      minimap: false,
      campaign: { campaignId: 100, missionId: 2 },
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
    });
    expect(lesson.tutorialStep).toBe(2);
    expect(mapCategory(lesson)).toBe('tutorial');
  });
});

describe('listedIn', () => {
  const typed = (...types: number[]) =>
    mapItem({ id: types.join('_'), picture: false, minimap: false, mapTypes: types });
  const campaign = typed(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN);
  const free = typed(MAP_TYPE.SINGLE_PLAYER_FREE);
  const userFree = typed(MAP_TYPE.USER_SINGLE_PLAYER_FREE);
  const multi = typed(MAP_TYPE.MULTI_PLAYER_FREE);
  const userMulti = typed(MAP_TYPE.USER_MULTI_PLAYER_FREE);
  const demo = typed(MAP_TYPE.SINGLE_PLAYER_DEMO);
  const untyped = mapItem({ id: 'untyped', picture: false, minimap: false });
  const multiOnly = mapItem({
    id: 'only',
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
    multiplayerOnly: true,
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const tutorial = mapItem({
    id: 'lesson',
    picture: false,
    minimap: false,
    campaign: { campaignId: 100, missionId: 1 },
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
  });

  it('takes the multiplayer types and an untyped map into a room, like the original list', () => {
    const room = [
      campaign,
      tutorial,
      free,
      userFree,
      multi,
      userMulti,
      demo,
      untyped,
      multiOnly,
      scene,
    ].filter((item) => listedIn(item, 'multiplayer'));
    expect(room).toEqual([multi, userMulti, untyped, multiOnly]);
  });

  it('takes the free types and unrestricted multiplayer maps into New Game, never a campaign map', () => {
    const single = [
      campaign,
      tutorial,
      free,
      userFree,
      multi,
      userMulti,
      demo,
      untyped,
      multiOnly,
      scene,
    ].filter((item) => listedIn(item, 'single'));
    expect(single).toEqual([tutorial, free, userFree, multi, untyped, scene]);
  });
});

describe('map preview views', () => {
  const both = { picture: true, minimap: true } as const;
  const multi = mapItem({ id: 'four_hills', ...both, mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE] });
  const userMulti = mapItem({ id: 'own_arena', ...both, mapTypes: [MAP_TYPE.USER_MULTI_PLAYER_FREE] });
  const free = mapItem({ id: 'kraina', ...both, mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE] });
  const tutorial = mapItem({ id: 'lesson', ...both, campaign: { campaignId: 100, missionId: 1 } });
  const terrainOnly = mapItem({ id: 'cn_1', picture: false, minimap: true });
  const bare = mapItem({ id: 'bare', picture: false, minimap: false });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');

  it('offers the terrain beside the picture only on a multiplayer map', () => {
    expect(mapPreviewViews(multi)).toEqual(['picture', 'map']);
    expect(mapPreviewViews(userMulti)).toEqual(['picture', 'map']);
  });

  it('keeps a single-player picture as the only view', () => {
    expect(mapPreviewViews(free)).toEqual(['picture']);
    expect(mapPreviewViews(tutorial)).toEqual(['picture']);
    expect(mapPreviewViews(mapItem({ id: 'untyped', ...both }))).toEqual(['picture']);
  });

  it('shows the terrain where there is no picture, and nothing for a scene or a bare map', () => {
    expect(mapPreviewViews(terrainOnly)).toEqual(['map']);
    expect(mapPreviewViews(bare)).toEqual([]);
    expect(mapPreviewViews(scene)).toEqual([]);
  });

  it('opens on the picture whenever there is one', () => {
    expect(defaultMapPreview(multi)).toBe('picture');
    expect(defaultMapPreview(free)).toBe('picture');
    expect(defaultMapPreview(terrainOnly)).toBe('map');
    expect(defaultMapPreview(scene)).toBeNull();
  });

  it('names the illustration and the minimap files apart', () => {
    expect(mapPreviewUrl('szeol', 'picture')).toBe('/maps/szeol.png');
    expect(mapPreviewUrl('szeol', 'map')).toBe('/maps/szeol.map.png');
    expect(mapPreviewUrl('a b', 'map')).toBe('/maps/a%20b.map.png');
  });

  it('stores no preview choice', () => {
    expect(parseStoredSettings('{"mapPreview":"map"}')).not.toHaveProperty('mapPreview');
  });
});

describe('filterItems', () => {
  const subMission = mapItem({
    id: 'gringo_sub',
    name: { pol: 'Gringo - bitwa' },
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
    campaign: { campaignId: 0, missionId: 66641 },
  });
  const free = mapItem({
    id: 'dolina',
    name: { pol: 'Dolina' },
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
  });
  const arena = mapItem({
    id: 'zatoka_arena',
    name: { pol: 'Zatoka Mgieł' },
    picture: true,
    minimap: true,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const secondLesson = mapItem({
    id: 'renamed_second',
    name: { pol: 'Każdy Wiking jest unikalny' },
    picture: false,
    minimap: false,
    campaign: { campaignId: 100, missionId: 2 },
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
  });
  const firstLesson = mapItem({
    id: 'renamed_first',
    name: { pol: 'Sterowanie' },
    picture: false,
    minimap: false,
    campaign: { campaignId: 100, missionId: 1 },
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
  });
  const items = [subMission, secondLesson, free, arena, firstLesson, scene];

  it('lists every root map under "all" by title and keeps test scenes to their own filter', () => {
    expect(filterItems(items, 'single', 'all', '')).toEqual([free, secondLesson, firstLesson, arena]);
    expect(filterItems(items, 'single', 'scenes', '')).toEqual([scene]);
    expect(filterItems(items, 'multiplayer', 'all', '')).toEqual([arena]);
  });

  it('keeps tutorial lessons in authored mission order and out of multiplayer rooms', () => {
    expect(filterItems(items, 'single', 'tutorial', '')).toEqual([firstLesson, secondLesson]);
    expect(filterItems(items, 'multiplayer', 'tutorial', '')).toEqual([]);
  });

  it('splits the tabs by maptype and keeps a multiplayer-only map off the New Game multiplayer tab', () => {
    expect(filterItems(items, 'single', 'free', '')).toEqual([free]);
    expect(filterItems(items, 'single', 'multiplayer', '')).toEqual([arena]);
    const both = mapItem({
      id: 'both',
      picture: false,
      minimap: false,
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE, MAP_TYPE.MULTI_PLAYER_FREE],
      multiplayerOnly: true,
    });
    expect(filterItems([both], 'single', 'all', '')).toEqual([both]);
    expect(filterItems([both], 'single', 'multiplayer', '')).toEqual([]);
  });

  it('orders maps by title as the language reads them, a number by its value', () => {
    const titled = (id: string, name: string): MapSelectItem =>
      mapItem({
        id,
        name: { pol: name },
        picture: false,
        minimap: false,
        mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
      });
    const tenth = titled('a', 'Wyspa 10');
    const second = titled('b', 'Wyspa 2');
    const accented = titled('c', 'Łąka');
    const plain = titled('d', 'Las');
    expect(filterItems([tenth, accented, second, plain], 'single', 'free', '')).toEqual([
      plain,
      accented,
      second,
      tenth,
    ]);
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
