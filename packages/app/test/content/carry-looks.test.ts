import { describe, expect, it } from 'vitest';
import { BODY_IMAGELIB, type ContentIr, carryWalkSeqs, sequencesFor } from '../../src/content/ir.js';
import { CHARACTER_SPECS, carryAnimsByGood } from '../../src/content/settler-gfx/index.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Pins the loaded-gait join against the decoded content: every good the original's `[gfxwalkatomic]`
 * table gives the civilist a carry cycle for must resolve to a real ×8 cycle on its body. A break here
 * means haulers silently fall back to walking empty-handed (or, before the table was extracted, to the
 * wood log every unmatched good used to draw).
 */

/** The viking `logictribe` (`logicdefines.inc` TRIBE_TYPE_HUMAN_VIKING). */
const VIKING_ANIM_TRIBE = 1;

describe.runIf(hasRealIr())('the [gfxwalkatomic] carry table binds against decoded content', () => {
  it('resolves every good the civilist table names to a cycle on its body', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { real } = await loadContentUnderTest();
    const job = CHARACTER_SPECS.civilian.logicJob;

    const carrySeqs = carryWalkSeqs(ir, VIKING_ANIM_TRIBE, job);
    // The civilist is the body that hauls the economy; a table this small means the lane went missing.
    expect(carrySeqs.size, 'civilist carry records in ir.json gfxWalkAtomics').toBeGreaterThan(40);

    const table = carryAnimsByGood(sequencesFor(ir, BODY_IMAGELIB), carrySeqs, real.goods);
    const named = real.goods.filter((g) => carrySeqs.has(g.id));
    const unbound = named.filter((g) => table[g.typeId] === undefined).map((g) => g.id);
    expect(unbound, 'goods the walk table names but whose cycle does not resolve').toEqual([]);
  });

  it('binds honey to the potion cycle, not the wood log', async () => {
    // The reported bug: honey has no `walk_honey`, so the old name join fell through to the generic
    // loaded gait. The source binds it to the potion pot (`logicgoodtype 12`).
    const ir = rawIrUnderTest() as ContentIr;
    const carrySeqs = carryWalkSeqs(ir, VIKING_ANIM_TRIBE, CHARACTER_SPECS.civilian.logicJob);
    expect(carrySeqs.get('honey')).toBe('human_man_generic_walk_potion');
    expect(carrySeqs.get('wool')).toBe('human_man_generic_walk_flour');
  });

  it('gives the soldier its empty walk for every good — a warrior never shows a load', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const carrySeqs = carryWalkSeqs(ir, VIKING_ANIM_TRIBE, CHARACTER_SPECS.warrior.logicJob);
    expect(carrySeqs.size).toBeGreaterThan(0);
    expect([...new Set(carrySeqs.values())]).toEqual(['human_man_warrior_empty_walk']);
  });
});
