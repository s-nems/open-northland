import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { convertMapDatTree, mapIdFromPath } from '../src/stages/maps/index.js';
import { buildStringCif } from './fixtures/cif.js';
import { buildMapDat } from './fixtures/mapdat.js';
import { rampPalette } from './fixtures/palette.js';
import { makeTempDir } from './support/game-tree.js';

describe('convertMapDatTree', () => {
  let root: string;
  let game: string;
  let out: string;

  beforeEach(async () => {
    root = (await makeTempDir('mapdat')).path;
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(join(game, 'CnModMaps', 'tutorial_002'), { recursive: true });
    await mkdir(join(game, 'CnModMaps', 'forteca'), { recursive: true });
    await writeFile(
      join(game, 'CnModMaps', 'tutorial_002', 'map.dat'),
      buildMapDat(2, 1, [
        3,
        3,
        6,
        6, // half-cell row 0
        3,
        3,
        6,
        6, // half-cell row 1
      ]),
    );
    await writeFile(join(game, 'CnModMaps', 'forteca', 'map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes maps/<id>.json for every map.dat, sorted by rel path, id from folder', async () => {
    const done = await convertMapDatTree({ game, mod: undefined }, out);
    expect(done.map((d) => d.id)).toEqual(['forteca', 'tutorial_002']); // sorted by rel path
    expect(done.find((d) => d.id === 'tutorial_002')).toMatchObject({ width: 2, height: 1 });

    // The emitted JSON is the TerrainMap the sim's buildTerrainGraph consumes (raw values ARE the
    // IR typeIds; this synthetic map carries no ground/object lanes, so none are emitted).
    const grid = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.json'), 'utf8'));
    expect(grid).toEqual({ width: 2, height: 1, typeIds: [3, 6] });
    // The id joins onto the same-folder map.cif's MapInfo id.
    expect(done.map((d) => d.id)).toContain(mapIdFromPath(join('CnModMaps', 'tutorial_002', 'map.dat')));
  });

  it('skips a malformed map.dat with a warning instead of aborting the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(game, 'CnModMaps', 'forteca', 'map.dat'), Uint8Array.from([0, 1, 2, 3]));
    const done = await convertMapDatTree({ game, mod: undefined }, out);
    expect(done.map((d) => d.id)).toEqual(['tutorial_002']); // the good one still converts
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped map\.dat.*forteca/));
    warn.mockRestore();
  });

  /** Raw single-byte string → bytes (for CP1250 fixtures written verbatim to disk). */
  const rawBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

  it('emits no meta/minimap sidecars for a folder without text or minimap', async () => {
    const done = await convertMapDatTree({ game, mod: undefined }, out);
    expect(done.find((d) => d.id === 'forteca')).toMatchObject({ meta: false, minimap: false });
    await expect(readFile(join(out, 'maps', 'forteca.meta.json'))).rejects.toThrow();
    await expect(readFile(join(out, 'maps', 'forteca.png'))).rejects.toThrow();
  });

  it('emits the meta sidecar from text/pol/strings.ini (CP1250, observed 0/1 string ids) + the minimap PNG', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    // "BŁĘKIT" with CP1250 bytes (Ł=0xA3, Ę=0xCA) — the map strings' real codepage.
    await mkdir(join(dir, 'text', 'pol'), { recursive: true });
    await writeFile(
      join(dir, 'text', 'pol', 'strings.ini'),
      rawBytes('[text]\nstringn 0 "B\xa3\xcaKIT"\nstringn 1 "Opis mapy"\n'),
    );
    await mkdir(join(dir, 'minimap'), { recursive: true });
    await writeFile(
      join(dir, 'minimap', 'minimap.pcx'),
      encodePcx({ width: 2, height: 1, pixels: Uint8Array.from([1, 2]), palette: rampPalette() }),
    );
    const done = await convertMapDatTree({ game, mod: undefined }, out);
    expect(done.find((d) => d.id === 'tutorial_002')).toMatchObject({ meta: true, minimap: true });
    const meta = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.meta.json'), 'utf8'));
    expect(meta).toEqual({ name: 'BŁĘKIT', description: 'Opis mapy' });
    const png = decodePng(await readFile(join(out, 'maps', 'tutorial_002.png')));
    expect({ width: png.width, height: png.height }).toEqual({ width: 2, height: 1 });
  });

  it('prefers pol over eng and resolves the string ids from the map.cif misc_mapname header', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    // The header names non-default string ids (the tutorial maps really use 99/98).
    await writeFile(
      join(dir, 'map.cif'),
      buildStringCif([
        { level: 1, text: 'logiccontrol' },
        { level: 2, text: 'mapsize 2 1' },
        { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
        { level: 1, text: 'misc_mapname' },
        { level: 2, text: 'mapnamestringid 99' },
        { level: 2, text: 'mapdescriptionstringid 98' },
      ]),
    );
    for (const [lang, name] of [
      ['pol', 'Samotnia'],
      ['eng', 'Hermitage'],
    ] as const) {
      await mkdir(join(dir, 'text', lang), { recursive: true });
      await writeFile(
        join(dir, 'text', lang, 'strings.ini'),
        rawBytes(`[text]\nstringn 99 "${name}"\nstringn 98 "Desc ${lang}"\n`),
      );
    }
    await convertMapDatTree({ game, mod: undefined }, out);
    const meta = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.meta.json'), 'utf8'));
    expect(meta).toEqual({ name: 'Samotnia', description: 'Desc pol' });
  });

  it('falls back to the encrypted strings.cif when no strings.ini exists (re-decoded to CP1250)', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    await mkdir(join(dir, 'text', 'pol'), { recursive: true });
    // 0xB3/0xEA are ł/ę in CP1250 — the .cif seam decodes latin1, the stage re-decodes for display.
    await writeFile(
      join(dir, 'text', 'pol', 'strings.cif'),
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: 'stringn 0 "B\xb3\xeakit"' },
        { level: 2, text: 'stringn 1 "Opis"' },
      ]),
    );
    await convertMapDatTree({ game, mod: undefined }, out);
    const meta = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.meta.json'), 'utf8'));
    expect(meta).toEqual({ name: 'Błękit', description: 'Opis' });
  });

  it('prefers the readable strings.ini over a sibling strings.cif (golden rule 4)', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    await mkdir(join(dir, 'text', 'pol'), { recursive: true });
    await writeFile(join(dir, 'text', 'pol', 'strings.ini'), rawBytes('[text]\nstringn 0 "Readable"\n'));
    await writeFile(
      join(dir, 'text', 'pol', 'strings.cif'),
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: 'stringn 0 "Encrypted"' },
      ]),
    );
    await convertMapDatTree({ game, mod: undefined }, out);
    const meta = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.meta.json'), 'utf8'));
    expect(meta).toEqual({ name: 'Readable' });
  });

  it('resolves the string ids from a readable misc.inc header before the encrypted map.cif', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    // misc.inc says 99/98 (the real corpus carries ~25 such headers); the map.cif disagrees — the
    // readable header must win (golden rule 4).
    await writeFile(
      join(dir, 'misc.inc'),
      rawBytes('[misc_mapname]\nmapnamestringid 99\nmapdescriptionstringid 98\n'),
    );
    await writeFile(
      join(dir, 'map.cif'),
      buildStringCif([
        { level: 1, text: 'logiccontrol' },
        { level: 2, text: 'mapsize 2 1' },
        { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
        { level: 1, text: 'misc_mapname' },
        { level: 2, text: 'mapnamestringid 0' },
        { level: 2, text: 'mapdescriptionstringid 1' },
      ]),
    );
    await mkdir(join(dir, 'text', 'pol'), { recursive: true });
    await writeFile(
      join(dir, 'text', 'pol', 'strings.ini'),
      rawBytes('[text]\nstringn 0 "Zero"\nstringn 1 "Jeden"\nstringn 99 "Wlasciwa"\nstringn 98 "Opis99"\n'),
    );
    await convertMapDatTree({ game, mod: undefined }, out);
    const meta = JSON.parse(await readFile(join(out, 'maps', 'tutorial_002.meta.json'), 'utf8'));
    expect(meta).toEqual({ name: 'Wlasciwa', description: 'Opis99' });
  });

  it('removes a stale meta sidecar when a re-run no longer finds strings', async () => {
    const dir = join(game, 'CnModMaps', 'tutorial_002');
    await mkdir(join(dir, 'text', 'pol'), { recursive: true });
    await writeFile(join(dir, 'text', 'pol', 'strings.ini'), rawBytes('[text]\nstringn 0 "Nazwa"\n'));
    await convertMapDatTree({ game, mod: undefined }, out);
    await readFile(join(out, 'maps', 'tutorial_002.meta.json')); // emitted on the first run
    await rm(join(dir, 'text'), { recursive: true, force: true });
    const done = await convertMapDatTree({ game, mod: undefined }, out);
    expect(done.find((d) => d.id === 'tutorial_002')).toMatchObject({ meta: false });
    await expect(readFile(join(out, 'maps', 'tutorial_002.meta.json'))).rejects.toThrow();
  });
});
