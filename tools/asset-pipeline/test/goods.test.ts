import { describe, expect, it } from 'vitest';
import { resolveGoodIcons } from '../src/stages/goods.js';

/**
 * The good→icon join rule ({@link resolveGoodIcons}): a good's store icon is the state-1 (smallest) bob of
 * the `[GfxLandscape]` "good pile" record whose `logicType` equals the good's `landscapeType`, recoloured
 * through that record's palette. Exercised on hand-built fixtures so the join is pinned without the game data.
 */
describe('resolveGoodIcons', () => {
  const pile = (
    logicType: number,
    paletteName: string,
    states: readonly [state: number, bob: number][],
    overrides: { editGroups?: string[]; bmd?: string } = {},
  ) => ({
    logicType,
    editGroups: overrides.editGroups ?? ['goods all', 'good piles all'],
    bmd: overrides.bmd ?? 'data/engine2d/bin/bobs/ls_goods.bmd',
    paletteName,
    frames: states.map(([state, bob]) => ({ state, bobIds: [bob] })),
  });

  it('binds a good to its state-1 pile bob + palette by landscapeType↔logicType', () => {
    const goods = [{ id: 'wood', landscapeType: 7 }];
    // States out of order + a larger pile first: the join must pick state 1, not the file-first frame.
    const gfx = [
      pile(7, 'goods_wood', [
        [5, 84],
        [1, 40],
        [3, 82],
      ]),
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({ wood: { frame: 40, palette: 'goods_wood' } });
  });

  it('omits goods with no landscapeType, no matching pile, or a non-ls_goods record', () => {
    const goods = [
      { id: 'plank' }, // produced good — no landscapeType
      { id: 'orphan', landscapeType: 99 }, // no pile record for logicType 99
      { id: 'tree', landscapeType: 7 }, // pile record exists but cites a different bmd
    ];
    const gfx = [pile(7, 'goods_wood', [[1, 40]], { bmd: 'data/engine2d/bin/bobs/ls_trees.bmd' })];
    expect(resolveGoodIcons(goods, gfx)).toEqual({});
  });

  it('ignores non-good-pile GfxLandscape records (editGroups gate) and keeps first-wins per logicType', () => {
    const goods = [{ id: 'stone', landscapeType: 17 }];
    const gfx = [
      pile(17, 'terrain_rock', [[1, 200]], { editGroups: ['landscape decor'] }), // not a good pile — skipped
      pile(17, 'goods_stone', [[1, 15]]), // the real good pile — wins
      pile(17, 'goods_stone_alt', [[1, 99]]), // same logicType, later — must NOT override
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({ stone: { frame: 15, palette: 'goods_stone' } });
  });
});
