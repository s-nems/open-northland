import { ONE } from '@open-northland/sim';

/**
 * The defensive component-access primitives every snapshot reader builds on. Each is total: a missing
 * or malformed component reads as its absent value (`null`/`undefined`), never a throw, because the
 * scene must survive any snapshot shape.
 */

/**
 * The snapshot's `Position` component value as plain data (Fixed = a scaled integer), redeclared here
 * so `render` does not reach into sim internals for a 2-field shape.
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

/** Read one numeric field off a possibly absent or malformed component - `undefined` when the component
 *  is missing or the field is not a number. */
export function readNumField(
  components: Readonly<Record<string, unknown>>,
  component: string,
  field: string,
): number | undefined {
  const c = components[component] as Record<string, unknown> | undefined;
  const v = c?.[field];
  return typeof v === 'number' ? v : undefined;
}

/** {@link readNumField} for the readers whose absent value is `null`. */
export function readNumFieldOrNull(
  components: Readonly<Record<string, unknown>>,
  component: string,
  field: string,
): number | null {
  return readNumField(components, component, field) ?? null;
}

/** Whether the components wear a live pair of boots: a boots slot whose wear, the walk under way's when
 *  one is, has not reached ONE. */
export function readWearsLiveBoots(components: Readonly<Record<string, unknown>>): boolean {
  const boots = (components.Equipment as { boots?: { degreeOfUse?: unknown } | null } | undefined)?.boots;
  if (boots === undefined || boots === null) return false;
  const walked = readNumField(components, 'PathFollow', 'bootsDegree');
  const degree = walked ?? boots.degreeOfUse;
  return typeof degree === 'number' && degree < ONE;
}
