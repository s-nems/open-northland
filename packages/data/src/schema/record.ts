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
 * Atomic ids are a numeric vocabulary cross-referenced by goods (`atomicFor*`), jobs
 * (`allowatomic`/`baseatomics`) and tribes (`setatomic`). The readable data ships NO master
 * atomictypes table — an atomic id's meaning is implicit in how those sources reference it
 * (e.g. the id under `atomicForHarvesting` is the harvest atomic for that good). The sim's
 * atomic planner consumes these bindings. See docs/ECS.md "Settler AI". Same numeric domain as
 * {@link TypeId} but a distinct vocabulary (not resolvable against any type table), so it is kept
 * a separately-named primitive rather than reusing `TypeId`.
 */
export const AtomicId = z.number().int().nonnegative();

/**
 * A coarse class id — a small enumerated category (weapon class, armour material tier, damage
 * class) that shares {@link TypeId}'s numeric domain but is not a cross-reference into any type
 * table. Named distinctly so a reader (and a would-be cross-ref check) does not mistake it for a
 * resolvable foreign key: e.g. a weapon's `munitionType 2` is "catapult ammo", not good id 2.
 */
export const ClassId = z.number().int().nonnegative();
