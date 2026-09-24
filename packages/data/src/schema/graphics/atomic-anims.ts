import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

/**
 * One `[gfxanimatomic]` record from `mapmoveableanimations/animations.ini`, joining
 * `(logictribe, logicjob, logicatomicaction)` to the `gfxbobseqbody` `[bobseq]` it plays and the
 * per-direction frame lists that lay that animation out across the 8 facings.
 *
 * The explicit lists encode what a `[bobseq]`'s bare `start`/`length` cannot: authored holds and
 * repeats, frames shared between mirrored facings, and pools not divisible by 8 (`Sword_Attack` 102,
 * `spear_attack` 108), where a `start + facing*stride` slice is meaningless.
 */
export const GfxAnimAtomic = z.strictObject({
  /** `logictribe` - the `logicdefines.inc` `TRIBE_TYPE_*` id resolving against `TribeType.typeId`. The
   *  same `(job, action)` recurs per tribe with different frame lists, so consumers must filter by tribe. */
  tribe: TypeId,
  /** `logicjob` - the soldier/settler jobType whose atomic this animates (soldiers 31..41, civilist 6, woman 5). */
  job: TypeId,
  /** `logicatomicaction` - the atomic slot (81 = attack), the same id the sim's `setatomic` join keys. */
  action: AtomicId,
  /** The `gfxbobseqbody` `[bobseq]` name whose frame pool {@link dirFrames} indexes into. Absent on a
   *  record that names no sequence (the butterflies' swarm loops): its indices are then bob ids of the
   *  tribe's whole `jobgraphics` body set. */
  bodySeq: z.string().optional(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. */
  headSeq: z.string().optional(),
  /**
   * One `gfxanimframelistdir <dir> <idx…>` list per facing, placed at its `<dir>` slot so `dirFrames[d]`
   * is facing `d` regardless of file order. Entries are local indices into the {@link bodySeq} pool
   * (bob id = `bodySeq.start + idx`), or bob ids when the record names no sequence. A non-directional
   * `gfxanimframelist` record yields a single facing-locked list.
   */
  dirFrames: z.array(z.array(z.number().int().nonnegative())),
  /** `gfxanimmode` - `1` marks a body's looping base wait, `0` a one-shot motion. The body-less mode
   *  `2` records are the {@link GfxInHouseProgram} lane instead. */
  mode: z.number().int().nonnegative().optional(),
  /** `logicinhouseatomicsubid` - a sub-clip an in-house program plays by `(action, subId)`, never the
   *  action's own clip; absent on the plain records. */
  subId: z.number().int().positive().optional(),
  source: Provenance.optional(),
});
export type GfxAnimAtomic = z.infer<typeof GfxAnimAtomic>;
