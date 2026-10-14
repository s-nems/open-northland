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
import { TINY_FINGERPRINT } from './support/catalog-maps.js';

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
    hasComputerControl: true,
  };
}

describe('map filter tabs', () => {
  it('keeps every live filter clickable and places campaign navigation next to "all"', () => {
    const filters = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'filter' ? [tab.filter] : []));
    expect(filters).toEqual(['all', 'tutorial', 'free', 'multiplayer', 'scenes']);
    const action = SINGLE_PLAYER_TABS.flatMap((tab) => (tab.kind === 'action' ? [tab.id] : []));
    expect(action).toEqual(['campaign']);
    expect(SINGLE_PLAYER_TABS[0]).toEqual({ kind: 'filter', filter: 'all' });
    expect(ROOM_TABS).toEqual([]);
  });
});

describe('mapItem', () => {
  it('carries the maptype header and lists visible seats', () => {
    const free = mapItem({
      id: 'dolina',
      name: { pol: 'Dolina' },
      fingerprint: TINY_FINGERPRINT,
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
      fingerprint: TINY_FINGERPRINT,
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
    const bare = mapItem({ id: 'arena', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false });
    expect(bare.fixedColors).toBe(false);
    expect(bare.types).toEqual([]);
    expect(mapCategory(bare)).toBe('free');
  });

  it('falls back to the id stem when the map ships no display name', () => {
    expect(
      mapItem({ id: 'bare_map', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false }).title,
    ).toBe('bare_map');
  });

  it('reads the title and description in the given language, else in a shipped one', () => {
    const entry = {
      id: 'arabskie_wyspy',
      name: { pol: 'ARABSKIE WYSPY', eng: 'ARABIAN ISLANDS' },
      description: { pol: 'Opis' },
      fingerprint: TINY_FINGERPRINT,
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
      fingerprint: TINY_FINGERPRINT,
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
    mapItem({
      id: types.join('_'),
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      mapTypes: types,
    });
  const campaign = typed(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN);
  const free = typed(MAP_TYPE.SINGLE_PLAYER_FREE);
  const userFree = typed(MAP_TYPE.USER_SINGLE_PLAYER_FREE);
  const multi = typed(MAP_TYPE.MULTI_PLAYER_FREE);
  const userMulti = typed(MAP_TYPE.USER_MULTI_PLAYER_FREE);
  const demo = typed(MAP_TYPE.SINGLE_PLAYER_DEMO);
  const untyped = mapItem({ id: 'untyped', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false });
  const multiOnly = mapItem({
    id: 'only',
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
    multiplayerOnly: true,
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const tutorial = mapItem({
    id: 'lesson',
    fingerprint: TINY_FINGERPRINT,
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
    expect(single).toEqual([tutorial, free, userFree, multi, userMulti, untyped, scene]);
  });
});

describe('map preview views', () => {
  const both = { fingerprint: TINY_FINGERPRINT, picture: true, minimap: true } as const;
  const multi = mapItem({ id: 'four_hills', ...both, mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE] });
  const userMulti = mapItem({ id: 'own_arena', ...both, mapTypes: [MAP_TYPE.USER_MULTI_PLAYER_FREE] });
  const free = mapItem({ id: 'kraina', ...both, mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE] });
  const tutorial = mapItem({ id: 'lesson', ...both, campaign: { campaignId: 100, missionId: 1 } });
  const terrainOnly = mapItem({ id: 'cn_1', fingerprint: TINY_FINGERPRINT, picture: false, minimap: true });
  const bare = mapItem({ id: 'bare', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false });
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
    expect(mapPreviewUrl({ id: 'szeol' }, 'picture')).toBe('/maps/szeol.png');
    expect(mapPreviewUrl({ id: 'szeol' }, 'map')).toBe('/maps/szeol.map.png');
    expect(mapPreviewUrl({ id: 'a b' }, 'map')).toBe('/maps/a%20b.map.png');
  });

  it("shows a catalogue map's picture from wherever it lives", () => {
    expect(mapPreviewUrl({ id: 'cn-a', pictureUrl: 'blob:x' }, 'picture')).toBe('blob:x');
    expect(mapPreviewUrl({ id: 'cn-a', pictureUrl: 'blob:x' }, 'map')).toBe('/maps/cn-a.map.png');
  });

  it('stores no preview choice', () => {
    expect(parseStoredSettings('{"mapPreview":"map"}')).not.toHaveProperty('mapPreview');
  });
});

describe('filterItems', () => {
  const subMission = mapItem({
    id: 'gringo_sub',
    name: { pol: 'Gringo - bitwa' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
    campaign: { campaignId: 0, missionId: 66641 },
  });
  const free = mapItem({
    id: 'dolina',
    name: { pol: 'Dolina' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE],
  });
  const arena = mapItem({
    id: 'zatoka_arena',
    name: { pol: 'Zatoka Mgieł' },
    fingerprint: TINY_FINGERPRINT,
    picture: true,
    minimap: true,
    mapTypes: [MAP_TYPE.MULTI_PLAYER_FREE],
  });
  const scene = sceneItem('battle', 'Bitwa', 'pokaz walki wręcz');
  const secondLesson = mapItem({
    id: 'renamed_second',
    name: { pol: 'Każdy Wiking jest unikalny' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    campaign: { campaignId: 100, missionId: 2 },
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
  });
  const firstLesson = mapItem({
    id: 'renamed_first',
    name: { pol: 'Sterowanie' },
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    campaign: { campaignId: 100, missionId: 1 },
    mapTypes: [MAP_TYPE.SINGLE_PLAYER_CAMPAIGN],
  });
  const items = [subMission, secondLesson, free, arena, firstLesson, scene];

  it('lists every root map but the tutorial lessons under "all" by title, scenes under their own filter', () => {
    expect(filterItems(items, 'single', 'all', '')).toEqual([free, arena]);
    expect(filterItems(items, 'single', 'scenes', '')).toEqual([scene]);
    expect(filterItems(items, 'multiplayer', 'all', '')).toEqual([arena]);
  });

  it('finds every typed word in the title or the id, folded', () => {
    expect(filterItems(items, 'single', 'all', 'MGIEL zatoka')).toEqual([arena]);
    expect(filterItems(items, 'single', 'all', 'zatoka arena')).toEqual([arena]);
    expect(filterItems(items, 'single', 'all', 'zatoka dolina')).toEqual([]);
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
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      mapTypes: [MAP_TYPE.SINGLE_PLAYER_FREE, MAP_TYPE.MULTI_PLAYER_FREE],
      multiplayerOnly: true,
    });
    expect(filterItems([both], 'single', 'all', '')).toEqual([both]);
    expect(filterItems([both], 'single', 'multiplayer', '')).toEqual([]);
  });

  it.each([MAP_TYPE.MULTI_PLAYER_FREE, MAP_TYPE.USER_MULTI_PLAYER_FREE])(
    'lists multiplayer type %s in local All and Multiplayer unless restricted to network play',
    (type) => {
      const map = mapItem({
        id: 'downloaded-arena',
        name: { pol: 'Pobrana arena' },
        fingerprint: TINY_FINGERPRINT,
        picture: false,
        minimap: false,
        mapTypes: [type],
      });
      expect(filterItems([map], 'single', 'all', 'arena')).toEqual([map]);
      expect(filterItems([map], 'single', 'multiplayer', '')).toEqual([map]);
      expect(filterItems([map], 'single', 'free', '')).toEqual([]);
      const restricted = { ...map, multiplayerOnly: true };
      expect(filterItems([restricted], 'single', 'all', '')).toEqual([]);
      expect(filterItems([restricted], 'single', 'multiplayer', '')).toEqual([]);
      expect(filterItems([restricted], 'multiplayer', 'all', '')).toEqual([restricted]);
    },
  );

  it('orders maps by title as the language reads them, a number by its value', () => {
    const titled = (id: string, name: string): MapSelectItem =>
      mapItem({
        id,
        name: { pol: name },
        fingerprint: TINY_FINGERPRINT,
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
