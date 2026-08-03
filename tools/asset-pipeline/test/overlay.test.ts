import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { encodeLib } from '../src/decoders/lib.js';
import { decodePng } from '../src/decoders/png.js';
import { withArchiveLayer } from '../src/roots.js';
import { convertBmdTree } from '../src/stages/bmd/index.js';
import { resolveIniSources } from '../src/stages/ir/sources.js';
import { unpackLibTree } from '../src/stages/lib.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { convertPcxTree } from '../src/stages/pcx.js';
import { indexSourceAssets } from '../src/stages/source-files.js';
import { sampleBmdBytes } from './fixtures/bmd.js';
import { buildMapDat } from './fixtures/mapdat.js';
import { solidPalette } from './fixtures/palette.js';
import { samplePcx } from './fixtures/pcx.js';
import { makeTempDir } from './support/game-tree.js';

/**
 * The split-roots layout: a clean base install plus the culturesnation mod unpacked into a separate
 * directory (the CnMod zip is a game-root-shaped overlay that ships `DataCnmd/`, `CnModMaps/`, and
 * patched `Data/` files). Every read must behave as if the overlay were extracted over the base.
 */
describe('split game/mod source roots', () => {
  let game: string;
  let mod: string;
  let out: string;

  const write = async (root: string, rel: string, bytes: string | Uint8Array): Promise<void> => {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  };

  beforeEach(async () => {
    const tmp = await makeTempDir('overlay');
    game = join(tmp.path, 'game');
    mod = join(tmp.path, 'CnMod');
    out = join(tmp.path, 'out');
    await mkdir(game, { recursive: true });
    await mkdir(mod, { recursive: true });
    return () => rm(tmp.path, { recursive: true, force: true });
  });

  it("resolves a mod-patched base file (the zip's Data/logic twins) over the base game's copy", async () => {
    const rel = join('Data', 'logic', 'goodtypes.ini');
    await write(game, rel, '[goodtype]\ntype 1\nname "base_wood"\n');
    await write(mod, rel, '[goodtype]\ntype 1\nname "mod_wood"\n');
    await write(mod, join('DataCnmd', 'types', 'weapons.ini'), '[weapontype]\n');
    const sources = await resolveIniSources({ game, mod });
    const goodtypes = sources.find((s) => s.file === rel);
    expect(goodtypes?.path).toBe(join(mod, rel));
    const weapons = sources.find((s) => s.file.endsWith('weapons.ini'));
    expect(weapons?.path).toBe(join(mod, 'DataCnmd', 'types', 'weapons.ini'));
  });

  it('emits mod-only maps, and the overlay copy wins a same-path map collision', async () => {
    await write(game, join('Data', 'maps', 'shared', 'map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    await write(mod, join('Data', 'maps', 'shared', 'map.dat'), buildMapDat(1, 1, [6, 6, 6, 6]));
    await write(mod, join('CnModMaps', 'mod_only', 'map.dat'), buildMapDat(1, 1, [3, 3, 3, 3]));
    const done = await convertMapDatTree({ game, mod }, out);
    expect(done.map((d) => d.id).sort()).toEqual(['mod_only', 'shared']);
    const shared = JSON.parse(await readFile(join(out, 'maps', 'shared.json'), 'utf8'));
    // typeId 6 is the overlay grid's fill - the base copy's 2 must not surface.
    expect(shared.typeIds).toEqual([6]);
  });

  it("merges a map folder's sibling files across roots (meta strings from the base, grid from the mod)", async () => {
    const folder = join('Data', 'maps', 'shared');
    await write(mod, join(folder, 'map.dat'), buildMapDat(1, 1, [2, 2, 2, 2]));
    await write(game, join(folder, 'text', 'pol', 'strings.ini'), '[text]\nstringn 0 "Nazwa"\n');
    const done = await convertMapDatTree({ game, mod }, out);
    expect(done[0]?.meta).toBe(true);
    const meta = JSON.parse(await readFile(join(out, 'maps', 'shared.meta.json'), 'utf8'));
    expect(meta.name).toBe('Nazwa');
  });
});

/**
 * The lowest layer: the `.lib` members the unpack stage extracts under `--out`. The loose copy wins a
 * collision (docs/SOURCES.md "Source precedence"), and a loose-only asset must still reach the stages
 * that resolve by reference - the mod's new building bobs exist in no archive.
 */
describe('loose files over unpacked .lib members', () => {
  const TEXTURES = join('Data', 'engine2d', 'bin', 'textures');
  const BOBS = join('Data', 'engine2d', 'bin', 'bobs');
  const LOOSE_RGB = [10, 20, 30] as const;
  const ARCHIVE_RGB = [200, 210, 220] as const;

  let game: string;
  let out: string;

  const write = async (rel: string, bytes: Uint8Array): Promise<void> => {
    const path = join(game, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  };

  /** The first pixel's RGB - `samplePcx` over a `solidPalette` paints every pixel one colour. */
  const firstPixel = async (rel: string): Promise<number[]> => {
    const { rgba } = decodePng(await readFile(join(out, rel)));
    return [rgba[0] ?? -1, rgba[1] ?? -1, rgba[2] ?? -1];
  };

  beforeEach(async () => {
    const tmp = await makeTempDir('archive-layer');
    game = join(tmp.path, 'game');
    out = join(tmp.path, 'out');
    // `runPipeline` creates the out dir before any stage runs, so the archive layer always resolves.
    await mkdir(game, { recursive: true });
    await mkdir(out, { recursive: true });
    return () => rm(tmp.path, { recursive: true, force: true });
  });

  it('converts a colliding .pcx once, from the loose bytes, and still converts an archive-only one', async () => {
    await write(
      join('DataX', 'Libs', 'data0001.lib'),
      encodeLib({
        files: [
          {
            name: 'data\\engine2d\\bin\\textures\\text_000.pcx',
            data: samplePcx(solidPalette(...ARCHIVE_RGB)).bytes,
          },
          {
            name: 'data\\engine2d\\bin\\textures\\archive_only.pcx',
            data: samplePcx(solidPalette(...ARCHIVE_RGB)).bytes,
          },
        ],
      }),
    );
    await write(join(TEXTURES, 'text_000.pcx'), samplePcx(solidPalette(...LOOSE_RGB)).bytes);
    await unpackLibTree({ game, mod: undefined }, out);

    const done = await convertPcxTree(withArchiveLayer({ game, mod: undefined }, out), out);

    const collided = done.filter((d) => d.output === join(TEXTURES, 'text_000.png'));
    expect(collided).toHaveLength(1);
    expect(await firstPixel(join(TEXTURES, 'text_000.png'))).toEqual([...LOOSE_RGB]);
    expect(await firstPixel(join(TEXTURES, 'archive_only.png'))).toEqual([...ARCHIVE_RGB]);
  });

  it('resolves a colliding .bmd reference to the loose copy and indexes a loose-only one', async () => {
    await write(
      join('DataX', 'Libs', 'data0001.lib'),
      encodeLib({ files: [{ name: 'data\\engine2d\\bin\\bobs\\body.bmd', data: sampleBmdBytes() }] }),
    );
    await write(join(BOBS, 'body.bmd'), sampleBmdBytes());
    await write(join(BOBS, 'nowe', 'f_bakery.bmd'), sampleBmdBytes());
    await unpackLibTree({ game, mod: undefined }, out);

    const index = await indexSourceAssets(withArchiveLayer({ game, mod: undefined }, out));

    expect(index.get('data/engine2d/bin/bobs/body.bmd')?.path).toBe(join(game, BOBS, 'body.bmd'));
    expect(index.get('data/engine2d/bin/bobs/nowe/f_bakery.bmd')?.path).toBe(
      join(game, BOBS, 'nowe', 'f_bakery.bmd'),
    );
  });

  it('serves a subdirectory .bmd flat under bobs/ (the mod ships building bobs in no archive)', async () => {
    await write(join(BOBS, 'nowe', 'f_bakery.bmd'), sampleBmdBytes());
    await write(join('Data', 'pal', 'house.pcx'), samplePcx().bytes);

    const done = await convertBmdTree(
      {
        bindings: [
          {
            bmd: 'data/engine2d/bin/bobs/nowe/f_bakery.bmd',
            shadowBmd: undefined,
            paletteName: 'house',
            tribeId: 1,
            jobId: 2,
          },
        ],
        palettes: [{ name: 'house', gfxFile: 'data/pal/house.pcx' }],
        buildTimeBmds: new Set(),
      },
      out,
      await indexSourceAssets(withArchiveLayer({ game, mod: undefined }, out)),
    );

    // The app asks for `/bobs/f_bakery.house.png` - the source's `nowe/` subdirectory must not reach
    // the served name, or the mod's building bobs 404 and fall back.
    expect(done.map((d) => d.png)).toEqual([join(BOBS, 'f_bakery.house.png')]);
    // The atlas lands under out, never back into the read-only game tree.
    await expect(readFile(join(out, BOBS, 'f_bakery.house.png'))).resolves.toBeInstanceOf(Buffer);
    expect(await readdir(join(game, BOBS, 'nowe'))).toEqual(['f_bakery.bmd']);
  });
});
