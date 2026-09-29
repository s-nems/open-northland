import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

/** The distance a node with no road on the map reads, in columns: past any map's lattice extent, and
 *  as a Fixed still clear of int32 overflow when a step is added to it. */
export const NO_ROAD_DISTANCE: Fixed = fx.fromInt(2 ** 14);

/**
 * Fill `out` with each node's obstacle-free lattice distance to the nearest road node, in column units,
 * over a row-major `width` x `height` half-cell grid: the route heuristic's lattice metric, so a node's
 * value never exceeds its lattice distance to any road. Two raster passes (a chamfer transform) are
 * exact here: a cheapest lattice walk takes diagonals and straight steps of one heading each, so it
 * reorders into a forward-pass part (down, or rightward) followed by a backward-pass part (up, or
 * leftward). O(nodes), run once per road revision.
 */
export function fillRoadDistances(
  out: Int32Array,
  width: number,
  height: number,
  roads: Iterable<number>,
): void {
  out.fill(NO_ROAD_DISTANCE);
  let any = false;
  for (const node of roads) {
    out[node] = 0;
    any = true;
  }
  if (!any) return;
  // Forward pass: each node takes over from its W, N, NW-diagonal and NE-diagonal neighbours.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let best = out[i] ?? NO_ROAD_DISTANCE;
      if (x > 0) best = Math.min(best, (out[i - 1] ?? NO_ROAD_DISTANCE) + HALF_COLUMN);
      if (y > 0) best = Math.min(best, (out[i - width] ?? NO_ROAD_DISTANCE) + HALF_ROW);
      if (y > 1) {
        const up = i - 2 * width;
        if (x > 0) best = Math.min(best, (out[up - 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
        if (x < width - 1) best = Math.min(best, (out[up + 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
      }
      out[i] = best;
    }
  }
  // Backward pass: the mirror image, from the E, S and both lower diagonal neighbours.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let best = out[i] ?? NO_ROAD_DISTANCE;
      if (x < width - 1) best = Math.min(best, (out[i + 1] ?? NO_ROAD_DISTANCE) + HALF_COLUMN);
      if (y < height - 1) best = Math.min(best, (out[i + width] ?? NO_ROAD_DISTANCE) + HALF_ROW);
      if (y < height - 2) {
        const down = i + 2 * width;
        if (x > 0) best = Math.min(best, (out[down - 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
        if (x < width - 1) best = Math.min(best, (out[down + 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
      }
      out[i] = best;
    }
  }
}
