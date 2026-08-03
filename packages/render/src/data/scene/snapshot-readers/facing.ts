import { ONE, tileToScreen } from '../../projection/index.js';
import { readPosition } from '../../snapshot/index.js';

/**
 * Settler facing: the 8 `CR_Hum_Body` direction blocks, quantized from a projected screen heading.
 * Projecting first is load-bearing - under the staggered raster the same grid step `(0,+1)` heads
 * screen down-right from an even row and down-left from an odd one.
 */

/**
 * Bob block per screen-heading octant, indexed by `round(atan2(dy, dx) / 45°) mod 8` (screen +x right,
 * +y down, so octant 0 = E). The sheet's blocks are not a uniform rotation - they face
 * `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` (source basis "Settler facing").
 */
const HEADING_OCTANT_TO_BLOCK: readonly number[] = [4, 5, 6, 0, 1, 2, 7, 3];

/** The S-facing block, the fallback for an out-of-table octant lookup. */
const DEFAULT_HEADING_BLOCK = 6;

/** The facing block whose sprite looks along a screen heading, given as a pixel delta. */
function facingFromScreenHeading(dx: number, dy: number): number {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return HEADING_OCTANT_TO_BLOCK[((octant % 8) + 8) % 8] ?? DEFAULT_HEADING_BLOCK;
}

/** One `PathFollow` waypoint as plain snapshot data (Fixed = scaled int), redeclared so `render` does
 *  not import the sim component shape for a 2-field read. */
interface WaypointValue {
  x: number;
  y: number;
}

/**
 * The facing block whose sprite looks from one tile toward another. Both coordinates are float tile
 * coordinates (the snapshot's Fixed position already divided by ONE); `undefined` when the two project
 * to the same screen point.
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
 * A settler's facing block (0..7) from its live heading - the projected step from its position toward
 * the `PathFollow` waypoint it walks to. `undefined` when there is no heading to read (no path, or
 * already standing on the waypoint), and the binding falls back to a default facing.
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
  if (dx === 0 && dy === 0) return undefined;
  return facingFromScreenHeading(dx, dy);
}
