import { buildSpriteScene, resolveResourceDraw, resolveStockpileDraw } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { CLAY_DEPOSIT_UNITS } from '../src/catalog/mining.js';
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
 * sign-off). The scene runs the FELLING + MINING cycles, so the render DATA an agent CAN self-verify is:
 * after the run the world classifies as the settled outcome — the static per-good nodes are `resource`s
 * carrying their goodType, each felled tree left a `stump` (carrying wood), the mined deposit is GONE, and
 * the delivered wood/mud are two `stockpile` flag heaps — plus that the per-good + stump bindings RESOLVE
 * each good/stump to its OWN object (and a mined deposit steps its node frame down by level).
 */

const scene = gatheringScene;
// The scene's goodTypes (see gathering.ts) — the sim runs these, keyed under scene-local ids.
const GOODS = { wood: 1, stone: 2, mud: 3, iron: 4, gold: 5, mushroom: 6 } as const;
// mud is the ACTIVELY-mined deposit (removed by the end), NOT a static showcase node.
const DISPLAY_GOODS = [GOODS.stone, GOODS.iron, GOODS.gold, GOODS.mushroom];
const TREES = 3;
const TREE_WOOD_YIELD = 3;

describe('gathering scene — render classification after the felling + mining cycles', () => {
  const sim = createSceneSim(scene);
  sim.run(scene.runTicks);
  const draws = buildSpriteScene(sim.snapshot());

  it('the static per-good display nodes each classify as a resource carrying its goodType (mined deposit gone)', () => {
    const nodes = draws.filter((d) => d.kind === 'resource');
    expect(nodes).toHaveLength(DISPLAY_GOODS.length); // the mud deposit was chipped dry and removed
    expect(new Set(nodes.map((n) => n.goodType))).toEqual(new Set(DISPLAY_GOODS));
    // A static showcase node carries no level (it draws full); it has no fill amount (that is a pile's).
    expect(nodes.every((n) => n.fill === undefined && n.level === undefined)).toBe(true);
  });

  it('every felled tree leaves a stump draw carrying its goodType (wood)', () => {
    const stumps = draws.filter((d) => d.kind === 'stump');
    expect(stumps).toHaveLength(TREES);
    expect(stumps.every((s) => s.goodType === GOODS.wood)).toBe(true);
  });

  it('the delivered wood + mined mud each pile at their own flag (two stockpile heaps, by good)', () => {
    // Once every trunk + ore pile is collected and reaped, the only stockpiles left are the two flags.
    const piles = draws.filter((d) => d.kind === 'stockpile');
    expect(piles).toHaveLength(2);
    const byGood = new Map(piles.map((p) => [p.goodType, p.fill]));
    expect(byGood.get(GOODS.wood)).toBe(TREES * TREE_WOOD_YIELD); // the felling flag heap
    expect(byGood.get(GOODS.mud)).toBe(CLAY_DEPOSIT_UNITS); // the mining flag heap
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

  it('steps a mined deposit node down by level (empty→full); no level / over-range → the full frame', () => {
    // A clay mine record with 5 fill states, authored highest-first (state 5 full → state 1 dregs) — the
    // real ls_ground mine shape. buildResourceBinding orders them empty→full, resolveResourceDraw indexes
    // by the node's shrink-by-level fill.
    const mine: RenderIr = {
      landscapeGfx: [
        rec(
          10,
          12,
          'clay01',
          [
            { state: 5, bobIds: [64] },
            { state: 4, bobIds: [63] },
            { state: 3, bobIds: [62] },
            { state: 2, bobIds: [61] },
            { state: 1, bobIds: [60] },
          ],
          'ls_ground',
          'clay mine 01',
        ),
      ],
      gatheringPipeline: [{ goodType: 2, goodId: 'mud', harvest: { landscapeType: 12, gfxIndices: [10] } }],
    };
    const mineBinding = buildResourceBinding(
      resolveGatheringRefs([{ typeId: GOODS.mud, id: 'mud' }], mine),
      new Set(['ls_ground.clay01']),
    );
    const draw = (level?: number) =>
      resolveResourceDraw(mineBinding, {
        kind: 'resource',
        ref: 1,
        x: 0,
        y: 0,
        depth: 0,
        goodType: GOODS.mud,
        ...(level !== undefined ? { level } : {}),
      });
    expect(draw(5)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // full deposit
    expect(draw(3)).toEqual({ bob: 62, layer: 'ls_ground.clay01' }); // half-mined
    expect(draw(1)).toEqual({ bob: 60, layer: 'ls_ground.clay01' }); // the dregs
    expect(draw()).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // no level (a full/plain node) → full
    expect(draw(99)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // over-range clamps to full
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
