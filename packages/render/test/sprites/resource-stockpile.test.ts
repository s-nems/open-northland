import { describe, expect, it } from 'vitest';
import {
  type DrawItem,
  resolveResourceDraw,
  resolveSpriteBobId,
  resolveStockpileDraw,
  resolveStockpileLayerDraws,
} from '../../src/index.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the per-good resource / stockpile resolvers — a node's species+level frame, a ground
 * pile's per-fill heap vs the delivery flag, and a freshly-felled trunk (grounddrop) via its own binding.
 */

describe('resolveResourceDraw — per-good resource node binding', () => {
  function resource(goodType?: number): DrawItem {
    return { ...drawItem('resource'), ...(goodType !== undefined ? { goodType } : {}) };
  }

  // Each good's per-level frame list (empty→full). Wood draws a bare bob from the default resource (tree)
  // layer; stone + iron draw from their own named `.bmd` families. A single-frame list is a non-mined node.
  const binding = {
    byGood: {
      5: [60],
      3: [{ layer: 'ls_ground.rock03', bob: 10 }],
      6: [{ layer: 'ls_ground.iron01', bob: 70 }],
    },
    default: 60,
  };

  it('draws a bare bob for a good bound to the default resource layer (the yew)', () => {
    expect(resolveResourceDraw(binding, resource(5))).toEqual({ bob: 60 });
  });

  it('draws a layer-qualified bob for a good in its own named family (the mine/rock atlas)', () => {
    expect(resolveResourceDraw(binding, resource(3))).toEqual({ bob: 10, layer: 'ls_ground.rock03' });
    expect(resolveResourceDraw(binding, resource(6))).toEqual({ bob: 70, layer: 'ls_ground.iron01' });
  });

  it('falls back to the default (yew) for an unmapped or good-less node', () => {
    expect(resolveResourceDraw(binding, resource(999))).toEqual({ bob: 60 });
    expect(resolveResourceDraw(binding, resource())).toEqual({ bob: 60 });
  });

  it('indexes a mined deposit by its level (empty→full); no level / over-range → the full frame', () => {
    // A 3-level deposit — the shrink-by-level frames run empty (index 0) → full (last).
    const deposit = {
      byGood: {
        3: [
          { layer: 'ls_ground.clay01', bob: 60 }, // level 1 — dregs
          { layer: 'ls_ground.clay01', bob: 62 }, // level 2
          { layer: 'ls_ground.clay01', bob: 64 }, // level 3 — full
        ],
      },
      default: 0,
    };
    const at = (level?: number) =>
      resolveResourceDraw(deposit, { ...resource(3), ...(level !== undefined ? { level } : {}) });
    expect(at(3)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // full
    expect(at(2)).toEqual({ bob: 62, layer: 'ls_ground.clay01' });
    expect(at(1)).toEqual({ bob: 60, layer: 'ls_ground.clay01' }); // dregs
    expect(at()).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // no level → full (a plain node)
    expect(at(99)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // over-range clamps to full
  });

  it('a plain-number binding is the same node bob for every good', () => {
    expect(resolveResourceDraw(42, resource(5))).toEqual({ bob: 42 });
    expect(resolveResourceDraw(42, resource())).toEqual({ bob: 42 });
  });

  it('RESCALES the level ladder onto a record with a different authored state count', () => {
    // The sim buckets every deposit into 5 catalog levels, but this record authors only 4 states
    // (the real "stones 01" rock). Full (5/5) must draw the fullest frame, dregs (1/5) the first.
    const rock = {
      byGood: { 3: [10, 11, 12, 13].map((bob) => ({ layer: 'ls_ground.rock03', bob })) },
      default: 0,
    };
    const at = (level: number, levels: number) =>
      resolveResourceDraw(rock, { ...resource(3), level, levels });
    expect(at(5, 5)).toEqual({ bob: 13, layer: 'ls_ground.rock03' }); // full → fullest authored frame
    expect(at(4, 5)).toEqual({ bob: 13, layer: 'ls_ground.rock03' }); // ceil(4·4/5) = 4
    expect(at(3, 5)).toEqual({ bob: 12, layer: 'ls_ground.rock03' });
    expect(at(1, 5)).toEqual({ bob: 10, layer: 'ls_ground.rock03' }); // dregs → first frame
    // A 5-state variant under the same 5-level ladder stays the identity mapping.
    const mine = { byGood: { 3: [20, 21, 22, 23, 24] }, default: 0 };
    expect(resolveResourceDraw(mine, { ...resource(3), level: 5, levels: 5 })).toEqual({ bob: 24 });
    expect(resolveResourceDraw(mine, { ...resource(3), level: 2, levels: 5 })).toEqual({ bob: 21 });
  });

  it('indexes a GROUND DROP by its fill (unit count) — one dug ore draws the single-piece frame', () => {
    // The trunk binding routes grounddrop items through this resolver; the ore pickup records author a
    // 5-state fewest→most ladder (state ≡ units), so fill 1 → first frame, a stacked drop grows.
    const ore = {
      byGood: { 4: [30, 31, 32, 33, 34].map((bob) => ({ layer: 'ls_goods.iron', bob })) },
      default: 0,
    };
    const drop = (fill?: number): DrawItem => ({
      ...drawItem('grounddrop'),
      goodType: 4,
      ...(fill !== undefined ? { fill } : {}),
    });
    expect(resolveResourceDraw(ore, drop(1))).toEqual({ bob: 30, layer: 'ls_goods.iron' }); // one unit
    expect(resolveResourceDraw(ore, drop(3))).toEqual({ bob: 32, layer: 'ls_goods.iron' });
    expect(resolveResourceDraw(ore, drop(99))).toEqual({ bob: 34, layer: 'ls_goods.iron' }); // clamps
    expect(resolveResourceDraw(ore, drop())).toEqual({ bob: 34, layer: 'ls_goods.iron' }); // no fill → full
  });
});

describe('resolveStockpileDraw — per-good ground piles + delivery flag', () => {
  function pile(goodType?: number, fill?: number): DrawItem {
    return {
      ...drawItem('stockpile'),
      ...(goodType !== undefined ? { goodType } : {}),
      ...(fill !== undefined ? { fill } : {}),
    };
  }

  // Wood pile: 5 fill frames (fewest→most) from the ls_goods.goods_wood atlas; the flag from ls_temp.
  const binding = {
    byGood: {
      5: [
        { layer: 'ls_goods.goods_wood', bob: 0 },
        { layer: 'ls_goods.goods_wood', bob: 1 },
        { layer: 'ls_goods.goods_wood', bob: 2 },
        { layer: 'ls_goods.goods_wood', bob: 3 },
        { layer: 'ls_goods.goods_wood', bob: 4 },
      ],
    },
    flag: { layer: 'ls_temp.human_player01', bob: 33 },
    default: 0,
  };

  it('draws the flag for an EMPTY pile (no dominant good)', () => {
    expect(resolveStockpileDraw(binding, pile())).toEqual({ bob: 33, layer: 'ls_temp.human_player01' });
  });

  it('indexes a held pile by its fill amount (1-based), clamped into the heap frames', () => {
    expect(resolveStockpileDraw(binding, pile(5, 1))).toEqual({ bob: 0, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5, 3))).toEqual({ bob: 2, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5, 5))).toEqual({ bob: 4, layer: 'ls_goods.goods_wood' });
    // Over-full clamps to the fullest frame; a missing fill defaults to the smallest heap.
    expect(resolveStockpileDraw(binding, pile(5, 99))).toEqual({ bob: 4, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5))).toEqual({ bob: 0, layer: 'ls_goods.goods_wood' });
  });

  it('falls back to the (bare placeholder) default for a held pile whose good has no frames', () => {
    expect(resolveStockpileDraw(binding, pile(999, 3))).toEqual({ bob: 0 });
  });

  it('draws a filled loose pile as its heap ALONE — no flag planted through the goods', () => {
    expect(resolveStockpileLayerDraws(binding, pile(5, 3))).toEqual([
      { bob: 2, layer: 'ls_goods.goods_wood' },
    ]);
  });

  it('draws an EMPTY pile as the flag marker alone (a designated collection point with nothing in it)', () => {
    expect(resolveStockpileLayerDraws(binding, pile())).toEqual([
      { bob: 33, layer: 'ls_temp.human_player01' },
    ]);
  });

  it('draws a delivery flag as the flag marker alone (it holds no goods — its heaps are separate entities)', () => {
    // A flag is a pure marker (no goodType): it resolves to the flag graphic. The goods it collects are
    // SEPARATE loose piles the scene depth-sorts a hair behind it (FLAG_PAINT_STEP), never layers of one draw.
    expect(resolveStockpileLayerDraws(binding, { ...pile(), isFlag: true })).toEqual([
      { bob: 33, layer: 'ls_temp.human_player01' },
    ]);
  });
});

describe('resolveSpriteBobId — grounddrop (freshly-felled trunk) via the trunk binding', () => {
  function drop(goodType?: number): DrawItem {
    return { ...drawItem('grounddrop'), ...(goodType !== undefined ? { goodType } : {}) };
  }
  const bindings = {
    settler: 10,
    building: 20,
    resource: 30,
    trunk: { byGood: { 5: [{ layer: 'ls_goods.goods_trunk', bob: 70 }] }, default: 99 },
  };

  it("draws the good's pickup-stage trunk from the `trunk` binding (its own kind, not resource/stockpile)", () => {
    expect(resolveSpriteBobId(drop(5), bindings)).toBe(70);
  });

  it('falls back to the trunk default for an unmapped good', () => {
    expect(resolveSpriteBobId(drop(999), bindings)).toBe(99);
  });

  it('is a placeholder (null) when no trunk binding is present (old sheets stay valid)', () => {
    expect(resolveSpriteBobId(drop(5), { settler: 10, building: 20, resource: 30 })).toBeNull();
  });
});
