import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  buildGatheringPipeline,
  cifLinesToSections,
  extractGoods,
  extractLandscape,
  extractLandscapeGfx,
  extractTrianglePatternTypes,
  parseIniSections,
} from '../src/decoders/ini.js';
import { LANDSCAPE_INI } from './fixtures/ini-sources.js';

describe('extractLandscape', () => {
  it('slugifies multi-word names and defaults walkable/buildable', () => {
    const land = extractLandscape(parseIniSections(LANDSCAPE_INI), {
      file: 'Data/logic/landscapetypes.ini',
      layer: 'base',
    });
    expect(land.map((l) => l.id)).toEqual(['void', 'water', 'tree', 'tree_falling', 'trunk', 'wood', 'wall']);
    const treeFalling = land.find((l) => l.id === 'tree_falling');
    expect(treeFalling).toMatchObject({ typeId: 5, id: 'tree_falling', walkable: true, buildable: true });
  });

  it('captures the raw `name` and the `transition` tuples verbatim (semantics undecoded)', () => {
    const byId = new Map(
      extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' }).map((l) => [l.id, l]),
    );
    // The raw display name is kept alongside the slug id.
    expect(byId.get('tree')).toMatchObject({ typeId: 4, name: 'tree' });
    // Both `transition` lines survive in file order as raw int tuples — no field is interpreted.
    expect(byId.get('tree')?.transitions).toEqual([
      [7, 4, 2, 1, 0],
      [11, 5, 2, 0, 0],
    ]);
    // A type with a single transition keeps it; a type with none defaults to [].
    expect(byId.get('trunk')?.transitions).toEqual([[3, 6, 2, -1, 5]]);
    expect(byId.get('void')?.transitions).toEqual([]);
  });

  it('keeps a variable-arity transition tuple (the 2-int `mine` form) as-is', () => {
    const [mine] = extractLandscape(
      parseIniSections('[landscapetype]\ntype 12\nname "mud_mine"\ntransition 12 13\n'),
      { file: 'landscapetypes.ini' },
    );
    expect(mine?.transitions).toEqual([[12, 13]]);
  });

  it('extracts maximumValency and the allowedon* placement flags (1/0 ints -> booleans)', () => {
    const byId = new Map(
      extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' }).map((l) => [l.id, l]),
    );
    // "void" carries the high valency and allowedoneverything; not on land/water.
    expect(byId.get('void')).toMatchObject({
      maxValency: 100,
      allowedOnLand: false,
      allowedOnWater: false,
      allowedOnEverything: true,
    });
    // "water" sits on the land layer with allowedonwater explicitly 0 -> false.
    expect(byId.get('water')).toMatchObject({
      maxValency: 5,
      allowedOnLand: true,
      allowedOnWater: false,
      allowedOnEverything: false,
    });
    // A wall/gate sits on BOTH land and water (allowedonwater 1).
    expect(byId.get('wall')).toMatchObject({ maxValency: 1, allowedOnLand: true, allowedOnWater: true });
  });

  it('defaults maxValency to 0 and the flags to false when the source omits them', () => {
    const [only] = extractLandscape(parseIniSections('[landscapetype]\ntype 9\nname "bare"\n'), {
      file: 'landscapetypes.ini',
    });
    expect(only).toMatchObject({
      typeId: 9,
      maxValency: 0,
      allowedOnLand: false,
      allowedOnWater: false,
      allowedOnEverything: false,
    });
  });
});

