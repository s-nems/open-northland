import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/**
 * One `[gfxwalkatomic]` record from `mapmoveableanimations/animations.ini` - the loaded-gait binding,
 * joining `(logictribe, logicjob, logicgoodtype)` to the `[bobseq]` a mover plays while hauling that
 * good. The key is the whole triple, not the good alone: the same good binds a different body per job.
 *
 * The record's `gfxwalkframelist`, `gfxturnframelist` and `logicwalkspeed` are not extracted, because
 * the human carry cycles are uniform ×8 strips that `start + facing*stride` already lays out correctly.
 */
export const GfxWalkAtomic = z.strictObject({
  /** `logictribe` - the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2). The same
   *  `(job, good)` recurs per tribe, so consumers must filter by tribe. */
  tribe: TypeId,
  /** `logicjob` - the jobType doing the hauling (civilist 6, woman 5); selects the body. */
  job: TypeId,
  /** `logicgoodtype` - the `goodtypes.ini` `type` id of the hauled good; `0` is the unloaded walk. */
  goodType: TypeId,
  /** The `gfxbobseqbody` `[bobseq]` name the loaded body plays. */
  bodySeq: z.string(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. */
  headSeq: z.string().optional(),
  source: Provenance.optional(),
});
export type GfxWalkAtomic = z.infer<typeof GfxWalkAtomic>;
