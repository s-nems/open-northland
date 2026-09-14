import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMapsIndexEntries } from '../src/maps-index.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

describe('buildMapsIndexEntries', () => {
  const fs = nodeVfs();
  let tmp: TempDir;
  let mapsRoot: string;

  beforeEach(async () => {
    tmp = await makeTempDir('maps-index');
    mapsRoot = tmp.path;
  });

  afterEach(() => tmp.cleanup());

  it('joins each grid with its meta strings and minimap flag, sorted by id', async () => {
    await writeFile(join(mapsRoot, 'b_map.json'), '{}');
    await writeFile(join(mapsRoot, 'a_map.json'), '{}');
    await writeFile(join(mapsRoot, 'a_map.meta.json'), '{"name":"Mapa A","description":"Opis A"}');
    await writeFile(join(mapsRoot, 'a_map.png'), 'png-bytes');
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      { id: 'a_map', name: 'Mapa A', description: 'Opis A', minimap: true },
      { id: 'b_map', minimap: false },
    ]);
  });

  it('serves validated provenance including explicit unknown and drops malformed or absent metadata', async () => {
    const valid = { kind: 'mod', folder: 'CnModMaps/example', layer: 'game' };
    const cases = [
      valid,
      { ...valid, kind: 'unknown' },
      undefined,
      null,
      { ...valid, kind: 'other' },
      { ...valid, layer: 'other' },
      { ...valid, folder: '../escape' },
      { ...valid, folder: '/absolute' },
      { ...valid, folder: 'C:/install' },
      { ...valid, folder: 'a\\b' },
      { ...valid, folder: 'a//b' },
      { ...valid, extra: true },
    ];
    for (const [index, provenance] of cases.entries()) {
      const id = `map_${String(index).padStart(2, '0')}`;
      await writeFile(join(mapsRoot, `${id}.json`), '{}');
      await writeFile(join(mapsRoot, `${id}.meta.json`), JSON.stringify({ name: 'Map', provenance }));
    }
    const entries = await buildMapsIndexEntries(fs, mapsRoot);
    expect(entries[0]?.provenance).toEqual(valid);
    expect(entries[1]?.provenance).toEqual({ ...valid, kind: 'unknown' });
    expect(entries.slice(2).every((entry) => entry.provenance === undefined && entry.name === 'Map')).toBe(
      true,
    );
  });

  it('never lists a .meta.json sidecar as a map of its own', async () => {
    await writeFile(join(mapsRoot, 'lonely.meta.json'), '{"name":"ghost"}');
    await writeFile(join(mapsRoot, 'lonely.briefing.json'), '{"texts":{}}');
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([]);
  });

  it('degrades a malformed sidecar to the bare id instead of failing the list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(mapsRoot, 'nul.json'), '{}');
    await writeFile(join(mapsRoot, 'nul.meta.json'), 'null'); // parses fine, is not an object
    await writeFile(join(mapsRoot, 'bad.json'), '{}');
    await writeFile(join(mapsRoot, 'bad.meta.json'), '{not json');
    await writeFile(join(mapsRoot, 'typ.json'), '{}');
    await writeFile(join(mapsRoot, 'typ.meta.json'), '{"name":42,"description":["x"]}');
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      { id: 'bad', minimap: false },
      { id: 'nul', minimap: false },
      { id: 'typ', minimap: false },
    ]);
    expect(warn).toHaveBeenCalledTimes(2); // the null + unparsable sidecars; wrong types are dropped silently
    warn.mockRestore();
  });

  it('joins the script sidecar roster and never lists .script.json as a map of its own', async () => {
    await writeFile(join(mapsRoot, 'arena.json'), '{}');
    await writeFile(
      join(mapsRoot, 'arena.script.json'),
      JSON.stringify({
        players: [
          { player: 0, type: 'human', tribeId: 1, colorId: 7, name: 'Ragnar' },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
        ],
        missions: [{ goals: [], results: [], other: [] }],
      }),
    );
    await writeFile(join(mapsRoot, 'lonely.script.json'), '{"players":[]}');
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      {
        id: 'arena',
        minimap: false,
        players: [
          {
            player: 0,
            type: 'human',
            tribeId: 1,
            colorId: 7,
            name: 'Ragnar',
            claimable: true,
            hidden: false,
            aiAllowed: true,
          },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
        ],
      },
    ]);
  });

  it('derives seat eligibility, hidden slots and colour locking from the [multiplayer] table', async () => {
    await writeFile(join(mapsRoot, 'bridges.json'), '{}');
    await writeFile(
      join(mapsRoot, 'bridges.script.json'),
      JSON.stringify({
        players: [
          { player: 0, type: 'human', tribeId: 1, colorId: 0 },
          { player: 1, type: 'ai', tribeId: 1, colorId: 1 },
          { player: 2, type: 'ai', tribeId: 1, colorId: 9 },
          { player: 3, type: 'human', tribeId: 1, colorId: 2 },
        ],
        multiplayer: {
          slotOptions: [
            { player: 1, allowed: ['human', 'ai', 'none'] },
            { player: 2, allowed: ['ai'] },
            { player: 3, allowed: ['human', 'none'] },
          ],
          hiddenSlots: [2],
          fixedColors: true,
        },
      }),
    );
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      {
        id: 'bridges',
        minimap: false,
        players: [
          {
            player: 0,
            type: 'human',
            tribeId: 1,
            colorId: 0,
            claimable: true,
            hidden: false,
            aiAllowed: true,
          },
          { player: 1, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: true },
          { player: 2, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: true, aiAllowed: true },
          // A Human/Closed-only playeroption row: seatable, never auto-playing.
          {
            player: 3,
            type: 'human',
            tribeId: 1,
            colorId: 2,
            claimable: true,
            hidden: false,
            aiAllowed: false,
          },
        ],
        fixedColors: true,
      },
    ]);
  });

  it('carries the meta sidecar listing header and drops a malformed one', async () => {
    await writeFile(join(mapsRoot, 'free.json'), '{}');
    await writeFile(join(mapsRoot, 'free.meta.json'), '{"mapTypes":[4],"multiplayerOnly":true}');
    await writeFile(join(mapsRoot, 'odd.json'), '{}');
    await writeFile(join(mapsRoot, 'odd.meta.json'), '{"mapTypes":[2,"x"],"multiplayerOnly":"yes"}');
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      { id: 'free', minimap: false, mapTypes: [4], multiplayerOnly: true },
      { id: 'odd', minimap: false, mapTypes: [2] },
    ]);
  });

  it('degrades a malformed script sidecar to a roster-less entry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(mapsRoot, 'bad.json'), '{}');
    await writeFile(join(mapsRoot, 'bad.script.json'), '{not json');
    await writeFile(join(mapsRoot, 'typ.json'), '{}');
    await writeFile(
      join(mapsRoot, 'typ.script.json'),
      '{"players":[{"player":-1,"type":"human","tribeId":1,"colorId":0},{"player":0,"type":"robot","tribeId":1,"colorId":0}]}',
    );
    expect(await buildMapsIndexEntries(fs, mapsRoot)).toEqual([
      { id: 'bad', minimap: false },
      { id: 'typ', minimap: false },
    ]);
    expect(warn).toHaveBeenCalledTimes(1); // only the unparsable one warns; invalid rows drop silently
    warn.mockRestore();
  });
});
