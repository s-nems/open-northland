/**
 * The low-level, defensive component-access primitives every snapshot reader builds on: a settler's
 * position, and the "read one numeric field off a possibly-absent component" helpers. Split out of the
 * readers so the per-concern reader files (unit / static / stockpile / projectile) share one decode core.
 *
 * Shared contract: pure, total functions of a snapshot entity's plain-cloned `components` record. A
 * missing or malformed component reads as its "absent" value (`null`/`undefined`), never a throw — the
 * scene must survive any snapshot shape. Nothing here re-enters the sim.
 */

/**
 * The snapshot's `Position` component value, as plain data (Fixed = a scaled integer). Mirrors the
 * sim component; redeclared here so `render` doesn't reach into sim internals for a 2-field shape.
 */
export interface PositionValue {
  x: number;
  y: number;
}

export function readPosition(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Position as PositionValue | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return p;
}

/**
 * Read one numeric field off a (possibly absent or malformed) snapshot component — `undefined` when the
 * component is missing or the field is not a number. The shared body behind the many single-field readers,
 * each of which is just this call plus its own name + JSDoc (the load-bearing part: what the field means to
 * the renderer).
 */
export function readNumField(
  components: Readonly<Record<string, unknown>>,
  component: string,
  field: string,
): number | undefined {
  const c = components[component] as Record<string, unknown> | undefined;
  const v = c?.[field];
  return typeof v === 'number' ? v : undefined;
}

/** {@link readNumField} for the readers whose contract is `number | null` (the atomic / projectile ids). */
export function readNumFieldOrNull(
  components: Readonly<Record<string, unknown>>,
  component: string,
  field: string,
): number | null {
  return readNumField(components, component, field) ?? null;
}
