import { describe, expect, it } from 'vitest';
import { resolveBuildingSignRefs } from '../src/content/building-signs.js';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir/rows.js';

/**
 * resolveBuildingSignRefs - the pure IR→sign-refs join: each player slot resolves its six `ls_temp`
 * sign records (worker disc, carrier pennant, three residence banners, construction stand) into one
 * served-stem + bob-per-kind ref, or `undefined` when any record is missing (the renderer then falls
 * back to slot 0's sheet or the placeholder squares).
 */

/** One synthetic `playerNN` sign record; the bob ids mirror the real sheet's (33/34/13/23/31/35). */
function rec(index: number, editName: string, palette: string, bobs: readonly number[]): LandscapeGfxRow {
  return {
    index,
    editName,
    logicType: 1,
    bmd: 'data/engine2d/bin/bobs/ls_temp.bmd',
    paletteName: palette,
    frames: [{ state: 1, bobIds: bobs }],
  };
}

/** The full six-record set of one player slot (1-based `NN`), as `landscapes.cif` authors it. */
function playerRecords(nn: number, base: number): LandscapeGfxRow[] {
  const p = `player${String(nn).padStart(2, '0')}`;
  const pal = `human_${p}`;
  return [
    rec(base, `${p} sign 01`, pal, [33]),
    rec(base + 1, `${p} sign 05`, pal, [34]),
    rec(base + 2, `${p} residence sign 01`, pal, [13, 12, 11]),
    rec(base + 3, `${p} residence sign 02`, pal, [23, 22, 21]),
    rec(base + 4, `${p} residence sign 03`, pal, [31, 30, 29]),
    rec(base + 5, `${p} construction sign`, pal, [35]),
  ];
}

const irOf = (landscapeGfx: readonly LandscapeGfxRow[]): ContentIr => ({ landscapeGfx });

describe('resolveBuildingSignRefs', () => {
  it('resolves a slot per shipped player: its served stem + the first bob of each record', () => {
    const ir = irOf([...playerRecords(1, 0), ...playerRecords(2, 10)]);
    const refs = resolveBuildingSignRefs(ir);

    expect(refs).toHaveLength(10);
    expect(refs[0]).toEqual({
      stem: 'ls_temp.human_player01',
      bobByKind: { worker: 33, carrier: 34, couple: 13, single: 23, family: 31, construction: 35 },
    });
    expect(refs[1]?.stem).toBe('ls_temp.human_player02');
    expect(refs[2]).toBeUndefined(); // player03 not authored in this fixture
  });

  it('leaves a slot undefined when any of its six records is missing, and handles a null IR', () => {
    const partial = playerRecords(1, 0).filter((r) => r.editName !== 'player01 residence sign 02');
    expect(resolveBuildingSignRefs(irOf(partial))[0]).toBeUndefined();
    expect(resolveBuildingSignRefs(null).every((slot) => slot === undefined)).toBe(true);
  });
});
