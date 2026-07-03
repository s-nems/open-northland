import { buildSpriteScene, resolveResourceDraw, resolveStockpileDraw } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import type { LandscapeGfxRow, RenderIr } from '../src/content/ir.js';
import {
  buildResourceBinding,
  buildStockpileBinding,
  resolveGatheringRefs,
} from '../src/content/resource-gfx.js';
import { gatheringScene } from '../src/scenes/gathering.js';
import { createSceneSim } from '../src/scenes/index.js';

/**
 * The headless half of the `?scene=gathering` acceptance scene (the browser half is the human's pixel
 * sign-off). Two render DATA facts an agent CAN self-verify: (a) the scene's world CLASSIFIES right — a
 * resource node carries its `goodType`, a held pile is a `stockpile` with good + fill, an empty pile is a
 * bare flag; and (b) the per-good binding RESOLVES each good to its OWN node/pile, not the shared yew.
 */

const scene = gatheringScene;
// The scene's gatherable goodTypes (see gathering.ts) — the sim runs these, keyed under scene-local ids.
const GOODS = { wood: 1, stone: 2, mud: 3, iron: 4, gold: 5, mushroom: 6 } as const;

describe('gathering scene — render classification (classify + collectSprites)', () => {
  const sim = createSceneSim(scene);
  sim.run(scene.runTicks);
  const draws = buildSpriteScene(sim.snapshot());

  it('draws one standing resource node per gatherable good, each carrying its goodType', () => {
    const nodes = draws.filter((d) => d.kind === 'resource');
    expect(nodes).toHaveLength(Object.keys(GOODS).length);
    expect(new Set(nodes.map((n) => n.goodType))).toEqual(new Set(Object.values(GOODS)));
    // A node has no fill amount (that is a pile's, for its heap frame).
    expect(nodes.every((n) => n.fill === undefined)).toBe(true);
  });

  it('draws each held ground pile as a stockpile carrying its good + fill amount', () => {
    const held = draws.filter((d) => d.kind === 'stockpile' && d.goodType !== undefined);
    // wood + stone piles, three fills each (see PILE_GOODS × PILE_FILLS).
    expect(held).toHaveLength(6);
    const woodFills = held.filter((d) => d.goodType === GOODS.wood).map((d) => d.fill);
    expect(new Set(woodFills)).toEqual(new Set([1, 3, 5])); // the heap grows small→full
  });

  it('draws the bare delivery flag as a stockpile with NO good (and no fill)', () => {
    const flags = draws.filter((d) => d.kind === 'stockpile' && d.goodType === undefined);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.fill).toBeUndefined();
  });
});

describe('gathering scene — per-good binding resolution (each good draws its OWN object)', () => {
  // A synthetic decoded IR mirroring the real join for the scene's goods (matched by id-slug). The scene
  // typeIds (1,2) differ from these pipeline goodTypes on purpose — the render binds by slug.
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
  ]);
  const resource = buildResourceBinding(refs, loaded);
  const stockpile = buildStockpileBinding(refs, loaded);

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
});
