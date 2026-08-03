import { z } from 'zod';

/** Where an IR record came from in the original data - kept for auditability. */
export const Provenance = z.strictObject({
  file: z.string(),
  block: z.string().optional(),
  layer: z.enum(['base', 'mod']).default('base'),
});
export type Provenance = z.infer<typeof Provenance>;

/** Numeric type ids are the stable cross-reference used throughout the original data. */
export const TypeId = z.number().int().nonnegative();

/**
 * The atomic-action vocabulary, named by the `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_*`
 * enum (0..92), which ships no matching record table, so an atomic id is not a foreign key.
 */
export const AtomicId = z.number().int().nonnegative();

/**
 * A coarse category (weapon class, armour material tier, damage class) sharing {@link TypeId}'s
 * numeric domain but resolving into no type table: `munitionType 2` is "catapult ammo", not good 2.
 */
export const ClassId = z.number().int().nonnegative();
