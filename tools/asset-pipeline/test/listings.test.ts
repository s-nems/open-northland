import { BobsIndex, MapScript, MapsIndex } from '@open-northland/data';
import { readText } from '@open-northland/vfs';
import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import {
  BOBS_INDEX_FILE,
  bobsIndexEntries,
  MAPS_INDEX_FILE,
  mapsIndexEntries,
  writeListings,
} from '../src/stages/listings.js';
import type { MapDatConversion } from '../src/stages/maps/index.js';

const OUT = 'out';

function converted(id: string, extra: Partial<MapDatConversion> = {}): MapDatConversion {
  return {
    id,
    width: 2,
    height: 2,
    output: `maps/${id}.json`,
    minimap: false,
    minimapSynthesized: false,
    meta: { provenance: { kind: 'mod', folder: `CnModMaps/${id}` } },
    briefing: false,
    strings: false,
    ...extra,
  };
}

const script = MapScript.parse({
  players: [
    { player: 0, type: 'human', tribeId: 1, colorId: 0, name: 'Ragnar' },
    { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
  ],
  multiplayer: { slotOptions: [{ player: 1, allowed: ['human', 'ai'] }], hiddenSlots: [], fixedColors: true },
});

describe('mapsIndexEntries', () => {
  it('joins each map with its sidecars and reads the lobby seats off the script', () => {
    const entries = mapsIndexEntries([
      converted('arena', {
        minimap: true,
        meta: {
          provenance: { kind: 'mod', folder: 'CnModMaps/arena' },
          name: 'Arena',
          description: 'Two against two.',
          musicType: 3,
          mapTypes: [4],
          multiplayerOnly: true,
        },
        script,
      }),
    ]);
    expect(entries).toEqual([
      {
        id: 'arena',
        provenance: { kind: 'mod', folder: 'CnModMaps/arena' },
        name: 'Arena',
        description: 'Two against two.',
        minimap: true,
        players: [
          {
            player: 0,
            type: 'human',
            tribeId: 1,
            colorId: 0,
            name: 'Ragnar',
            claimable: true,
            hidden: false,
            aiAllowed: true,
          },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9, claimable: true, hidden: false, aiAllowed: true },
        ],
        fixedColors: true,
        mapTypes: [4],
        multiplayerOnly: true,
      },
    ]);
    expect(MapsIndex.parse(entries)).toEqual(entries);
  });

  it('lists a bare map by id alone and leaves out an empty roster', () => {
    const bare = mapsIndexEntries([converted('bare', { meta: {}, script: MapScript.parse({}) })]);
    expect(bare).toEqual([{ id: 'bare', minimap: false }]);
  });

  it('sorts by id and lets the last conversion of a repeated id win, like its files did', () => {
    const entries = mapsIndexEntries([
      converted('zeta'),
      converted('alpha', { meta: { name: 'First' } }),
      converted('alpha', { meta: { name: 'Second' } }),
    ]);
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['alpha', 'Second'],
      ['zeta', undefined],
    ]);
  });
});

describe('bobsIndexEntries', () => {
  async function outputWith(files: readonly string[]) {
    const fs = memoryVfs();
    for (const file of files) await fs.writeFile(`${OUT}/bobs/${file}`, Uint8Array.of(1));
    return fs;
  }

  it('lists viewable RGBA atlases split into base + variant, sorted', async () => {
    const fs = await outputWith([
      'ls_trees.tree_cypress01.atlas.json',
      'ls_trees.tree_cypress01.png',
      'ls_gui_window.iconsleft.atlas.json',
      'ls_gui_window.iconsleft.png',
    ]);
    expect(await bobsIndexEntries(fs, OUT)).toEqual([
      { stem: 'ls_gui_window.iconsleft', base: 'ls_gui_window', variant: 'iconsleft' },
      { stem: 'ls_trees.tree_cypress01', base: 'ls_trees', variant: 'tree_cypress01' },
    ]);
  });

  it('skips .indexed sheets (index-in-red, not viewable) and atlases with no matching png', async () => {
    const fs = await outputWith([
      'ls_gui_window.indexed.atlas.json',
      'ls_gui_window.indexed.png',
      'ls_goods.goods01.atlas.json',
    ]);
    expect(await bobsIndexEntries(fs, OUT)).toEqual([]);
  });
});

describe('writeListings', () => {
  it('writes both listings at the content root in the shapes the app parses', async () => {
    const fs = memoryVfs();
    await fs.writeFile(`${OUT}/bobs/body.bear01.atlas.json`, Uint8Array.of(1));
    await fs.writeFile(`${OUT}/bobs/body.bear01.png`, Uint8Array.of(1));
    await writeListings(fs, OUT, [converted('arena', { script })]);
    const maps = MapsIndex.parse(JSON.parse(await readText(fs, `${OUT}/${MAPS_INDEX_FILE}`)));
    const bobs = BobsIndex.parse(JSON.parse(await readText(fs, `${OUT}/${BOBS_INDEX_FILE}`)));
    expect(maps.map((entry) => entry.id)).toEqual(['arena']);
    expect(bobs).toEqual([{ stem: 'body.bear01', base: 'body', variant: 'bear01' }]);
  });
});
