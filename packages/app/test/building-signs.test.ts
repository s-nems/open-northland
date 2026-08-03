import { describe, expect, it } from 'vitest';
import { resolveBuildingSignRefs } from '../src/content/building-signs.js';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir/rows.js';

/**
 * resolveBuildingSignRefs - the pure IR→sign-refs join: each player slot resolves its six `ls_temp`
 * sign records (worker disc, carrier pennant, three residence banners, construction stand) into one
 * served-stem + bob-per-kind ref, or `undefined` when any record is missing (the renderer then falls
 * back to slot 0's sheet or the placeholder squares). The garrison flag's five-record star ladder rides
 * along optionally: it degrades on its own without taking the slot's door badges with it.
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

/** One slot's garrison-flag ladder: `soldier 01`..`05`, each a wave loop (the real sheet authors eight
 *  frames from 36 up; three per loop is enough to prove the whole list is carried, not just its first). */
function soldierRecords(nn: number, base: number): LandscapeGfxRow[] {
  const p = `player${String(nn).padStart(2, '0')}`;
  return Array.from({ length: 5 }, (_, i) =>
    rec(base + i, `${p} soldier 0${i + 1}`, `human_${p}`, [36 + i * 8, 37 + i * 8, 38 + i * 8]),
  );
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

  it("resolves the garrison flag's whole star ladder, each record's full wave loop", () => {
    const refs = resolveBuildingSignRefs(irOf([...playerRecords(1, 0), ...soldierRecords(1, 10)]));

    expect(refs[0]?.garrisonBobs).toEqual([
      [36, 37, 38],
      [44, 45, 46],
      [52, 53, 54],
      [60, 61, 62],
      [68, 69, 70],
    ]);
  });

  it('drops the flag but keeps the slot when the star ladder is incomplete or off-sheet', () => {
    const ladder = soldierRecords(1, 10);
    const short = [...playerRecords(1, 0), ...ladder.filter((r) => r.editName !== 'player01 soldier 03')];
    // A gap would fly the wrong count (four men under three stars), so the flag degrades whole - but the
    // six door-badge kinds are untouched, which is why it is resolved apart from them.
    expect(resolveBuildingSignRefs(irOf(short))[0]?.garrisonBobs).toBeUndefined();
    expect(resolveBuildingSignRefs(irOf(short))[0]?.bobByKind.worker).toBe(33);

    const foreign = ladder.map((r) =>
      r.editName === 'player01 soldier 03' ? { ...r, paletteName: 'human_player07' } : r,
    );
    expect(
      resolveBuildingSignRefs(irOf([...playerRecords(1, 0), ...foreign]))[0]?.garrisonBobs,
    ).toBeUndefined();
  });

  it('leaves a slot undefined when any of its six records is missing, and handles a null IR', () => {
    const partial = playerRecords(1, 0).filter((r) => r.editName !== 'player01 residence sign 02');
    expect(resolveBuildingSignRefs(irOf(partial))[0]).toBeUndefined();
    expect(resolveBuildingSignRefs(null).every((slot) => slot === undefined)).toBe(true);
  });
});
