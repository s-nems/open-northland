import { describe, expect, it } from 'vitest';
import { resolveGoodIcons, resolveGoodNames } from '../src/stages/goods/index.js';

/**
 * The good→icon join rule ({@link resolveGoodIcons}): a good's store icon is the state-1 (smallest) bob of
 * the `[GfxLandscape]` "good pile" record whose `logicType` equals the good's `landscapeType`, recoloured
 * through that record's palette; its `fillFrames` are that record's per-state bobs ordered fewest→most (the
 * on-map heap grows through them). Exercised on hand-built fixtures so the join is pinned without game data.
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

  it('binds a good to its state-1 icon + all growth-state fillFrames (fewest→most) by landscapeType↔logicType', () => {
    const goods = [{ id: 'wood', landscapeType: 7 }];
    // States out of order + a larger pile first: the join must pick state 1 for the icon, and order the
    // fillFrames by ASCENDING state (fewest→most units), not by the file-first frame.
    const gfx = [
      pile(7, 'goods_wood', [
        [5, 84],
        [1, 40],
        [3, 82],
      ]),
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({
      wood: { frame: 40, palette: 'goods_wood', fillFrames: [40, 82, 84] },
    });
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

  it('falls back to a `goods all` item record for a good with no `good piles all` pile (potions/amulets)', () => {
    // A potion has only a `goods all` bottle record (no dedicated pile) — the fallback must recover it.
    const goods = [{ id: 'potion_heal_small', landscapeType: 71 }];
    const gfx = [
      pile(
        71,
        'goods_leather',
        [
          [1, 125],
          [3, 127],
          [5, 129],
        ],
        { editGroups: ['goods all'] },
      ),
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({
      potion_heal_small: { frame: 125, palette: 'goods_leather', fillFrames: [125, 127, 129] },
    });
  });

  it('prefers a `good piles all` pile over a `goods all` item at the same logicType (bound goods unmoved)', () => {
    const goods = [{ id: 'wood', landscapeType: 7 }];
    const gfx = [
      pile(7, 'goods_item', [[1, 200]], { editGroups: ['goods all'] }), // the broader item record
      pile(7, 'goods_wood', [[1, 40]], { editGroups: ['goods all', 'good piles all'] }), // the pile — wins
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({
      wood: { frame: 40, palette: 'goods_wood', fillFrames: [40] },
    });
  });

  it('ignores non-good-pile GfxLandscape records (editGroups gate) and keeps first-wins per logicType', () => {
    const goods = [{ id: 'stone', landscapeType: 17 }];
    const gfx = [
      pile(17, 'terrain_rock', [[1, 200]], { editGroups: ['landscape decor'] }), // not a good pile — skipped
      pile(17, 'goods_stone', [[1, 15]]), // the real good pile — wins
      pile(17, 'goods_stone_alt', [[1, 99]]), // same logicType, later — must NOT override
    ];
    expect(resolveGoodIcons(goods, gfx)).toEqual({
      stone: { frame: 15, palette: 'goods_stone', fillFrames: [15] },
    });
  });
});

/**
 * The localized good-name join ({@link resolveGoodNames}): per locale, a good's display name is its
 * `type`-keyed string-table entry, re-keyed onto the good's STRING id. A good absent from a locale's table
 * (or a locale with no table) simply gets no entry there — the app's fallback chain covers it.
 */
describe('resolveGoodNames', () => {
  const goods = [
    { id: 'wood', typeId: 5 },
    { id: 'fish', typeId: 22 },
    { id: 'sausage', typeId: 23 },
  ];

  it('re-keys each locale table from good `type` onto the good STRING id', () => {
    const names = resolveGoodNames(goods, {
      pl: { 5: 'Drewno', 22: 'Ryba', 23: 'Kiełbasa' },
      en: { 5: 'Wood', 22: 'Fish', 23: 'Sausage' },
    });
    expect(names).toEqual({
      pl: { wood: 'Drewno', fish: 'Ryba', sausage: 'Kiełbasa' },
      en: { wood: 'Wood', fish: 'Fish', sausage: 'Sausage' },
    });
  });

  it('omits a good the locale table lacks, and drops a locale that resolves to nothing', () => {
    const names = resolveGoodNames(goods, {
      pl: { 5: 'Drewno' }, // only wood
      unused: { 999: 'Unused' }, // no good has type 999 → the whole locale is dropped
    });
    expect(names).toEqual({ pl: { wood: 'Drewno' } });
  });
});
