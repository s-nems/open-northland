import type { FootprintCell } from '@open-northland/data';
import type { HalfCellNode } from '@open-northland/sim';
import { workerIconOffset } from '../catalog/building-tweaks.js';

/**
 * Per-building UI anchor points derived from the extracted footprint — the door node and the
 * worker-icon stack anchor next to it. Pure half-cell math (no sim, no DOM), unit-tested headless;
 * a consumer projects the node to world px with `halfCellToScreen` like any other lattice point.
 *
 * Source basis: the door is the extracted `LogicDoorPoint` (the cell a settler stands on entering —
 * `footprint.door`, the same offset the sim's `interactionNode` walks to; the committed per-building
 * door corrections are already applied upstream in `content/ir.ts`). The worker-icon anchor has NO
 * original counterpart — the original draws worker icons in the HUD, not at the building — so its
 * placement is our own approximation: one node right of the door by default, with per-building
 * overrides from the gallery review (`catalog/building-tweaks.ts`).
 */

/** The slice of a footprint these helpers read — structural, so a caller holding only a door-offset
 *  view (e.g. the door-badge projection's `BuildingDoorInfo`) can pass it without widening. */
export interface DoorFootprint {
  readonly door?: FootprintCell | undefined;
}

/**
 * The node settlers enter a building at: `anchor + footprint.door`, or the anchor itself when the
 * type carries no door — mirroring the sim's `interactionNode` fallback so a UI marker and the walk
 * target can never disagree on a doorless type.
 */
export function doorNode(footprint: DoorFootprint | undefined, anchor: HalfCellNode): HalfCellNode {
  const door = footprint?.door;
  if (door === undefined) return anchor;
  return { hx: anchor.hx + door.dx, hy: anchor.hy + door.dy };
}

/** The bottom anchor of the worker-icon stack: the door node shifted by the building's
 *  {@link workerIconOffset} (the default one-node-right, or its per-id override). */
export function workerIconNode(
  footprint: DoorFootprint | undefined,
  anchor: HalfCellNode,
  buildingId?: string,
): HalfCellNode {
  const door = doorNode(footprint, anchor);
  const offset = workerIconOffset(buildingId);
  return { hx: door.hx + offset.dx, hy: door.hy + offset.dy };
}
