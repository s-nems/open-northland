import { z } from 'zod';

/** Where an IR record came from in the original data — kept for auditability. */
export const Provenance = z.strictObject({
  file: z.string(),
  block: z.string().optional(),
  layer: z.enum(['base', 'mod']).default('base'),
});
export type Provenance = z.infer<typeof Provenance>;

/** Numeric type ids are the stable cross-reference used throughout the original data. */
export const TypeId = z.number().int().nonnegative();
