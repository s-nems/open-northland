import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveIniSources } from '../src/stages/ir/sources.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { buildMapDat } from './fixtures/mapdat.js';
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
    // typeId 6 is the overlay grid's fill — the base copy's 2 must not surface.
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