describe('extractTrianglePatternTypes', () => {
  // Mirrors Data/logic/trianglepatterntypes.cif as cifLinesToSections yields it: level-1
  // `trianglepatterntype` headers, level-2 lowercase props. The `water` record omits every "walk/build"
  // flag (absent -> false); `land` sets several to 1; a third record omits debugcolor (-> undefined).
  const lines: CifLine[] = [
    { level: 1, text: 'trianglepatterntype' },
    { level: 2, text: 'type 1' },
    { level: 2, text: 'iswater 1' },
    { level: 2, text: 'moveresistance 1' },
    { level: 2, text: 'debugname "water"' },
    { level: 2, text: 'debugcolor 0 98 115' },
    { level: 1, text: 'trianglepatterntype' },
    { level: 2, text: 'type 2' },
    { level: 2, text: 'humancanwalkon 1' },
    { level: 2, text: 'housecanbebuildon 1' },
    { level: 2, text: 'biocangrowon 1' },
    { level: 2, text: 'biocanplanton 1' },
    { level: 2, text: 'island 1' },
    { level: 2, text: 'moveresistance 2' },
    { level: 2, text: 'debugname "land"' },
    { level: 2, text: 'debugcolor 23 145 25' },
  ];

  it('maps [trianglepatterntype] to validated IR: flags as booleans, debugcolor as an RGB tuple', () => {
    const src = { file: 'Data/logic/trianglepatterntypes.cif', block: 'trianglepatterntype', layer: 'base' };
    expect(
      extractTrianglePatternTypes(cifLinesToSections(lines), {
        file: 'Data/logic/trianglepatterntypes.cif',
        layer: 'base',
      }),
    ).toEqual([
      {
        type: 1,
        debugName: 'water',
        isWater: true,
        humanCanWalkOn: false,
        houseCanBeBuildOn: false,
        bioCanGrowOn: false,
        bioCanPlantOn: false,
        island: false,
        moveResistance: 1,
        debugColor: [0, 98, 115],
        source: src,
      },
      {
        type: 2,
        debugName: 'land',
        isWater: false,
        humanCanWalkOn: true,
        houseCanBeBuildOn: true,
        bioCanGrowOn: true,
        bioCanPlantOn: true,
        island: true,
        moveResistance: 2,
        debugColor: [23, 145, 25],
        source: src,
      },
    ]);
  });

  it('defaults the flags to false, moveResistance to 0, and debugColor to undefined when omitted', () => {
    const [only] = extractTrianglePatternTypes(
      cifLinesToSections([
        { level: 1, text: 'trianglepatterntype' },
        { level: 2, text: 'type 6' },
        { level: 2, text: 'debugname "blocked"' },
      ]),
      { file: 'f.cif' },
    );
    expect(only).toEqual({
      type: 6,
      debugName: 'blocked',
      isWater: false,
      humanCanWalkOn: false,
      houseCanBeBuildOn: false,
      bioCanGrowOn: false,
      bioCanPlantOn: false,
      island: false,
      moveResistance: 0,
      debugColor: undefined,
      source: { file: 'f.cif', block: 'trianglepatterntype', layer: 'base' },
    });
  });

  it('throws on a [trianglepatterntype] missing its numeric `type`', () => {
    expect(() =>
      extractTrianglePatternTypes(
        cifLinesToSections([
          { level: 1, text: 'trianglepatterntype' },
          { level: 2, text: 'debugname "x"' },
        ]),
        { file: 'f.cif' },
      ),
    ).toThrow(/without a numeric `type`/);
  });
});

