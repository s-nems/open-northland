import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobBaseGraphicsToBindings, resolveGraphicsBindings } from '../src/stages/bmd/index.js';
import { buildStringCif } from './fixtures/cif.js';
import { makeTempDir } from './support/game-tree.js';

/** The hand-authored guidepost binding appended LAST on every resolve (engine-bound in the original —
 *  no data table names it; see resolveGraphicsBindings). */
const GUIDEPOST_BINDING = ['data/engine2d/bin/bobs/ls_guidepost.bmd', 'bridge01'];

describe('resolveGraphicsBindings', () => {
  let game: string;

  beforeEach(async () => {
    game = (await makeTempDir('gfx')).path;
  });

  afterEach(async () => {
    await rm(game, { recursive: true, force: true });
  });

  it('reads the readable jobgraphics + palettes inis into bindings + palette aliases', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'palettes'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Body.bmd"\ngfxpalettebody "Bear01"\n',
    );
    await writeFile(
      join(game, inis, 'palettes', 'palettes.ini'),
      '[GfxPalette256]\neditname "Bear01"\ngfxfile "data\\pal\\bear01.pcx"\n',
    );

    const { bindings, palettes } = await resolveGraphicsBindings(game, undefined);

    expect(bindings).toHaveLength(2); // the animals record + the appended guidepost hand-binding
    expect(bindings[0]?.bmd).toBe('data/bobs/body.bmd');
    expect(bindings[0]?.paletteName).toBe('bear01');
    expect([bindings[1]?.bmd, bindings[1]?.paletteName]).toEqual(GUIDEPOST_BINDING);
    expect(palettes).toEqual([{ name: 'bear01', gfxFile: 'data/pal/bear01.pcx' }]);
  });

  it('merges the mod [jobbasegraphics] human body/head bobs onto the base animals bindings', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'types', 'humanstype'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'types', 'humanstype', 'jobgraphics.ini'),
      '[jobbasegraphics]\nlogictribe 1\nlogicjob 6\n' +
        'gfxbobmanagerbody 0 "Data\\Bobs\\Body00.bmd" "Data\\Bobs\\Body00_s.bmd"\n' +
        'gfxbobmanagerhead 0 "Data\\Bobs\\Head00.bmd"\n' +
        'gfxbobmanagerhead 1 "Data\\Bobs\\Head01.bmd"\n' +
        'gfxpalettebasebody "human_body"\ngfxpalettebasehead "human_head"\ngfxpaletterandom "Vik_Man_Base"\n',
    );

    const { bindings } = await resolveGraphicsBindings(game, 'DataCnmd');

    // Base animals binding first, then the flattened mod body + head slots.
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/body00.bmd', 'human_body'],
      ['data/bobs/head00.bmd', 'human_head'],
      ['data/bobs/head01.bmd', 'human_head'],
      GUIDEPOST_BINDING,
    ]);
    // The body slot keeps its shadow + cross-refs; the random tint is not emitted as a binding.
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/body00_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    expect(bindings[1]?.jobId).toBe(6);
    expect(bindings.some((b) => b.paletteName === 'vik_man_base')).toBe(false);
  });

  it('merges the base-game humans/jobgraphics.cif [jobbasegraphics] records (the .cif-only leg)', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'humans'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    // The base human graphics ship only as encrypted .cif, decoded via the same CStringArray path.
    await writeFile(
      join(game, inis, 'humans', 'jobgraphics.cif'),
      buildStringCif([
        { level: 1, text: 'jobbasegraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'logicjob 6' },
        { level: 2, text: 'gfxbobmanagerbody 0 "Data\\Bobs\\Body00.bmd" "Data\\Bobs\\Body00_s.bmd"' },
        { level: 2, text: 'gfxbobmanagerhead 0 "Data\\Bobs\\Head00.bmd"' },
        { level: 2, text: 'gfxpalettebasebody "test_human_00"' },
        { level: 2, text: 'gfxpalettebasehead "test_human_00"' },
        // A second section name (jobchangegraphics) must not be picked up by the base extractor.
        { level: 1, text: 'jobchangegraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'gfxbobmanagerbody 0 "Data\\Bobs\\Body01.bmd"' },
      ]),
    );

    const { bindings } = await resolveGraphicsBindings(game, undefined);

    // Base animals binding first, then the flattened base-human body + head slots; the
    // jobchangegraphics body00 record is NOT emitted (different section name).
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/body00.bmd', 'test_human_00'],
      ['data/bobs/head00.bmd', 'test_human_00'],
      GUIDEPOST_BINDING,
    ]);
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/body00_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    expect(bindings[1]?.jobId).toBe(6);
  });

  it('merges the base-game vehicles/jobgraphics.cif [jobgraphics] cart/ship records (.cif-only leg)', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'vehicles'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    // Vehicles ship only as encrypted .cif; the flat [jobgraphics] grammar matches the animals .ini,
    // keyed by logicvehicle instead of logicjob (which is left undefined).
    await writeFile(
      join(game, inis, 'vehicles', 'jobgraphics.cif'),
      buildStringCif([
        { level: 1, text: 'jobgraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'logicvehicle 2' },
        { level: 2, text: 'gfxbobmanagerbody "Data\\Bobs\\Cart.bmd" "Data\\Bobs\\Cart_s.bmd"' },
        { level: 2, text: 'gfxpalettebody "OxCart"' },
      ]),
    );

    const { bindings } = await resolveGraphicsBindings(game, undefined);

    // Base animals binding first, then the flattened vehicle record.
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/cart.bmd', 'oxcart'],
      GUIDEPOST_BINDING,
    ]);
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/cart_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    // logicvehicle is not a job cross-ref, so jobId stays undefined.
    expect(bindings[1]?.jobId).toBeUndefined();
  });

  it('overlays the mod vehiclestype/jobgraphics.ini [jobgraphics] cart/ship records (golden rule #4)', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'vehicles'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'types', 'vehiclestype'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    // The base vehicles .cif carries the narrow base-tribe set.
    await writeFile(
      join(game, inis, 'vehicles', 'jobgraphics.cif'),
      buildStringCif([
        { level: 1, text: 'jobgraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'logicvehicle 2' },
        { level: 2, text: 'gfxbobmanagerbody "Data\\Bobs\\Cart.bmd" "Data\\Bobs\\Cart_s.bmd"' },
        { level: 2, text: 'gfxpalettebody "OxCart"' },
      ]),
    );
    // The mod ships the readable twin with an extra tribe's vehicle recolour (broader per-tribe set).
    await writeFile(
      join(game, 'DataCnmd', 'types', 'vehiclestype', 'jobgraphics.ini'),
      '[jobgraphics]\nlogictribe 1\nlogicvehicle 2\n' +
        'gfxbobmanagerbody "Data\\Bobs\\Cart.bmd" "Data\\Bobs\\Cart_s.bmd"\ngfxpalettebody "OxCart"\n\n' +
        '[jobgraphics]\nlogictribe 3\nlogicvehicle 4\n' +
        'gfxbobmanagerbody "Data\\Bobs\\Ship.bmd" "Data\\Bobs\\Ship_s.bmd"\ngfxpalettebody "Human_Ship01"\n',
    );

    const { bindings } = await resolveGraphicsBindings(game, 'DataCnmd');

    // Base animals binding, then the base vehicle .cif record, then the mod's [jobgraphics] overlay.
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/cart.bmd', 'oxcart'],
      ['data/bobs/cart.bmd', 'oxcart'],
      ['data/bobs/ship.bmd', 'human_ship01'],
      GUIDEPOST_BINDING,
    ]);
    // The mod's extra tribe-3 ship carries its own per-tribe cross-ref (the base .cif lacks it).
    expect(bindings[3]?.tribeId).toBe(3);
    expect(bindings[3]?.shadowBmd).toBe('data/bobs/ship_s.bmd');
    expect(bindings[3]?.jobId).toBeUndefined();
  });

  it('claims [GfxHouse] .bmds for the opaque-alpha bake (mod houses.ini leg)', async () => {
    await mkdir(join(game, 'DataCnmd', 'budynki12', 'houses'), { recursive: true });
    await writeFile(
      join(game, 'DataCnmd', 'budynki12', 'houses', 'houses.ini'),
      '[GfxHouse]\nEditName "viking home"\n' +
        'GfxBobLibs "Data\\Bobs\\ls_houses_viking.bmd" "Data\\Bobs\\ls_houses_viking_s.bmd"\n' +
        'GfxPalette "house01" "house02"\n',
    );

    const { bindings, buildTimeBmds } = await resolveGraphicsBindings(game, 'DataCnmd');

    // Every palette recolour becomes a binding, and the CLAIM is on the .bmd path alone, so the
    // landscape twins of the same geometry bake opaque too (convertBmdTree keys on the bmd).
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/ls_houses_viking.bmd', 'house01'],
      ['data/bobs/ls_houses_viking.bmd', 'house02'],
      GUIDEPOST_BINDING,
    ]);
    expect([...buildTimeBmds]).toEqual(['data/bobs/ls_houses_viking.bmd']);
  });

  it('returns only the hand-authored guidepost with a warning when every source is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { bindings, palettes } = await resolveGraphicsBindings(game, undefined); // nothing laid down

    // The unconditional guidepost hand-binding remains (convertBmdTree skips it when unresolvable).
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([GUIDEPOST_BINDING]);
    expect(palettes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/jobgraphics\.ini/));
    warn.mockRestore();
  });
});

