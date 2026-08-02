import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import type { HalfCellNode } from '@open-northland/sim';
import { workerIconOffset } from '../../catalog/building-tweaks.js';

/**
 * Per-building UI anchor points derived from the extracted footprint - the door node and the
 * worker-icon stack anchor next to it. Pure half-cell math (no sim, no DOM), unit-tested headless;
 * a consumer projects the node to world px with `halfCellToScreen` like any other lattice point.
 *
 * Source basis: the door is the extracted `LogicDoorPoint` (the cell a settler stands on entering -
 * `footprint.door`, the same offset the sim's `interactionNode` walks to; the committed per-building
 * door corrections are already applied upstream in `content/ir/joins.ts`). The original's sign-post
 * anchor is the `[GfxHouse]` `GfxFlagPoint` pixel offset (the `buildingFlagPoints` IR lane), which the
 * badge projection prefers; the worker-icon node here is the approximation used only when a type has no
 * extracted flag point: one node right of the door by default, with per-building overrides from the
 * gallery review (`catalog/building-tweaks.ts`).
 */

/** The slice of a footprint these helpers read - structural, so a caller holding only a door-offset
 *  view (e.g. the door-badge projection's `BuildingDoorInfo`) can pass it without widening. */
export interface DoorFootprint {
  readonly door?: FootprintCell | undefined;
}

/**
 * The node settlers enter a building at: `anchor + footprint.door` (with the odd-row parity shift,
 * `footprintCellDx`), or the anchor itself when the type carries no door - mirroring the sim's
 * `interactionNode` so a UI marker and the walk target can never disagree.
 */
export function doorNode(footprint: DoorFootprint | undefined, anchor: HalfCellNode): HalfCellNode {
  const door = footprint?.door;
  if (door === undefined) return anchor;
  return { hx: anchor.hx + footprintCellDx(anchor.hy, door), hy: anchor.hy + door.dy };
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
