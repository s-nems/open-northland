import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * One named animation run from `animations.ini`'s `[bobseq]` (`seq "<name>" <start> <length>`) — a
 * directional bob cycle laid out as `dirs` facings back-to-back inside one bob set. The render builds
 * its `DirectionalAnim` from this: `start` is the run's first bob id, `length` the total frame count
 * across all directions (so the per-direction stride is `length / dirs`, `dirs` = 8 for these sprites).
 * The frame ids come from the source `[bobseq]` ranges, not renderer magic numbers.
 */
export const BobSequence = z.strictObject({
  /** The exact sequence name (`seq "<name>"`) — the resolvable key, e.g. `human_man_generic_walk`. */
  name: z.string(),
  /** The run's first bob id (frame 0 of direction 0). */
  start: z.number().int().nonnegative(),
  /** Total frame count across every direction (`= dirs * per-direction stride`). */
  length: z.number().int().nonnegative(),
});
export type BobSequence = z.infer<typeof BobSequence>;

/**
 * The `[bobseq]` table for one bob set (`imagelib`) from `animations.ini` — its `imagelib` `.bmd` plus
 * every named {@link BobSequence} that indexes into it. The renderer joins a sequence to a decoded atlas
 * by the `imagelib` stem (`cr_hum_body_00.bmd` → the `cr_hum_body_00.<palette>` atlas), the same id space
 * the bob ids address. Render-binding data (like {@link TerrainPattern}); the pure sim ignores it.
 */
export const BobSequenceSet = z.strictObject({
  /** The bob set this table indexes, normalized (lower-case, forward slashes), e.g. `cr_hum_body_00.bmd`. */
  imagelib: z.string(),
  /** The matching shadow bob set (`shadowlib`), normalized, when the record names one. */
  shadowlib: z.string().optional(),
  /** Named sequences in file order. */
  sequences: z.array(BobSequence).default([]),
  source: Provenance.optional(),
});
export type BobSequenceSet = z.infer<typeof BobSequenceSet>;
