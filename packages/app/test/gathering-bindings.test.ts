import { resolveResourceDraw, resolveStockpileDraw } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir.js';
import {
  buildResourceBinding,
  buildStockpileBinding,
  buildStumpBinding,
  resolveGatheringRefs,
  resolveStumpRef,
} from '../src/content/resource-gfx/index.js';
import { GOOD_MUD, GOOD_STONE, GOOD_WOOD } from '../src/game/sandbox/index.js';
import { landscapeRow } from './support/landscape.js';

const GOODS = {
  wood: GOOD_WOOD,
  stone: GOOD_STONE,
  mud: GOOD_MUD,
} as const;

describe('gathering scene — per-good + stump binding resolution (each draws its OWN object)', () => {
  // A synthetic decoded IR mirroring the real join for the scene's goods (matched by id-slug) + the
  // dead-tree debris record. The scene typeIds differ from these pipeline goodTypes on purpose — the
  // render binds by slug (nodes/piles) or by a single default (the stump).
  const ir: ContentIr = {
    landscapeGfx: [
      landscapeRow(1, 4, 'tree_yew01', [{ state: 3, bobIds: [60] }], 'ls_trees'),
      landscapeRow(2, 15, 'rock03', [{ state: 4, bobIds: [10] }]),
      landscapeRow(
        3,
        7,
        'goods_wood',
        [
          { state: 1, bobIds: [0] },
          { state: 5, bobIds: [4] },
        ],
        'ls_goods',
      ),
      landscapeRow(4, 17, 'goods_stone', [{ state: 1, bobIds: [15] }], 'ls_goods'),
      landscapeRow(
        5,
        1,
        'human_player01',
        [{ state: 1, bobIds: [76] }],
        'ls_temp',
        'player01 work extern 01',
      ),
      landscapeRow(6, 1, 'tree01', [{ state: 1, bobIds: [338] }], 'ls_trees_dead', 'tree debris medium'),
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
        landscapeRow(
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
        landscapeRow(
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