describe('jobBaseGraphicsToBindings', () => {
  it('flattens body slots (bodyPalette) and head slots (headPalette) into flat bindings', () => {
    const flat = jobBaseGraphicsToBindings([
      {
        tribeId: 2,
        jobId: 4,
        body: [{ index: 0, bmd: 'data/bobs/body.bmd', shadowBmd: 'data/bobs/body_s.bmd' }],
        head: [
          { index: 0, bmd: 'data/bobs/head0.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/bobs/head1.bmd', shadowBmd: undefined },
        ],
        bodyPalette: 'b_pal',
        headPalette: 'h_pal',
        randomPalette: 'rnd',
      },
    ]);

    expect(flat).toEqual([
      {
        bmd: 'data/bobs/body.bmd',
        shadowBmd: 'data/bobs/body_s.bmd',
        paletteName: 'b_pal',
        tribeId: 2,
        jobId: 4,
      },
      { bmd: 'data/bobs/head0.bmd', shadowBmd: undefined, paletteName: 'h_pal', tribeId: 2, jobId: 4 },
      { bmd: 'data/bobs/head1.bmd', shadowBmd: undefined, paletteName: 'h_pal', tribeId: 2, jobId: 4 },
    ]);
  });

  it('drops slots whose palette editname is absent (nothing to resolve against)', () => {
    const flat = jobBaseGraphicsToBindings([
      {
        tribeId: undefined,
        jobId: undefined,
        body: [{ index: 0, bmd: 'data/bobs/body.bmd', shadowBmd: undefined }],
        head: [{ index: 0, bmd: 'data/bobs/head.bmd', shadowBmd: undefined }],
        bodyPalette: 'b_pal', // body keeps its palette
        headPalette: undefined, // head has none -> dropped
        randomPalette: undefined,
      },
    ]);

    expect(flat).toEqual([
      {
        bmd: 'data/bobs/body.bmd',
        shadowBmd: undefined,
        paletteName: 'b_pal',
        tribeId: undefined,
        jobId: undefined,
      },
    ]);
  });
});
