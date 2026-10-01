import type { AtlasFrame, MapObjectSprite, SpriteLayer, TextureSource } from '@open-northland/render';
import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir/rows.js';

/**
 * The authored one-shot landscape stages over stub atlases: the falling clip a felled tree plays from its
 * record's `GfxTransition 11` target, and the placed falling records that play once and rest as their
 * `GfxTransition 13` target.
 */

const BODY_STEM = 'ls_trees.tree01';
const PILE_STEM = 'test_piles.goods_wood';
const WOOD = 5;
const WOOD_ID = 'wood';
/** Logic types as `landscapetypes.ini` numbers them; the code under test reads none of them. */
const TREE = 4;
const TREE_FALLING = 5;
const TRUNK = 6;
const MEADOW = 1;
const SKELETON_FALLING = 87;
const BONES = 81;

/** Record indices. */
const FIR = 10;
const DEAD_TREE = 11;
const FIR_FALLING = 20;
const DEAD_TREE_FALLING = 21;
const TRUNK_RECORD = 30;
const SKELETON = 40;
const SKELETON_BONES = 41;
const GRASS = 50;

/** Bob ids: 1..3 the fir's fall, 4..5 the skeleton's, 6 the bones, 7 the dead tree, 8..9 grass, 31..35
 *  the trunk's five fill states. */
const FALL_BOBS = [1, 2, 3];
const TRUNK_BOBS = [31, 32, 33, 34, 35];
const frameAt = (x: number): AtlasFrame => ({ x, y: 0, width: 4, height: 4, offsetX: 0, offsetY: 0 });
const FRAMES = new Map<number, AtlasFrame>(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, ...TRUNK_BOBS].map((bob) => [bob, frameAt(bob)]),
);

vi.mock('../src/content/ir/load.js', async () => {
  class MissingAtlasError extends Error {}
  return {
    MissingAtlasError,
    loadLayer: (stem: string): Promise<SpriteLayer> =>
      stem === BODY_STEM || stem === PILE_STEM
        ? Promise.resolve({ source: {} as TextureSource, atlas: { width: 64, height: 4, frames: FRAMES } })
        : Promise.reject(new MissingAtlasError(stem)),
  };
});

vi.resetModules();
const { loadFellingClips } = await import('../src/content/felling-clips.js');
const { loadMapObjects } = await import('../src/content/objects.js');
const { playsOnceThenRests } = await import('../src/content/ir/joins.js');
const { createFellingPresenter } = await import('../src/view/felling-presenter.js');

function record(
  index: number,
  editName: string,
  logicType: number,
  frames: readonly (readonly number[])[],
  extra: Partial<LandscapeGfxRow> = {},
): LandscapeGfxRow {
  return {
    index,
    editName,
    logicType,
    bmd: 'data/engine2d/bin/bobs/ls_trees.bmd',
    paletteName: 'tree01',
    frames: frames.map((bobIds, i) => ({ state: frames.length - i, bobIds })),
    ...extra,
  };
}

const IR: ContentIr = {
  landscapeGfx: [
    record(FIR, 'fir 01', TREE, [[9]], { cutTarget: FIR_FALLING, walkBlockAreas: [[1, 0, 0, 1]] }),
    record(DEAD_TREE, 'tree_dead 01', TREE, [[7]], { cutTarget: DEAD_TREE_FALLING }),
    record(FIR_FALLING, 'fir 01 falling', TREE_FALLING, [FALL_BOBS], {
      stageEndTarget: TRUNK_RECORD,
      walkBlockAreas: [[1, 0, 0, 1]],
    }),
    record(DEAD_TREE_FALLING, 'tree_dead falling', TREE_FALLING, [[7]], { stageEndTarget: TRUNK_RECORD }),
    record(
      TRUNK_RECORD,
      'tree trunk medium',
      TRUNK,
      [...TRUNK_BOBS].reverse().map((bob) => [bob]),
      { bmd: 'data/engine2d/bin/bobs/test_piles.bmd', paletteName: 'goods_wood', isStatic: true },
    ),
    record(SKELETON, 'skeleton_01', SKELETON_FALLING, [[4, 5]], { stageEndTarget: SKELETON_BONES }),
    record(SKELETON_BONES, 'cadaver human bones01', BONES, [[6]], { stageEndTarget: GRASS }),
    record(GRASS, 'grass 01', MEADOW, [[8, 9]], { loopAnimation: true }),
  ],
  gatheringPipeline: [
    { goodType: WOOD, goodId: WOOD_ID, harvest: { landscapeType: TREE, gfxIndices: [FIR, DEAD_TREE] } },
  ],
};

const GOODS = [{ id: WOOD_ID, typeId: WOOD }];
const entity = (id: number): Entity => id as Entity;

