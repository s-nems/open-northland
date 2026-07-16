import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIr, resolveIniSources } from '../src/stages/ir/index.js';
import { buildStringCif, sampleMapLines } from './fixtures/cif.js';
import { makeTempDir } from './support/game-tree.js';

describe('buildIr / resolveIniSources', () => {
  let game: string;

  beforeEach(async () => {
    const root = (await makeTempDir('ir')).path;
    game = join(root, 'game');
    await mkdir(join(game, 'Data', 'logic'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'tribetypes12'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'atomicanimations12'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'types'), { recursive: true });
    await writeFile(
      join(game, 'Data', 'logic', 'goodtypes.ini'),
      '[goodtype]\nname "wood"\ntype 7\natomicForHarvesting 26\n',
    );
    await writeFile(
      join(game, 'Data', 'logic', 'jobtypes.ini'),
      '[jobtype]\ntype 3\nname "carrier"\nallowatomic 5\nbaseatomics 1\n',
    );
    await writeFile(
      join(game, 'Data', 'logic', 'landscapetypes.ini'),
      '[landscapetype]\ntype 2\nname "grass"\n',
    );
    await writeFile(
      join(game, 'Data', 'logic', 'vehicletypes.ini'),
      '[vehicletype]\ntype 1\nname "handcart"\nlogicsize 0\nstockslots 15\npassengerslots 0\n',
    );
    // Armor's goodtype 7 is the [goodtype] above so its cross-reference resolves.
    await writeFile(
      join(game, 'Data', 'logic', 'armortypes.ini'),
      '[armortype]\nname "leather armor"\ntype 2\nmainType 1\ngoodtype 7\nmaterialType 2\nweight 0\nblockingValue 5\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'tribetypes12', 'tribetypes.ini'),
      '[tribetype]\ntype 1\nname "viking"\nsetatomic 3 5 "viking_carry"\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'atomicanimations12', 'atomicanimations.ini'),
      '[atomicanimation]\nname "viking_carry"\nlength 40\ninterruptable 1\n',
    );
    // Weapon wields jobType 3 (the [jobtype] above) so its cross-reference resolves.
    await writeFile(
      join(game, 'DataCnmd', 'types', 'weapons.ini'),
      '[weapontype]\ntribetype 1\ntype 2\nname "fist"\nminimumrange 1\nmaximumrange 1\ndamagevalue 0 400\njobtype 3\n',
    );
    await mkdir(join(game, 'CnModMaps', 'tutorial_002'), { recursive: true });
    await writeFile(join(game, 'CnModMaps', 'tutorial_002', 'map.cif'), buildStringCif(sampleMapLines()));
  });

  afterEach(async () => {
    await rm(join(game, '..'), { recursive: true, force: true });
  });

  it('reads the readable .ini sources and assembles a validated ContentSet', async () => {
    const set = await buildIr({ game, mod: game });

    expect(set.manifest.version).toBe(1);
    expect(set.manifest.generatedFrom).toEqual({ game, mod: game });
    expect(set.goods.map((g) => g.id)).toEqual(['wood']);
    expect(set.goods[0]?.atomics.harvest).toBe(26);
    expect(set.jobs.map((j) => j.id)).toEqual(['carrier']);
    expect(set.jobs[0]?.allowedAtomics).toEqual([5]);
    expect(set.weapons.map((w) => w.id)).toEqual(['fist']);
    expect(set.weapons[0]).toMatchObject({ typeId: 2, tribeType: 1, jobType: 3, damage: { '0': 400 } });
    expect(set.weapons[0]?.source?.layer).toBe('mod');
    expect(set.landscape.map((l) => l.id)).toEqual(['grass']);
    expect(set.vehicles.map((v) => v.id)).toEqual(['handcart']);
    expect(set.vehicles[0]).toMatchObject({ typeId: 1, stockSlots: 15, passengerSlots: 0, logicSize: 0 });
    expect(set.vehicles[0]?.source?.layer).toBe('base');
    expect(set.armor.map((a) => a.id)).toEqual(['leather_armor']);
    expect(set.armor[0]).toMatchObject({ typeId: 2, goodType: 7, materialType: 2, blockingValue: 5 });
    expect(set.armor[0]?.source?.layer).toBe('base');
    expect(set.tribes.map((t) => t.id)).toEqual(['viking']);
    expect(set.atomicAnimations.map((a) => a.name)).toEqual(['viking_carry']);
    // The map.cif logic header is decoded into the IR alongside the .ini type tables.
    expect(set.maps.map((m) => m.id)).toEqual(['tutorial_002']);
    expect(set.maps[0]).toMatchObject({ width: 142, height: 146, mapType: 1 });
    // Provenance stamps the mod layer on a DataCnmd source, base on a Data/logic one.
    expect(set.goods[0]?.source?.layer).toBe('base');
    expect(set.tribes[0]?.source?.layer).toBe('mod');
  });

  it('cross-validates: a tribe binding to an absent jobType fails parseContentSet', async () => {
    // Point the tribe's setatomic at jobType 99, which no [jobtype] defines.
    await writeFile(
      join(game, 'DataCnmd', 'tribetypes12', 'tribetypes.ini'),
      '[tribetype]\ntype 1\nname "viking"\nsetatomic 99 5 "viking_carry"\n',
    );
    await expect(buildIr({ game, mod: game })).rejects.toThrow(/unknown jobType 99/);
  });

  it('drops a missing source with a warning instead of aborting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The DataCnmd rels are always requested; without an overlay they still resolve against the game
    // tree itself (the mod-installed-in-place layout this fixture lays down).
    const noOverlay = await resolveIniSources({ game, mod: undefined });
    expect(noOverlay.map((s) => s.file).sort()).toEqual([
      join('Data', 'logic', 'armortypes.ini'),
      join('Data', 'logic', 'goodtypes.ini'),
      join('Data', 'logic', 'jobtypes.ini'),
      join('Data', 'logic', 'landscapetypes.ini'),
      join('Data', 'logic', 'vehicletypes.ini'),
      join('DataCnmd', 'atomicanimations12', 'atomicanimations.ini'),
      join('DataCnmd', 'tribetypes12', 'tribetypes.ini'),
      join('DataCnmd', 'types', 'weapons.ini'),
    ]);

    // Remove a base file: it's resolved-away with a warning, not a throw. (Drop the armor source
    // too: it references good 7, which the cross-ref would flag as dangling once goods is empty —
    // unrelated to this missing-source resilience check.)
    await rm(join(game, 'Data', 'logic', 'goodtypes.ini'));
    await rm(join(game, 'Data', 'logic', 'armortypes.ini'));
    const partial = await resolveIniSources({ game, mod: game });
    expect(partial.some((s) => s.file.endsWith('goodtypes.ini'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not found.*goodtypes\.ini/));

    const set = await buildIr({ game, mod: game });
    expect(set.goods).toEqual([]); // missing goods source -> empty, rest still present
    expect(set.jobs.length).toBe(1);
    warn.mockRestore();
  });
});
