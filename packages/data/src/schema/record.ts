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

/**
 * The atomic-action vocabulary, named by a readable master enum (`logicdefines.inc`
 * `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_*`, 0..92) that ships no matching record table — so an atomic id
 * resolves against nothing extracted. Same numeric domain as {@link TypeId}, kept a separate primitive
 * because it is not a foreign key. See docs/ECS.md "Settler AI".
 */
export const AtomicId = z.number().int().nonnegative();

/**
 * A coarse class id — a small enumerated category (weapon class, armour material tier, damage
 * class) that shares {@link TypeId}'s numeric domain but is not a cross-reference into any type
 * table. Named distinctly so a reader (and a would-be cross-ref check) does not mistake it for a
 * resolvable foreign key: e.g. a weapon's `munitionType 2` is "catapult ammo", not good id 2.
 */
export const ClassId = z.number().int().nonnegative();
