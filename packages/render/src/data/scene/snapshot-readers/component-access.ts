/**
 * The low-level, defensive component-access primitives every snapshot reader builds on: a settler's
 * position, and the "read one numeric field off a possibly-absent component" helpers. Split out of the
 * readers so the per-concern reader files (unit / static / stockpile / projectile) share ONE decode core.
 *
 * Shared contract: pure, TOTAL functions of a snapshot entity's plain-cloned `components` record. A
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
 * Read one NUMERIC field off a (possibly absent or malformed) snapshot component — `undefined` when the
 * component is missing or the field is not a number. The shared body behind the many single-field readers,
 * each of which is just this call plus its own name + JSDoc (the load-bearing part: what the field MEANS to
 * the renderer). Total + defensive like every reader here.
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

/**
 * Decode a snapshot `Stockpile.amounts` to its plain `[goodType, amount]` pairs — the shared, defensive
 * read behind both the scene's per-pile good pick ({@link import('./stockpile-readers.js').readStockpile})
 * and the HUD's tribe-wide stock sum ({@link import('../../hud.js').buildHud}). The snapshot clones the
 * `Stockpile.amounts` Map to an ascending-by-goodType `[goodType, amount]` array (see `inspect/snapshot.ts`),
 * so this returns that shape directly. Total: a missing/malformed stockpile reads as empty, and any
 * non-`[number, number]` entry is dropped; callers apply their own amount filtering (the pick skips `<= 0`,
 * the sum drops goods netting to zero).
 */
export function readStockpileAmounts(
  components: Readonly<Record<string, unknown>>,
): readonly [number, number][] {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return [];
  const out: [number, number][] = [];
  for (const pair of s.amounts) {
    if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') {
      out.push([pair[0], pair[1]]);
    }
  }
  return out;
}
