import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * One `[gfxwalkatomic]` record from `mapmoveableanimations/animations.ini` — the **loaded-gait** binding,
 * joining `(logictribe, logicjob, logicgoodtype)` to the `[bobseq]` a mover plays while hauling that good.
 * This is the original's own good → carry-look table (`logicgoodtype 12` → `human_man_generic_walk_potion`
 * = the honey pot), so the renderer picks a carry cycle from data instead of guessing by name.
 * Render-binding data (like {@link GfxAnimAtomic}); the pure sim ignores it.
 *
 * The join key is `(tribe, job, good)`, not the good alone: the same good binds a different body per job
 * (a cart good binds the whole `human_man_z00Trader_walk` body), which is also how a job with no authored
 * cycle for a good resolves. `goodType` 0 is the unloaded walk — the empty-handed gait for that job.
 *
 * The source record also carries `gfxwalkframelist <dir> <idx…>` per-facing frame lists, `gfxturnframelist`,
 * and `logicwalkspeed`. Those are deliberately not extracted: the human carry cycles are uniform ×8 strips
 * that `start + facing*stride` already lays out correctly, unlike the melee swings that forced
 * {@link GfxAnimAtomic.dirFrames}. Extract them when something needs a non-uniform walk (the animal gaits).
 */
export const GfxWalkAtomic = z.strictObject({
  /** `logictribe` — the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2, …). The same
   *  `(job, good)` recurs per tribe, so consumers must filter by tribe. */
  tribe: z.number().int().nonnegative(),
  /** `logicjob` — the jobType doing the hauling (civilist 6, woman 5, …); selects the body. */
  job: z.number().int().nonnegative(),
  /** `logicgoodtype` — the `goodtypes.ini` `type` id of the hauled good; `0` is the unloaded walk. */
  goodType: z.number().int().nonnegative(),
  /** The `gfxbobseqbody` `[bobseq]` name the loaded body plays. */
  bodySeq: z.string(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. Most carry
   *  cycles ship no head of their own and the head is drawn from the base walk instead. */
  headSeq: z.string().optional(),
  source: Provenance.optional(),
});
export type GfxWalkAtomic = z.infer<typeof GfxWalkAtomic>;
