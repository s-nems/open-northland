import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * One `[gfxanimatomic]` record from `mapmoveableanimations/animations.ini` — the atomic-action → body
 * animation binding, joining `(logictribe, logicjob, logicatomicaction)` to the `gfxbobseqbody`
 * `[bobseq]` it plays and the explicit per-direction frame-index lists that lay that
 * animation out across the 8 facings. Render-binding data (like {@link BobSequenceSet}); the pure sim
 * ignores it.
 *
 * This is the directional layout a {@link BobSequence}'s bare `start`/`length` cannot encode: an action
 * animation is not a uniform `length / 8` strip. Each `gfxanimframelistdir <dir> <idx…>` line gives one
 * facing its own ordered list of local frame indices into the bodySeq pool (global bob id =
 * `bodySeq.start + idx`), and those lists differ per facing and carry authored holds/repeats inline (a
 * spear windup repeats its first frame five times, `[79,79,79,79,79,80,…]`) and reuse (mirror directions
 * share frames). A melee swing pool is not even divisible by 8 (`Sword_Attack` 102, `spear_attack` 108),
 * so a `start + facing*stride` slice is meaningless — playback must replay these lists verbatim.
 */
export const GfxAnimAtomic = z.strictObject({
  /** `logictribe` the record binds — the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2, …), not
   *  the tribetypes `logicType`. The same `(job, action)` recurs per tribe with different frame lists, so
   *  a consumer must filter by the right tribe (viking = 1) or it draws a plausible-but-wrong swing. */
  tribe: z.number().int().nonnegative(),
  /** `logicjob` — the soldier/settler jobType whose atomic this animates (soldiers 31..41, civilist 6, woman 5). */
  job: z.number().int().nonnegative(),
  /** `logicatomicaction` — the atomic slot (81 = attack, …), the same numeric id the sim's `setatomic` join keys. */
  action: z.number().int().nonnegative(),
  /** The `gfxbobseqbody` `[bobseq]` name whose frame pool the {@link dirFrames} index into. */
  bodySeq: z.string(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. Unread today (the
   *  render draws the head at the body's resolved bob id, the head atlas covering every body frame) —
   *  extracted for a future separate-head attack overlay. */
  headSeq: z.string().optional(),
  /**
   * Per-direction frame-index lists — one array per facing (`gfxanimframelistdir <dir> <idx…>` placed at
   * its `<dir>` slot, so `dirFrames[d]` is facing `d` regardless of file order), each a list of local
   * indices into the {@link bodySeq} pool. A non-directional record (`gfxanimframelist`) yields a single
   * list (length-1 outer array = facing-locked). Replayed verbatim — the authored holds/repeats are the
   * cadence.
   */
  dirFrames: z.array(z.array(z.number().int().nonnegative())),
  source: Provenance.optional(),
});
export type GfxAnimAtomic = z.infer<typeof GfxAnimAtomic>;
