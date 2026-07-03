import { buildSpriteScene, resolveResourceDraw, resolveStockpileDraw } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import type { LandscapeGfxRow, RenderIr } from '../src/content/ir.js';
import {
  buildResourceBinding,
  buildStockpileBinding,
  buildStumpBinding,
  resolveGatheringRefs,
  resolveStumpRef,
} from '../src/content/resource-gfx.js';
import { gatheringScene } from '../src/scenes/gathering.js';
import { createSceneSim } from '../src/scenes/index.js';

/**
 * The headless half of the `?scene=gathering` acceptance scene (the browser half is the human's pixel
 * sign-off). The scene now runs the FELLING CYCLE, so the render DATA an agent CAN self-verify is: after
 * the run the world classifies as the felled outcome — the static per-good nodes are `resource`s carrying
 * their goodType, each felled tree left a `stump` (carrying wood), and the delivered wood is a `stockpile`
 * (the flag heap) — plus that the per-good + stump bindings RESOLVE each good/stump to its OWN object.
 */

const scene = gatheringScene;
// The scene's goodTypes (see gathering.ts) — the sim runs these, keyed under scene-local ids.
const GOODS = { wood: 1, stone: 2, mud: 3, iron: 4, gold: 5, mushroom: 6 } as const;
const DISPLAY_GOODS = [GOODS.stone, GOODS.mud, GOODS.iron, GOODS.gold, GOODS.mushroom];
const TREES = 3;
const TREE_WOOD_YIELD = 3;

describe('gathering scene — render classification after the felling cycle', () => {
  const sim = createSceneSim(scene);
  sim.run(scene.runTicks);
  const draws = buildSpriteScene(sim.snapshot());

  it('the static per-good display nodes each classify as a resource carrying its goodType', () => {
    const nodes = draws.filter((d) => d.kind === 'resource');
    expect(nodes).toHaveLength(DISPLAY_GOODS.length);
    expect(new Set(nodes.map((n) => n.goodType))).toEqual(new Set(DISPLAY_GOODS));
    // A node has no fill amount (that is a pile's, for its heap frame).
    expect(nodes.every((n) => n.fill === undefined)).toBe(true);
  });

  it('every felled tree leaves a stump draw carrying its goodType (wood)', () => {
    const stumps = draws.filter((d) => d.kind === 'stump');
    expect(stumps).toHaveLength(TREES);
    expect(stumps.every((s) => s.goodType === GOODS.wood)).toBe(true);
  });

  it('the delivered wood piles at the collection flag (a stockpile carrying wood + its fill)', () => {
    // Once the trunks are collected and reaped, the only stockpile left is the flag with the whole yield.
    const piles = draws.filter((d) => d.kind === 'stockpile');
    expect(piles).toHaveLength(1);
    expect(piles[0]?.goodType).toBe(GOODS.wood);
    expect(piles[0]?.fill).toBe(TREES * TREE_WOOD_YIELD);
  });
});

