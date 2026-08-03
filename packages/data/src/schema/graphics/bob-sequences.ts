import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * One named animation run from `animations.ini`'s `[bobseq]` (`seq "<name>" <start> <length>`) - a
 * directional bob cycle whose facings lie back-to-back inside one bob set, so the per-direction stride
 * is `length / dirs` (8 facings for these sprites).
 */
export const BobSequence = z.strictObject({
  /** The exact `seq "<name>"` key, e.g. `human_man_generic_walk`. */
  name: z.string(),
  /** The run's first bob id (frame 0 of direction 0). */
  start: z.number().int().nonnegative(),
  /** Total frame count across every direction. */
  length: z.number().int().nonnegative(),
});
export type BobSequence = z.infer<typeof BobSequence>;

/**
 * The `[bobseq]` table for one bob set (`imagelib`) from `animations.ini`. A sequence joins to a decoded
 * atlas by the `imagelib` stem (`cr_hum_body_00.bmd` → the `cr_hum_body_00.<palette>` atlas), the same
 * id space the bob ids address.
 */
export const BobSequenceSet = z.strictObject({
  /** The bob set this table indexes, normalized to lower-case with forward slashes. */
  imagelib: z.string(),
  /** The matching `shadowlib` bob set, normalized, when the record names one. */
  shadowlib: z.string().optional(),
  /** Named sequences in file order. */
  sequences: z.array(BobSequence).default([]),
  source: Provenance.optional(),
});
export type BobSequenceSet = z.infer<typeof BobSequenceSet>;
