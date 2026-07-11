import { buildSpriteScene, resolveResourceDraw, resolveStockpileDraw } from '@vinland/render';
import { systems } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  STONE_DEPOSIT_UNITS,
} from '../src/catalog/mining.js';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir.js';
import {
  buildResourceBinding,
  buildStockpileBinding,
  buildStumpBinding,
  resolveGatheringRefs,
  resolveStumpRef,
} from '../src/content/resource-gfx.js';
import {
  GATHERERS,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_STONE,
  GOOD_WOOD,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox.js';

/**
 * The headless half of the `?scene=sandbox` acceptance scene (the browser half is the human's pixel
 * sign-off). The global sandbox gathers EVERY raw good — one trade per good — so after the run every source node is
 * consumed (no `resource` draws), each felled tree left a `stump` (carrying wood), and each good piles onto the
 * GROUND around its delivery flag as capped `stockpile` heaps (≤ MAX_GROUND_STACK per tile, so a good with more
 * than a stack spills into several heaps). Plus that the per-good + stump bindings RESOLVE each good/stump to its
 * OWN object (and a mined deposit steps its node frame down by level).
 */

const scene = sandboxScene;
// The global sandbox goodTypes — the sim runs these everywhere, no scene-local ids.
const GOODS = {
  wood: GOOD_WOOD,
  stone: GOOD_STONE,
  mud: GOOD_MUD,
  iron: GOOD_IRON,
  gold: GOOD_GOLD,
  mushroom: GOOD_MUSHROOM,
} as const;
const WOOD_TREES = GATHERERS.find((g) => g.good === GOOD_WOOD)?.nodes ?? 0;
const MUSHROOM_NODES = GATHERERS.find((g) => g.good === GOOD_MUSHROOM)?.nodes ?? 0;
const TREE_WOOD_YIELD = WOOD_YIELD_PER_NODE;

describe('gathering scene — render classification after all six gathering cycles', () => {
  const sim = createSceneSim(scene);
  sim.run(scene.runTicks);
  const draws = buildSpriteScene(sim.snapshot());

  it('every source node is consumed by the end — no resource draws remain', () => {
    // Trees felled → stumps, deposits chipped dry → removed, mushrooms plucked → removed.
    expect(draws.filter((d) => d.kind === 'resource')).toHaveLength(0);
  });

  it('every felled tree leaves a stump draw carrying its goodType (wood)', () => {
    const stumps = draws.filter((d) => d.kind === 'stump');
    expect(stumps).toHaveLength(WOOD_TREES);
    expect(stumps.every((s) => s.goodType === GOODS.wood)).toBe(true);
  });

  it('each good piles onto CAPPED ground heaps around its gatherer flag (summing to the whole yield)', () => {
    // The flag itself is an empty MARKER (no goodType — excluded here); each good's harvest spreads onto loose
    // ground heaps beside it, each ≤ MAX_GROUND_STACK, so a good with more than a stack shows several heaps.
    const heaps = draws.filter((d) => d.kind === 'stockpile' && d.goodType !== undefined);
    const banked = new Map<number, number>();
    for (const h of heaps) {
      expect(h.fill ?? 0).toBeLessThanOrEqual(systems.MAX_GROUND_STACK); // every tile stays under the cap
      banked.set(h.goodType as number, (banked.get(h.goodType as number) ?? 0) + (h.fill ?? 0));
    }
    // Per good, the heaps SUM to the whole yield (goods conserved — the flag holds none of it).
    expect(banked.get(GOODS.wood)).toBe(WOOD_TREES * TREE_WOOD_YIELD);
    expect(banked.get(GOODS.stone)).toBe(STONE_DEPOSIT_UNITS);
    expect(banked.get(GOODS.mud)).toBe(CLAY_DEPOSIT_UNITS);
    expect(banked.get(GOODS.iron)).toBe(IRON_DEPOSIT_UNITS);
    expect(banked.get(GOODS.gold)).toBe(GOLD_DEPOSIT_UNITS);
    expect(banked.get(GOODS.mushroom)).toBe(MUSHROOM_NODES);
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
  const ir: ContentIr = {
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
    const mine: ContentIr = {
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

  it('marks a level whose bob its own atlas lacks INVISIBLE (the freshly-sown wheat sentinel)', () => {
    // The real `wheat mine 01` shape: states 2–5 are atlas frames, state 1 names bob 4000 — an
    // out-of-atlas sentinel the original uses for "draw nothing" (a freshly-sown, still-bare field).
    const wheat: ContentIr = {
      landscapeGfx: [
        rec(
          20,
          27,
          'wheat01',
          [
            { state: 5, bobIds: [7] },
            { state: 4, bobIds: [79] },
            { state: 3, bobIds: [15] },
            { state: 2, bobIds: [87] },
            { state: 1, bobIds: [4000] },
          ],
          'ls_meadows',
          'wheat mine 01',
        ),
      ],
      gatheringPipeline: [{ goodType: 9, goodId: 'wheat', harvest: { landscapeType: 27, gfxIndices: [20] } }],
    };
    const atlasFrames = new Map([['ls_meadows.wheat01', new Set([7, 79, 15, 87])]]); // no 4000
    const binding = buildResourceBinding(
      resolveGatheringRefs([{ typeId: 9, id: 'wheat' }], wheat),
      new Set(['ls_meadows.wheat01']),
      atlasFrames,
    );
    const draw = (level: number) =>
      resolveResourceDraw(binding, { kind: 'resource', ref: 1, x: 0, y: 0, depth: 0, goodType: 9, level });
    expect(draw(1)).toBeNull(); // the sown-but-bare stage draws NOTHING (never the green placeholder)
    expect(draw(2)).toEqual({ bob: 87, layer: 'ls_meadows.wheat01' }); // sprouts from stage 2
    expect(draw(5)).toEqual({ bob: 7, layer: 'ls_meadows.wheat01' }); // the ripe stand

    // A record whose levels are ALL missing keeps its refs — a genuinely broken binding must surface
    // as the placeholder, not silently vanish.
    const broken = buildResourceBinding(
      resolveGatheringRefs([{ typeId: 9, id: 'wheat' }], wheat),
      new Set(['ls_meadows.wheat01']),
      new Map([['ls_meadows.wheat01', new Set<number>()]]),
    );
    expect(
      resolveResourceDraw(broken, { kind: 'resource', ref: 1, x: 0, y: 0, depth: 0, goodType: 9, level: 1 }),
    ).toEqual({ bob: 4000, layer: 'ls_meadows.wheat01' });
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