describe('gathering scene — per-good + stump binding resolution (each draws its OWN object)', () => {
  // A synthetic decoded IR mirroring the real join for the scene's goods (matched by id-slug) + the
  // dead-tree debris record. The scene typeIds differ from these pipeline goodTypes on purpose — the
  // render binds by slug (nodes/piles) or by a single default (the stump).
  const B = 'data/engine2d/bin/bobs';
  const rec = (
    index: number,
    logicType: number,
    palette: string,
    frames: LandscapeGfxRow['frames'],
    bmd = 'ls_ground',
    editName?: string,
  ): LandscapeGfxRow => ({
    index,
    logicType,
    bmd: `${B}/${bmd}.bmd`,
    paletteName: palette,
    frames,
    ...(editName !== undefined ? { editName } : {}),
  });
  const ir: RenderIr = {
    landscapeGfx: [
      rec(1, 4, 'tree_yew01', [{ state: 3, bobIds: [60] }], 'ls_trees'),
      rec(2, 15, 'rock03', [{ state: 4, bobIds: [10] }]),
      rec(
        3,
        7,
        'goods_wood',
        [
          { state: 1, bobIds: [0] },
          { state: 5, bobIds: [4] },
        ],
        'ls_goods',
      ),
      rec(4, 17, 'goods_stone', [{ state: 1, bobIds: [15] }], 'ls_goods'),
      rec(5, 1, 'human_player01', [{ state: 1, bobIds: [76] }], 'ls_temp', 'player01 work extern 01'),
      rec(6, 1, 'tree01', [{ state: 1, bobIds: [338] }], 'ls_trees_dead', 'tree debris medium'),
    ],
    gatheringPipeline: [
      {
        goodType: 55,
        goodId: 'wood',
        harvest: { landscapeType: 4, gfxIndices: [1] },
        store: { landscapeType: 7, gfxIndices: [3] },
      },
      {
        goodType: 33,
        goodId: 'stone',
        harvest: { landscapeType: 15, gfxIndices: [2] },
        store: { landscapeType: 17, gfxIndices: [4] },
      },
    ],
  };
  const goods = [
    { typeId: GOODS.wood, id: 'wood' },
    { typeId: GOODS.stone, id: 'stone' },
  ];
  const refs = resolveGatheringRefs(goods, ir);
  const loaded = new Set([
    'ls_ground.rock03',
    'ls_goods.goods_wood',
    'ls_goods.goods_stone',
    'ls_temp.human_player01',
    'ls_trees_dead.tree01',
  ]);
  const resource = buildResourceBinding(refs, loaded);
  const stockpile = buildStockpileBinding(refs, loaded);
  const stump = buildStumpBinding(resolveStumpRef(ir), loaded);

  const node = (goodType: number) => ({ kind: 'resource' as const, ref: 1, x: 0, y: 0, depth: 0, goodType });
  const pile = (goodType: number, fill: number) => ({
    kind: 'stockpile' as const,
    ref: 1,
    x: 0,
    y: 0,
    depth: 0,
    goodType,
    fill,
  });

  it('resolves wood to the yew (default layer) and stone to its own rock family — not the same bob', () => {
    const wood = resolveResourceDraw(resource, node(GOODS.wood));
    const stone = resolveResourceDraw(resource, node(GOODS.stone));
    expect(wood).toEqual({ bob: 60 }); // bare — the default tree layer
    expect(stone).toEqual({ bob: 10, layer: 'ls_ground.rock03' }); // its own mine/rock atlas
    expect(wood).not.toEqual(stone); // the whole point: no longer all the yew
  });

  it('resolves each pile to its own goods atlas, growing with fill; an empty pile → the flag', () => {
    expect(resolveStockpileDraw(stockpile, pile(GOODS.wood, 1))).toEqual({
      layer: 'ls_goods.goods_wood',
      bob: 0,
    });
    expect(resolveStockpileDraw(stockpile, pile(GOODS.wood, 5))).toEqual({
      layer: 'ls_goods.goods_wood',
      bob: 4,
    });
    expect(resolveStockpileDraw(stockpile, pile(GOODS.stone, 1))).toEqual({
      layer: 'ls_goods.goods_stone',
      bob: 15,
    });
    // An empty pile (a flag) resolves to the ls_temp "work extern" flag, independent of any good.
    const flag = resolveStockpileDraw(stockpile, { kind: 'stockpile', ref: 1, x: 0, y: 0, depth: 0 });
    expect(flag).toEqual({ layer: 'ls_temp.human_player01', bob: 76 });
  });

  it('resolves a stump to the dead-tree debris frame (the same resolver a resource node uses)', () => {
    expect(stump).toBeDefined();
    // A stump reuses resolveResourceDraw; its single default draws the ls_trees_dead debris bob.
    const drawn = resolveResourceDraw(stump as NonNullable<typeof stump>, {
      kind: 'stump',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      goodType: GOODS.wood,
    });
    expect(drawn).toEqual({ layer: 'ls_trees_dead.tree01', bob: 338 });
  });

  it('drops the stump binding when the debris atlas did not load (falls back to the placeholder)', () => {
    expect(buildStumpBinding(resolveStumpRef(ir), new Set())).toBeUndefined();
  });
});
