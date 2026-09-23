import { type DrawItem, resolveSettlerBobId } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { OPEN_CHEST_ATOMIC } from '../../src/catalog/atomics.js';
import { carryWalkSeqs, gfxAtomicProgramsByAction, sequencesFor } from '../../src/content/ir/joins.js';
import { BODY_IMAGELIB, type ContentIr } from '../../src/content/ir/rows.js';
import { CHARACTER_SPECS, carryAnimsByGood, characterBinding } from '../../src/content/settler-gfx/index.js';
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
  it('animates a wheat-carrying farmer while eating', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { real } = await loadContentUnderTest();
    const wheat = real.goods.find((good) => good.id === 'wheat');
    expect(wheat).toBeDefined();
    if (wheat === undefined) return;
    const binding = characterBinding(CHARACTER_SPECS.civilian, sequencesFor(ir, BODY_IMAGELIB), real.goods, {
      programsByAction: gfxAtomicProgramsByAction(ir, VIKING_ANIM_TRIBE),
      carrySeqBySlug: carryWalkSeqs(ir, VIKING_ANIM_TRIBE, CHARACTER_SPECS.civilian.logicJob),
    });
    expect(binding).not.toBeNull();
    if (binding === null) return;
    const item: DrawItem = {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state: 'acting',
      carrying: true,
      carryGood: wheat.typeId,
      atomicId: 10,
      facing: 0,
    };
    const frames = new Set(
      Array.from({ length: 50 }, (_, elapsed) =>
        resolveSettlerBobId(binding, { ...item, elapsed: elapsed + 1 }, 0),
      ),
    );
    expect(frames.size).toBeGreaterThan(1);
  });

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

  it('gives the soldier its empty walk for every good - a warrior never shows a load', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const carrySeqs = carryWalkSeqs(ir, VIKING_ANIM_TRIBE, CHARACTER_SPECS.warrior.logicJob);
    expect(carrySeqs.size).toBeGreaterThan(0);
    expect([...new Set(carrySeqs.values())]).toEqual(['human_man_warrior_empty_walk']);
  });
});

describe.runIf(hasRealIr())("the warrior chest bend is the source's own action-91 record", () => {
  it("names each warrior look's pick_up strip in a viking `[gfxanimatomic]` row for the chest", () => {
    const ir = rawIrUnderTest() as ContentIr;
    const chestPrograms = gfxAtomicProgramsByAction(ir, VIKING_ANIM_TRIBE).get(OPEN_CHEST_ATOMIC);
    for (const id of [
      'warrior',
      'warrior-spear',
      'warrior-sword',
      'warrior-broadsword',
      'warrior-shortbow',
      'warrior-longbow',
    ] as const) {
      const seq = CHARACTER_SPECS[id].atomics[OPEN_CHEST_ATOMIC].seq;
      expect(chestPrograms?.get(seq)?.dirFrames.length, `${id}: ${seq}`).toBeGreaterThan(0);
    }
  });
});
