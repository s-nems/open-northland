import { describe, expect, it } from 'vitest';
import {
  buildingBinding,
  buildingFamiliesFor,
  candidateFamilies,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_BOB,
  preferredPaletteFor,
  referencedFamilyLayers,
  VIKING_HOUSE01_BOBS,
} from '../src/content/building-gfx/index.js';
import type { BuildingBobRow, ContentIr } from '../src/content/ir/rows.js';

/**
 * The per-tribe building binding: which `.bmd` × palette pages a world's civilizations need, and which bob
 * each of them draws for a shared `typeId`. Every civilization skins the same type space with its own
 * bodies, so the reduction runs once per fielded tribe over one shared candidate family list.
 */

const VIKING = 1;
const SARACEN = 4;

const VIKING_BMD = 'data/engine2d/bin/bobs/ls_houses_viking.bmd';
const SARACEN_BMD = 'data/engine2d/bin/bobs/ls_houses_saracen.bmd';

function bob(
  tribeId: number,
  typeId: number,
  bobId: number,
  over: Partial<BuildingBobRow> = {},
): BuildingBobRow {
  return { tribeId, typeId, level: 0, bmd: VIKING_BMD, paletteName: 'house01', bobId, ...over };
}

/** A mill and a home per tribe: the viking pair in the default family, the saracen pair in its own. */
const ir: ContentIr = {
  buildingBobs: [
    bob(VIKING, 13, 70),
    bob(VIKING, 6, 41),
    bob(SARACEN, 13, 12, { bmd: SARACEN_BMD, paletteName: 'house_saracen01' }),
    bob(SARACEN, 40, 90, { bmd: SARACEN_BMD, paletteName: 'house_saracen01' }),
    bob(SARACEN, 41, 91, { bmd: SARACEN_BMD, paletteName: 'caves' }),
  ],
};

describe('buildingFamiliesFor', () => {
  it('names every non-default family the given tribes draw from, and only those', () => {
    expect(buildingFamiliesFor(ir.buildingBobs ?? [], [SARACEN], DEFAULT_BUILDING_FAMILY)).toEqual([
      { bmdBasename: 'ls_houses_saracen.bmd', paletteName: 'caves', layer: 'ls_houses_saracen.caves' },
      {
        bmdBasename: 'ls_houses_saracen.bmd',
        paletteName: 'house_saracen01',
        layer: 'ls_houses_saracen.house_saracen01',
      },
    ]);
    // The viking rows all sit in the sheet's shared building layer, which is never a named family.
    expect(buildingFamiliesFor(ir.buildingBobs ?? [], [VIKING], DEFAULT_BUILDING_FAMILY)).toEqual([]);
  });
});

describe('preferredPaletteFor', () => {
  it('takes each tribe its own most common skin, ties broken by name', () => {
    expect(preferredPaletteFor(ir.buildingBobs ?? [], VIKING)).toBe('house01');
    expect(preferredPaletteFor(ir.buildingBobs ?? [], SARACEN)).toBe('house_saracen01');
  });

  it('falls back to the default family skin for a tribe with no rows', () => {
    expect(preferredPaletteFor(ir.buildingBobs ?? [], 99)).toBe(DEFAULT_BUILDING_FAMILY.paletteName);
  });
});

describe('buildingBinding', () => {
  const families = candidateFamilies(ir, [VIKING, SARACEN]);

  it('binds each fielded tribe its own bob for the shared type', () => {
    const binding = buildingBinding(ir, [VIKING, SARACEN], families);
    expect(binding.byTribe?.[VIKING]?.byType[13]).toBe(70);
    expect(binding.byTribe?.[SARACEN]?.byType[13]).toEqual({
      layer: 'ls_houses_saracen.house_saracen01',
      bob: 12,
    });
  });

  it('makes the first tribe the base tables, which back an unloaded tribe', () => {
    const binding = buildingBinding(ir, [VIKING, SARACEN], families);
    expect(binding.byType[13]).toBe(70);
    expect(binding.default).toBe(HOUSE_BOB);
  });

  it('backs the base tribe with the transcribed constant, and only the base tribe', () => {
    // The constant is the fallback for an absent IR; another tribe's types must never inherit viking
    // bobs from it.
    const bare = buildingBinding(null, [VIKING, SARACEN], []);
    expect(bare.byTribe?.[VIKING]?.byType).toEqual(VIKING_HOUSE01_BOBS);
    expect(bare.byTribe?.[SARACEN]?.byType).toEqual({});
  });

  it('keeps the transcribed constant for the types the extracted rows do not cover', () => {
    // A real IR overlays the constant per type rather than replacing it: the mill (13) and the home (6)
    // come from the rows, while the well, hive, farm and bakery still come from the constant.
    const viking = buildingBinding(ir, [VIKING, SARACEN], families).byTribe?.[VIKING]?.byType;
    expect(viking?.[13]).toBe(70);
    expect(viking?.[6]).toBe(41);
    expect(viking?.[10]).toBe(VIKING_HOUSE01_BOBS[10]);
    expect(viking?.[11]).toBe(VIKING_HOUSE01_BOBS[11]);
    expect(viking?.[12]).toBe(VIKING_HOUSE01_BOBS[12]);
    expect(viking?.[15]).toBe(VIKING_HOUSE01_BOBS[15]);
    // The saracen skins none of those types, so it inherits nothing from the viking constant.
    const saracen = buildingBinding(ir, [VIKING, SARACEN], families).byTribe?.[SARACEN]?.byType;
    expect(saracen?.[10]).toBeUndefined();
    expect(saracen?.[15]).toBeUndefined();
  });

  it('drops a row whose family did not load, so the type falls back rather than drawing a stranger', () => {
    // The renderer resolves an unknown family through the default layer, whose frame-id space is
    // disjoint, so a ref into an unloaded page would draw a wrong bob.
    const binding = buildingBinding(ir, [VIKING, SARACEN], []);
    expect(binding.byTribe?.[SARACEN]?.byType[13]).toBeUndefined();
    expect(binding.byTribe?.[VIKING]?.byType[13]).toBe(70);
  });
});

describe('referencedFamilyLayers', () => {
  it('lists exactly the pages the binding draws from, across every tribe', () => {
    const families = candidateFamilies(ir, [VIKING, SARACEN]);
    const layers = referencedFamilyLayers(buildingBinding(ir, [VIKING, SARACEN], families));
    expect([...layers].sort()).toEqual(['ls_houses_saracen.caves', 'ls_houses_saracen.house_saracen01']);
  });

  it('drops a candidate family no winning row draws from, so it is never fetched', () => {
    // A page costs megabytes; the sheet loads only what the winners resolve to.
    const withLoser: ContentIr = {
      buildingBobs: [
        ...(ir.buildingBobs ?? []),
        // Same type and level as the saracen mill but a higher bob id, so the ladder drops it.
        bob(SARACEN, 13, 99, { bmd: 'data/x/ls_houses_beduines.bmd', paletteName: 'rock03' }),
      ],
    };
    const candidates = candidateFamilies(withLoser, [SARACEN]).map((f) => f.layer);
    expect(candidates).toContain('ls_houses_beduines.rock03');
    const layers = referencedFamilyLayers(
      buildingBinding(withLoser, [SARACEN], candidateFamilies(withLoser, [SARACEN])),
    );
    expect(layers.has('ls_houses_beduines.rock03')).toBe(false);
  });
});
