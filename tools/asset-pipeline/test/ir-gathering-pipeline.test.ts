import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  extractGoods,
  extractLandscapeGfx,
  parseIniSections,
} from '../src/decoders/ini.js';
import { buildGatheringPipeline } from '../src/stages/ir/gathering-pipeline.js';

describe('buildGatheringPipeline', () => {
  // A goods table (wood: a full 4->6->7 chain; honey: pickup/store only; flour: produced, no chain)
  // + a small gfx table whose logicTypes place stages 4 (two tree species -> indices 0,1), 6 (trunk
  // -> 2), 7 (wood pile -> 3). No gfx record carries logicType 32 (honey), exercising the empty-join.
  const goods = extractGoods(
    parseIniSections(
      '[goodtype]\nname "wood"\ntype 5\nlandscapetype 7\nisBioLandscapeFlag 1\nlandscapeToHarvest 4\nlandscapeToPickup 6\nlandscapeToStore 7\natomicForHarvesting 24\n' +
        '[goodtype]\nname "honey"\ntype 12\nlandscapetype 32\nlandscapeToPickup 32\nlandscapeToStore 32\n' +
        '[goodtype]\nname "flour"\ntype 11\nlandscapetype 30\nisProducedInHouseFlag 1\n',
    ),
    { file: 'goodtypes.ini' },
  );
  const gfxRecord = (editName: string, logicType: number): CifLine[] => [
    { level: 1, text: 'GfxLandscape' },
    { level: 2, text: `EditName "${editName}"` },
    { level: 2, text: `LogicType ${logicType}` },
    { level: 2, text: 'GfxBobLibs "a.bmd"' },
    { level: 2, text: 'GfxPalette "p"' },
  ];
  const gfx = extractLandscapeGfx(
    cifLinesToSections([
      ...gfxRecord('pine 01', 4),
      ...gfxRecord('oak 01', 4),
      ...gfxRecord('trunk 01', 6),
      ...gfxRecord('wood pile 01', 7),
    ]),
    { file: 'landscapes.cif' },
  );

  it('resolves each gathering good to its three stages, joined to the gfx records by logicType', () => {
    const wood = buildGatheringPipeline(goods, gfx).find((p) => p.goodId === 'wood');
    expect(wood).toEqual({
      goodType: 5,
      goodId: 'wood',
      harvestAtomic: 24,
      bioLandscape: true,
      // stage id -> the LandscapeGfx.index values whose logicType matches, in ascending order.
      harvest: { landscapeType: 4, gfxIndices: [0, 1] },
      pickup: { landscapeType: 6, gfxIndices: [2] },
      store: { landscapeType: 7, gfxIndices: [3] },
    });
  });

  it('leaves an absent lane out and yields empty gfxIndices for a stage no gfx places (honey)', () => {
    const honey = buildGatheringPipeline(goods, gfx).find((p) => p.goodId === 'honey');
    // No harvest lane in the source, and no gfx record carries logicType 32 -> empty, not dropped.
    expect(honey).toEqual({
      goodType: 12,
      goodId: 'honey',
      bioLandscape: false,
      pickup: { landscapeType: 32, gfxIndices: [] },
      store: { landscapeType: 32, gfxIndices: [] },
    });
    expect(honey?.harvest).toBeUndefined();
  });

  it('skips a produced good that carries no gathering chain', () => {
    expect(buildGatheringPipeline(goods, gfx).map((p) => p.goodId)).toEqual(['wood', 'honey']);
  });
});
