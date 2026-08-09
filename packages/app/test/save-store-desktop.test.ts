import { describe, expect, it } from 'vitest';
import { compressSaveText } from '../src/view/runtime/save-load/codec.js';
import { desktopSaveStore, type ListedSaveFile } from '../src/view/runtime/save-load/store-desktop.js';

function saveText(mapId: string, tick: number, entry: string | null): string {
  return JSON.stringify({
    header: { kind: 'open-northland-save', formatVersion: 2, mapId, tick, entry },
    sections: [],
  });
}

describe('desktopSaveStore listing', () => {
  it('joins each file basename with its peeked header, newest first', async () => {
    const files: ListedSaveFile[] = [
      {
        file: 'Zapis 1.json.gz',
        savedAt: 1000,
        prefix: await compressSaveText(saveText('twierdza', 240, '?map=twierdza')),
      },
      {
        file: 'przed atakiem.json.gz',
        savedAt: 3000,
        prefix: await compressSaveText(saveText('dolina', 480, null)),
      },
      // A file someone dropped into the folder by hand still lists, by name and mtime alone.
      { file: 'foreign.json', savedAt: 2000, prefix: new TextEncoder().encode('{"notes":true}') },
    ];
    const store = desktopSaveStore({
      listSaves: () => Promise.resolve(files),
      readSave: () => Promise.resolve(null),
      writeSave: () => Promise.resolve(),
      deleteSave: () => Promise.resolve(),
      showSavesFolder: () => Promise.resolve(),
    });
    await expect(store.list()).resolves.toEqual([
      {
        id: 'przed atakiem.json.gz',
        name: 'przed atakiem',
        mapId: 'dolina',
        tick: 480,
        entry: null,
        savedAt: 3000,
      },
      { id: 'foreign.json', name: 'foreign', mapId: null, tick: null, entry: null, savedAt: 2000 },
      {
        id: 'Zapis 1.json.gz',
        name: 'Zapis 1',
        mapId: 'twierdza',
        tick: 240,
        entry: '?map=twierdza',
        savedAt: 1000,
      },
    ]);
    expect(store.showFolder).not.toBeNull();
  });
});
