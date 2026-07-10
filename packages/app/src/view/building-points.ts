import type { BuildingFootprint, FootprintCell } from '@vinland/data';
import type { HalfCellNode } from '@vinland/sim';

/**
 * Per-building UI anchor points derived from the extracted footprint — the door node and the
 * worker-icon stack anchor next to it. Pure half-cell math (no sim, no DOM), unit-tested headless;
 * a consumer projects the node to world px with `halfCellToScreen` like any other lattice point.
 *
 * Source basis: the door is the extracted `LogicDoorPoint` (the cell a settler stands on entering —
 * `footprint.door`, the same offset the sim's `interactionNode` walks to). The worker-icon anchor has
 * NO original counterpart — the original draws worker icons in the HUD, not at the building — so its
 * placement is our own approximation: one node right of the door (icons stack upward from there),
 * adjustable in one place via {@link WORKER_ICON_DOOR_OFFSET}.
 */

/** Half-cell offset from the DOOR node to the worker-icon stack's bottom anchor: one node right
 *  (+1 hx = half a cell, ~34 px), same row — beside the door, clear of the entrance itself. */
export const WORKER_ICON_DOOR_OFFSET: FootprintCell = { dx: 1, dy: 0 };

/**
 * The node settlers enter a building at: `anchor + footprint.door`, or the anchor itself when the
 * type carries no door — mirroring the sim's `interactionNode` fallback so a UI marker and the walk
 * target can never disagree on a doorless type.
 */
export function doorNode(footprint: BuildingFootprint | undefined, anchor: HalfCellNode): HalfCellNode {
  const door = footprint?.door;
  if (door === undefined) return anchor;
  return { hx: anchor.hx + door.dx, hy: anchor.hy + door.dy };
}

/** The bottom anchor of the worker-icon stack: the door node shifted {@link WORKER_ICON_DOOR_OFFSET}. */
export function workerIconNode(footprint: BuildingFootprint | undefined, anchor: HalfCellNode): HalfCellNode {
  const door = doorNode(footprint, anchor);
  return { hx: door.hx + WORKER_ICON_DOOR_OFFSET.dx, hy: door.hy + WORKER_ICON_DOOR_OFFSET.dy };
}
