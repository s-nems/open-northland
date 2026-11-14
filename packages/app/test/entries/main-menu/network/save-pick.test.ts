// @vitest-environment jsdom
import { MAP_TYPE, type MapsIndexEntry } from '@open-northland/data';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MapSource } from '../../../../src/content/map-source/index.js';
import { keptRoomSave, roomSavePick } from '../../../../src/entries/main-menu/network/save-pick.js';
import type { SaveSlotInfo } from '../../../../src/view/runtime/save-load/store.js';
import * as storeBrowser from '../../../../src/view/runtime/save-load/store-browser.js';
import * as worldNames from '../../../../src/view/runtime/save-load/world-names.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';

function source(id: string, mapType: number): MapSource {
  const entry: MapsIndexEntry = {
    id,
    fingerprint: TINY_FINGERPRINT,
    picture: false,
    minimap: false,
    mapTypes: [mapType],
    players: [
      {
        player: 0,
        type: 'human',
        tribeId: 1,
        colorId: 0,
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: false,
        hasComputerControl: true,
      },
    ],
  };
  return { entry, stale: false, fetch: () => Promise.reject(new Error('No map files in this test')) };
}

vi.mock('../../../../src/content/map-source/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playableMapSources: async () => [
    source('arena', MAP_TYPE.MULTI_PLAYER_FREE),
    source('valley', MAP_TYPE.SINGLE_PLAYER_FREE),
  ],
}));

// jsdom lays nothing out, so it has no scrolling to do.
const scrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function slot(name: string, savedAt: number, mapId = 'arena'): SaveSlotInfo {
  return { id: name, name, mapId, tick: 0, entry: null, savedAt, seed: savedAt, thumbnail: null };
}

function storeOf(initial: readonly SaveSlotInfo[]): void {
  let stored = [...initial];
  vi.spyOn(storeBrowser, 'browserSaveStore').mockReturnValue({
    list: async () => stored,
    read: async () => null,
    write: async () => undefined,
    remove: async (id) => {
      stored = stored.filter((listed) => listed.id !== id);
    },
  });
  vi.spyOn(worldNames, 'worldNameIndex').mockResolvedValue(() => null);
}

it('offers a room only the saves on maps it can be made on, matching map ids without case', async () => {
  storeOf([slot('with friends', 3), slot('campaign', 2, 'valley'), slot('alone', 1, 'Arena')]);
  const onSaves = vi.fn((_slots: readonly SaveSlotInfo[]) => undefined);
  const pick = roomSavePick({ onChoose: () => undefined, onBack: () => undefined, onSaves });
  document.body.append(pick.element);
  await vi.waitFor(() => expect(onSaves).toHaveBeenCalled());
  expect(onSaves.mock.calls[0]?.[0].map((listed) => listed.name)).toEqual(['with friends', 'alone']);
  const names = [...pick.element.querySelectorAll('.on-saves__name')].map((name) => name.textContent);
  expect(names).toEqual(['with friends', 'alone']);
  pick.dispose();
});

it('keeps the focus inside the list after its last save is deleted', async () => {
  storeOf([slot('only', 1)]);
  const onSaves = vi.fn((_slots: readonly SaveSlotInfo[]) => undefined);
  const pick = roomSavePick({ onChoose: () => undefined, onBack: () => undefined, onSaves });
  const menu = document.createElement('main');
  menu.className = 'main-menu';
  menu.append(pick.element);
  document.body.append(menu);
  pick.element.hidden = false;
  await vi.waitFor(() => expect(onSaves).toHaveBeenCalledOnce());
  const bin = pick.element.querySelector<HTMLButtonElement>('.on-saves__del');
  bin?.focus();
  bin?.click();
  await vi.waitFor(() => expect(document.querySelector('.main-menu__dialog')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('.main-menu__dialog .is-accent')?.click();
  await vi.waitFor(() => expect(onSaves).toHaveBeenLastCalledWith([]));
  expect(pick.element.contains(document.activeElement)).toBe(true);
  pick.dispose();
});

it('keeps a picked file, keeps a picked save the list still holds, else takes the newest', () => {
  const newest = slot('newest', 3);
  const older = slot('older', 2);
  const file = { kind: 'file', name: 'raid.json.gz', bytes: new Uint8Array() } as const;
  expect(keptRoomSave(file, [newest])).toBe(file);
  expect(keptRoomSave({ kind: 'slot', slot: older }, [newest, older])).toEqual({ kind: 'slot', slot: older });
  expect(keptRoomSave({ kind: 'slot', slot: slot('deleted', 1) }, [newest, older])).toEqual({
    kind: 'slot',
    slot: newest,
  });
  expect(keptRoomSave(null, [])).toBeNull();
});
