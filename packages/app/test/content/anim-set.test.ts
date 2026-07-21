import { describe, expect, it } from 'vitest';
import { BODY_IMAGELIB } from '../../src/content/ir/rows.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * The animation gallery's real-data half: the catalog of animations the gallery plays is the
 * extracted ir.json `bobSequences` for the viking civilian body — pinned here so a pipeline change
 * that drops the body's animations is caught, not discovered by a blank gallery. The gallery's pure
 * cell-builder tests live with the fixture suite (`test/anim-gallery.test.ts`).
 */

interface IrSeq {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}
interface Ir {
  readonly bobSequences?: readonly { imagelib: string; sequences?: IrSeq[] }[];
}

describe.runIf(hasRealIr())('viking civilian animation set (ir.json bobSequences)', () => {
  it(`${BODY_IMAGELIB} carries the animations the gallery showcases`, () => {
    const ir = rawIrUnderTest() as Ir;
    const set = ir.bobSequences?.find((s) => s.imagelib === BODY_IMAGELIB);
    expect(set, `${BODY_IMAGELIB} missing from ir.json bobSequences`).toBeDefined();
    const seqs = set?.sequences ?? [];
    const names = new Set(seqs.map((s) => s.name));
    // Anchors across the categories the gallery/idle work depends on: idle-loop, locomotion, a fight,
    // and a need action. If any of these vanish, the never-frozen idle or the "all animations" claim breaks.
    for (const anchor of ['human_man_generic_wait', 'human_man_generic_walk', 'human_man_generic_eat']) {
      expect(names.has(anchor), `expected sequence ${anchor}`).toBe(true);
    }
    expect(
      seqs.some((s) => /Fight|punch|kick/i.test(s.name)),
      'expected at least one unarmed fight sequence',
    ).toBe(true);
    // Every sequence is a real, non-empty frame range (start >= 0, length > 0) — the gallery indexes these.
    for (const s of seqs) {
      expect(s.start, s.name).toBeGreaterThanOrEqual(0);
      expect(s.length, s.name).toBeGreaterThan(0);
    }
    // The full civilian set is large (~69) — a sanity floor so a truncated extract is caught.
    expect(seqs.length).toBeGreaterThan(30);
  });
});
