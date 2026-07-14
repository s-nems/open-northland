import { ONE, tileToScreen } from '../../iso.js';
import { readPosition } from './component-access.js';

/**
 * The settler facing geometry: turning a live heading (or a target tile) into one of the 8 direction
 * blocks the `CR_Hum_Body` sheet lays out. Pure projection math — kept apart from the component reads it
 * consumes, because facing is derived from the projected heading (the staggered raster), not a grid
 * delta's sign. No Pixi, render-only, never re-enters the sim.
 */

/**
 * The bob block index per screen-heading octant, indexed by `round(angle / 45°) mod 8` with the angle
 * from `Math.atan2(dy, dx)` (screen +x right, +y down): octant 0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W,
 * 5 = NW, 6 = N, 7 = NE. The `CR_Hum_Body` sheet's 8 direction blocks are not a uniform screen-angle
 * rotation — each was read off the decoded frames one by one (`source basis` "Settler facing";
 * blocks face `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`) — hence the lookup.
 */
const HEADING_OCTANT_TO_BLOCK: readonly number[] = [4, 5, 6, 0, 1, 2, 7, 3];

/** The S-facing block — the fallback for an (unreachable) out-of-table octant lookup. */
const DEFAULT_HEADING_BLOCK = 6;

/**
 * The facing block whose sprite looks along the given screen heading (px delta, +x right, +y down):
 * quantize the heading angle to the nearest of the 8 octants and look the block up. Facing is
 * derived from the projected heading, not the grid delta's sign — under the staggered raster the
 * same grid step `(0,+1)` heads screen down-right from an even row but down-left from an odd one
 * (a sign-pair table faces both as "south", the visible zigzag artifact; source basis "Settler facing").
 * Floats are fine — render-only, never re-enters the sim.
 */
function facingFromScreenHeading(dx: number, dy: number): number {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // -4..4, 0 = screen right
  return HEADING_OCTANT_TO_BLOCK[((octant % 8) + 8) % 8] ?? DEFAULT_HEADING_BLOCK;
}

/**
 * One {@link PathFollow} waypoint, as plain snapshot data (Fixed = scaled int). Redeclared here so
 * `render` doesn't import the sim component shape for a 2-field read.
 */
interface WaypointValue {
  x: number;
  y: number;
}

/**
 * The facing block whose sprite looks from one tile toward another — the combat-facing seam: an attacker
 * mid-swing has no {@link PathFollow} heading (it stopped to strike), so it faces its target by the
 * projected screen step between the two tiles (the same parity-correct projection {@link readFacing}
 * uses). Both coordinates are float tile coordinates (the snapshot's Fixed position already divided by
 * ONE). `undefined` when the two project to the same point (no heading — coincident/adjacent-rounded).
 */
export function facingTowardTile(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | undefined {
  const f = tileToScreen(from.x, from.y);
  const t = tileToScreen(to.x, to.y);
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  if (dx === 0 && dy === 0) return undefined;
  return facingFromScreenHeading(dx, dy);
}

/**
 * Derive a settler's facing direction index (0..7) from its live heading: the projected screen step
 * from its current position toward the {@link PathFollow} waypoint it is walking to, quantized to the
 * block whose sprite faces that heading ({@link facingFromScreenHeading}, which owns the parity-correct
 * projection). Returns `undefined` when there is no movement to read a heading from (no path, or already
 * on the waypoint) — the binding then falls back to a default facing.
 */
export function readFacing(components: Readonly<Record<string, unknown>>): number | undefined {
  const pf = components.PathFollow as { waypoints?: unknown; index?: unknown } | undefined;
  const pos = readPosition(components);
  if (pf === undefined || pos === null || !Array.isArray(pf.waypoints)) return undefined;
  const idx = typeof pf.index === 'number' ? pf.index : 0;
  const wp = pf.waypoints[idx] as WaypointValue | undefined;
  if (wp === undefined || typeof wp.x !== 'number' || typeof wp.y !== 'number') return undefined;
  const from = tileToScreen(pos.x / ONE, pos.y / ONE);
  const to = tileToScreen(wp.x / ONE, wp.y / ONE);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return undefined; // already there — no heading
  return facingFromScreenHeading(dx, dy);
}