describe('extractLandscapeGfx', () => {
  // Mirrors the real [GfxLandscape] grammar (decrypted twin: EdytorByRemik/*.ini): a full palm record
  // with logic footprints + three per-state GfxFrames lines, and an animated wave record (loop
  // animation, no shadow lib). Records keep their 0-based position like extractPatterns.
  const lines: CifLine[] = [
    { level: 1, text: 'GfxLandscape' },
    { level: 2, text: 'EditName "palm 03"' },
    { level: 2, text: 'EditGroups "trees palm"' },
    { level: 2, text: 'LogicType 4' },
    { level: 2, text: 'LogicMaximumValency 3' },
    { level: 2, text: 'LogicIsWorkable 1' },
    { level: 2, text: 'LogicWalkBlockArea 3 0 0 1' },
    { level: 2, text: 'LogicBuildBlockArea 3 -1 -1 2' },
    { level: 2, text: 'LogicBuildBlockArea 3 -1 0 3' },
    { level: 2, text: 'LogicWorkArea 3 -1 -1 2' },
    {
      level: 2,
      text: 'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_trees.bmd" "data\\engine2d\\bin\\bobs\\ls_trees_s.bmd"',
    },
    { level: 2, text: 'GfxPalette "Tree03"' },
    { level: 2, text: 'GfxFrames 3 382 383' },
    { level: 2, text: 'GfxFrames 2 390 391' },
    { level: 2, text: 'GfxFrames 1 398 399' },
    { level: 2, text: 'GfxStatic 1' },
    { level: 2, text: 'GfxLoopAnimation 0' },
    { level: 2, text: 'GfxDynamicBackground 0' },
    { level: 1, text: 'GfxLandscape' },
    { level: 2, text: 'EditName "wave 02"' },
    { level: 2, text: 'EditGroups "misc_waves"' },
    { level: 2, text: 'LogicType 1' },
    { level: 2, text: 'LogicMaximumValency 1' },
    { level: 2, text: 'LogicIsWorkable 0' },
    { level: 2, text: 'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_water.bmd"' },
    { level: 2, text: 'GfxPalette "wave01"' },
    { level: 2, text: 'GfxFrames 1 130 131 132' },
    { level: 2, text: 'GfxStatic 0' },
    { level: 2, text: 'GfxLoopAnimation 1' },
    { level: 2, text: 'GfxDynamicBackground 1' },
  ];

  it('maps [GfxLandscape] to validated IR: positional index, logic footprints, per-state frames, animation flags', () => {
    const records = extractLandscapeGfx(cifLinesToSections(lines), {
      file: 'Data/engine2d/inis/landscapes/landscapes.cif',
      layer: 'base',
    });
    const src = {
      file: 'Data/engine2d/inis/landscapes/landscapes.cif',
      block: 'GfxLandscape',
      layer: 'base',
    };
    expect(records).toEqual([
      {
        index: 0,
        editName: 'palm 03',
        editGroups: ['trees palm'],
        logicType: 4,
        maxValency: 3,
        isWorkable: true,
        walkBlockAreas: [[3, 0, 0, 1]],
        buildBlockAreas: [
          [3, -1, -1, 2],
          [3, -1, 0, 3],
        ],
        workAreas: [[3, -1, -1, 2]],
        bmd: 'data/engine2d/bin/bobs/ls_trees.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/ls_trees_s.bmd',
        paletteName: 'tree03',
        frames: [
          { state: 3, bobIds: [382, 383] },
          { state: 2, bobIds: [390, 391] },
          { state: 1, bobIds: [398, 399] },
        ],
        isStatic: true,
        loopAnimation: false,
        dynamicBackground: false,
        source: src,
      },
      {
        index: 1,
        editName: 'wave 02',
        editGroups: ['misc_waves'],
        logicType: 1,
        maxValency: 1,
        isWorkable: false,
        walkBlockAreas: [],
        buildBlockAreas: [],
        workAreas: [],
        bmd: 'data/engine2d/bin/bobs/ls_water.bmd',
        shadowBmd: undefined,
        paletteName: 'wave01',
        frames: [{ state: 1, bobIds: [130, 131, 132] }],
        isStatic: false,
        loopAnimation: true,
        dynamicBackground: true,
        source: src,
      },
    ]);
  });

  it('keeps a bob-less record in its positional slot (unlike the atlas work-list extractor)', () => {
    const marker: CifLine[] = [
      { level: 1, text: 'GfxLandscape' },
      { level: 2, text: 'EditName "logic marker"' },
      { level: 2, text: 'LogicType 1' },
      { level: 1, text: 'GfxLandscape' },
      { level: 2, text: 'EditName "second"' },
      { level: 2, text: 'LogicType 1' },
    ];
    const records = extractLandscapeGfx(cifLinesToSections(marker), { file: 'f.cif' });
    expect(records.map((r) => [r.index, r.editName, r.bmd])).toEqual([
      [0, 'logic marker', undefined],
      [1, 'second', undefined],
    ]);
  });
});

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