describe('the one-shot stage gate', () => {
  const byIndex = new Map((IR.landscapeGfx ?? []).map((row) => [row.index, row]));
  const gate = (index: number): boolean => {
    const row = byIndex.get(index);
    return row !== undefined && playsOnceThenRests(row);
  };

  it('plays a non-looping multi-frame stage that ends in another record', () => {
    expect(gate(FIR_FALLING)).toBe(true);
    expect(gate(SKELETON)).toBe(true);
  });

  it('leaves a one-frame stage, a loop and a record without a stage end alone', () => {
    expect(gate(SKELETON_BONES)).toBe(false);
    expect(gate(DEAD_TREE_FALLING)).toBe(false);
    expect(gate(GRASS)).toBe(false);
    expect(gate(FIR)).toBe(false);
  });
});

describe('loadFellingClips', () => {
  it("resolves a felled tree's clip from its record's cut target", async () => {
    const clips = await loadFellingClips(IR, GOODS);
    expect(clips.clipOf(FIR, WOOD)?.frames).toEqual(FALL_BOBS.map(frameAt));
    expect(clips.clipOf(FIR, WOOD)?.decor).toBe(false);
  });

  it("falls back to the good's representative record for a tree with no record of its own", async () => {
    const clips = await loadFellingClips(IR, GOODS);
    expect(clips.clipOf(undefined, WOOD)?.frames).toEqual(FALL_BOBS.map(frameAt));
  });

  it('plays nothing for a one-frame falling stage or an unknown record', async () => {
    const clips = await loadFellingClips(IR, GOODS);
    expect(clips.clipOf(DEAD_TREE, WOOD)).toBeUndefined();
    expect(clips.clipOf(TRUNK_RECORD, WOOD)).toBeUndefined();
  });
});

describe('the felling presenter', () => {
  const FELL_TICK = 100;
  const TRUNK_PILE = 900;
  const STUMP = 901;
  const felled: SimEvent = {
    kind: 'resourceFelled',
    node: entity(7),
    trunk: entity(TRUNK_PILE),
    stump: entity(STUMP),
    goodType: WOOD,
    amount: 5,
    at: { hx: 4, hy: 2 },
    gfxIndex: FIR,
  };

  it('plays the fall where the tree stood, then shows the trunk pile and stump the sim left', async () => {
    const added: MapObjectSprite[] = [];
    const withheld: ReadonlySet<number>[] = [];
    const present = createFellingPresenter(
      { addMapObjects: (objects) => added.push(...objects), setWithheldRefs: (refs) => withheld.push(refs) },
      await loadFellingClips(IR, GOODS),
    );
    present([felled], FELL_TICK);
    expect(added).toHaveLength(1);
    expect(added[0]?.frames).toEqual(FALL_BOBS.map(frameAt));
    expect(added[0]?.once).toEqual({ from: FELL_TICK, rest: null });
    expect([...(withheld.at(-1) ?? [])]).toEqual([TRUNK_PILE, STUMP]);
    // The clip's last frame still covers them; the next tick, the clip is gone and they show.
    present([], FELL_TICK + FALL_BOBS.length - 1);
    expect(withheld).toHaveLength(1);
    present([], FELL_TICK + FALL_BOBS.length);
    expect([...(withheld.at(-1) ?? [])]).toEqual([]);
  });

  it('holds nothing back for a tree with no clip', async () => {
    const withheld: ReadonlySet<number>[] = [];
    const present = createFellingPresenter(
      { addMapObjects: () => undefined, setWithheldRefs: (refs) => withheld.push(refs) },
      await loadFellingClips(IR, GOODS),
    );
    present([{ ...felled, gfxIndex: DEAD_TREE }], FELL_TICK);
    expect(withheld).toEqual([]);
  });
});

describe('placed one-shot stages', () => {
  const objects = {
    types: ['fir 01 falling', 'skeleton_01', 'cadaver human bones01'],
    // Node (2, 2) a falling tree authored at level 3, (4, 2) a skeleton, (6, 2) its bones.
    placements: [2, 2, 0, 4, 2, 1, 6, 2, 2],
    levels: [3, 1, 1],
  };

  it('play their whole clip from the map start, then rest as their stage-end record', async () => {
    const { sprites } = await loadMapObjects(objects, IR);
    const [tree, skeleton] = sprites;
    expect(tree?.frames).toEqual(FALL_BOBS.map(frameAt));
    expect(tree?.once?.from).toBe(0);
    // Level 3 of the trunk's five fill states, counted up from its lowest.
    expect(tree?.once?.rest?.frames).toEqual([frameAt(TRUNK_BOBS[2] ?? 0)]);
    expect(tree?.once?.rest).toMatchObject({ x: tree?.x, y: tree?.y, decor: true, groundPass: true });
    expect(skeleton?.frames).toHaveLength(2);
    expect(skeleton?.once?.rest?.frames).toEqual([frameAt(6)]);
  });

  it('leave a one-frame stage drawn as itself, never chaining on to its own stage end', async () => {
    const { sprites } = await loadMapObjects(objects, IR);
    const bones = sprites[2];
    expect(bones?.frames).toEqual([frameAt(6)]);
    expect(bones?.once).toBeUndefined();
  });
});
