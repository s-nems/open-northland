import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/**
 * One `[gfxwalkatomic]` record from `mapmoveableanimations/animations.ini` - the loaded-gait binding,
 * joining `(logictribe, logicjob, logicgoodtype)` to the `[bobseq]` a mover plays while hauling that
 * good. The key is the whole triple, not the good alone: the same good binds a different body per job.
 *
 * `gfxturnframelist` (the in-place turn transitions) is not extracted; nothing plays turns yet.
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
  /**
   * One `gfxwalkframelist <dir> <idx…>` list per facing, placed at its `<dir>` slot. Entries are local
   * indices into the {@link bodySeq} pool. Walk lists are contiguous runs, but not always full blocks:
   * some cycles play fewer frames than the pool's block stride holds, which a bare `start`/`length`
   * cannot encode.
   */
  dirFrames: z.array(z.array(z.number().int().nonnegative())).optional(),
  /** `logicwalkspeed` - the gait's authored speed rating, present only where a body authors several
   *  gaits (the cats' walk 8 vs running 5). No consumer yet; extracted with the record it scopes. */
  walkSpeed: z.number().int().positive().optional(),
  source: Provenance.optional(),
});
export type GfxWalkAtomic = z.infer<typeof GfxWalkAtomic>;
