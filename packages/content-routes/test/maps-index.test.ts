import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMapsIndexEntries } from '../src/maps-index.js';

/**
 * The `/maps-index` join (`src/maps-index.ts`): grids + optional sidecars → menu
 * entries. The invariant under test is per-entry tolerance — one malformed sidecar (including the
 * `JSON.parse('null')` trap, which parses successfully) degrades its own entry, never the list.
 */
describe('buildMapsIndexEntries', () => {
  let mapsRoot: string;

  beforeEach(async () => {
    mapsRoot = await mkdtemp(join(tmpdir(), 'opennorthland-maps-index-'));
  });

  afterEach(async () => {
    await rm(mapsRoot, { recursive: true, force: true });
  });

  it('joins each grid with its meta strings and minimap flag, sorted by id', async () => {
    await writeFile(join(mapsRoot, 'b_map.json'), '{}');
    await writeFile(join(mapsRoot, 'a_map.json'), '{}');
    await writeFile(join(mapsRoot, 'a_map.meta.json'), '{"name":"Mapa A","description":"Opis A"}');
    await writeFile(join(mapsRoot, 'a_map.png'), 'png-bytes');
    expect(buildMapsIndexEntries(mapsRoot)).toEqual([
      { id: 'a_map', name: 'Mapa A', description: 'Opis A', minimap: true },
      { id: 'b_map', minimap: false },
    ]);
  });

  it('never lists a .meta.json sidecar as a map of its own', async () => {
    await writeFile(join(mapsRoot, 'lonely.meta.json'), '{"name":"ghost"}');
    expect(buildMapsIndexEntries(mapsRoot)).toEqual([]);
  });

  it('degrades a malformed sidecar to the bare id instead of failing the list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(mapsRoot, 'nul.json'), '{}');
    await writeFile(join(mapsRoot, 'nul.meta.json'), 'null'); // parses fine, is not an object
    await writeFile(join(mapsRoot, 'bad.json'), '{}');
    await writeFile(join(mapsRoot, 'bad.meta.json'), '{not json');
    await writeFile(join(mapsRoot, 'typ.json'), '{}');
    await writeFile(join(mapsRoot, 'typ.meta.json'), '{"name":42,"description":["x"]}');
    expect(buildMapsIndexEntries(mapsRoot)).toEqual([
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
    expect(buildMapsIndexEntries(mapsRoot)).toEqual([
      {
        id: 'arena',
        minimap: false,
        players: [
          { player: 0, type: 'human', tribeId: 1, colorId: 7, name: 'Ragnar' },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
        ],
      },
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
    expect(buildMapsIndexEntries(mapsRoot)).toEqual([
      { id: 'bad', minimap: false },
      { id: 'typ', minimap: false },
    ]);
    expect(warn).toHaveBeenCalledTimes(1); // only the unparsable one warns; invalid rows drop silently
    warn.mockRestore();
  });
});
