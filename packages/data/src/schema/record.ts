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
