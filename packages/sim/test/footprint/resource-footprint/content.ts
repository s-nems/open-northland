import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';

export const GRASS = 0;
export const WATER = 1;
export const VIKING = 1;
export const WOOD = 1;
export const STONE = 4;
export const MUSHROOM = 5;
export const CLAY = 6;
export const WOODCUTTER = 1;
export const CLAY_DIGGER = 2;
export const WOOD_ATOMIC = 24;
export const STONE_ATOMIC = 25;
export const MUSHROOM_ATOMIC = 32;
export const CLAY_ATOMIC = 26;
export const TREE_LOGIC = 100;
export const STONE_LOGIC = 101;
export const MUSHROOM_LOGIC = 102;
export const CLAY_LOGIC = 103;
export const TREE_GFX = 10;
export const STONE_GFX = 11;
export const MUSHROOM_GFX = 12;
export const CLAY_GFX = 13;
export const STONE_VARIANT_GFX = 14;
export const TEST_HUT = 99;

export const HUT_FOOTPRINT = {
  blocked: [{ dx: 0, dy: 0 }],
  familyBody: [{ dx: 0, dy: 0 }],
  reserved: [{ dx: 0, dy: 0 }],
  door: { dx: 0, dy: 1 },
};

export function content(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'synthetic-resource-footprint-test' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      {
        typeId: WOOD,
        id: 'wood',
        weight: 1,
        atomics: { harvest: WOOD_ATOMIC },
        gathering: { bioLandscape: true },
      },
      {
        typeId: STONE,
        id: 'stone',
        weight: 1,
        atomics: { harvest: STONE_ATOMIC },
        gathering: { bioLandscape: false },
      },
      {
        typeId: MUSHROOM,
        id: 'mushroom',
        weight: 1,
        atomics: { harvest: MUSHROOM_ATOMIC },
        gathering: { bioLandscape: true },
      },
      {
        typeId: CLAY,
        id: 'mud',
        weight: 1,
        atomics: { harvest: CLAY_ATOMIC },
        gathering: { bioLandscape: false },
      },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [WOOD_ATOMIC] },
      { typeId: CLAY_DIGGER, id: 'clay_digger', allowedAtomics: [CLAY_ATOMIC] },
    ],
    buildings: [{ typeId: TEST_HUT, id: 'test_hut', kind: 'house', footprint: HUT_FOOTPRINT }],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
      { typeId: TREE_LOGIC, id: 'tree_logic', walkable: true, buildable: true },
      { typeId: STONE_LOGIC, id: 'stone_logic', walkable: true, buildable: true },
      { typeId: MUSHROOM_LOGIC, id: 'mushroom_logic', walkable: true, buildable: true },
      { typeId: CLAY_LOGIC, id: 'clay_logic', walkable: true, buildable: true },
    ],
    landscapeGfx: [
      {
        index: TREE_GFX,
        editName: 'test tree',
        logicType: TREE_LOGIC,
        maxValency: 3,
        isWorkable: true,
        walkBlockAreas: [
          [1, 9, 9, 1],
          [3, 0, 0, 1],
        ],
        buildBlockAreas: [
          [1, 9, 9, 1],
          [3, -1, 0, 1],
          [3, 0, 0, 1],
          [3, 1, 0, 1],
        ],
        workAreas: [
          [3, -1, 0, 1],
          [3, 1, 0, 1],
        ],
      },
      {
        index: STONE_GFX,
        editName: 'test stone',
        logicType: STONE_LOGIC,
        maxValency: 4,
        isWorkable: true,
        walkBlockAreas: [[4, -1, 0, 3]],
        buildBlockAreas: [
          [4, -1, 0, 1],
          [4, 0, 0, 1],
          [4, 1, 0, 1],
        ],
        workAreas: [
          [4, -1, 0, 1],
          [4, 1, 0, 1],
        ],
      },
      {
        index: STONE_VARIANT_GFX,
        editName: 'test stone variant',
        logicType: STONE_LOGIC,
        maxValency: 4,
        isWorkable: true,
        walkBlockAreas: [[4, 2, 0, 1]],
        buildBlockAreas: [[4, 2, 0, 1]],
        workAreas: [[4, 2, 0, 1]],
      },
      {
        index: MUSHROOM_GFX,
        editName: 'test mushroom',
        logicType: MUSHROOM_LOGIC,
        maxValency: 1,
        isWorkable: true,
        walkBlockAreas: [],
        buildBlockAreas: [],
        workAreas: [[1, 0, 0, 1]],
      },
      {
        index: CLAY_GFX,
        editName: 'test clay',
        logicType: CLAY_LOGIC,
        maxValency: 2,
        isWorkable: true,
        walkBlockAreas: [],
        buildBlockAreas: [],
        workAreas: [
          [2, -1, 0, 1],
          [2, 0, 0, 1],
          [2, 1, 0, 1],
        ],
      },
    ],
    gatheringPipeline: [
      { goodType: WOOD, goodId: 'wood', harvest: { landscapeType: TREE_LOGIC, gfxIndices: [TREE_GFX] } },
      {
        goodType: STONE,
        goodId: 'stone',
        harvest: { landscapeType: STONE_LOGIC, gfxIndices: [STONE_GFX, STONE_VARIANT_GFX] },
      },
      {
        goodType: MUSHROOM,
        goodId: 'mushroom',
        harvest: { landscapeType: MUSHROOM_LOGIC, gfxIndices: [MUSHROOM_GFX] },
      },
      { goodType: CLAY, goodId: 'mud', harvest: { landscapeType: CLAY_LOGIC, gfxIndices: [CLAY_GFX] } },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: WOODCUTTER, atomicId: WOOD_ATOMIC, animation: 'viking_chop' },
          { jobType: CLAY_DIGGER, atomicId: CLAY_ATOMIC, animation: 'viking_dig' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: 3 },
      { id: 'viking_dig', name: 'viking_dig', length: 3 },
    ],
  });
}
