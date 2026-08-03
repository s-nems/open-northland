import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import type { HalfCellNode } from '@open-northland/sim';
import { workerIconOffset } from '../../catalog/building-tweaks.js';

/**
 * Per-building UI anchor points in half-cell space. The door is the extracted `LogicDoorPoint`; the
 * worker-icon node is an approximation used when a type has no extracted `GfxFlagPoint`: one node right
 * of the door, with per-building overrides.
 */

export interface DoorFootprint {
  readonly door?: FootprintCell | undefined;
}

/**
 * The node settlers enter a building at, mirroring the sim's `interactionNode` so a UI marker and the
 * walk target cannot disagree.
 */
export function doorNode(footprint: DoorFootprint | undefined, anchor: HalfCellNode): HalfCellNode {
  const door = footprint?.door;
  if (door === undefined) return anchor;
  return { hx: anchor.hx + footprintCellDx(anchor.hy, door), hy: anchor.hy + door.dy };
}

/** The bottom anchor of the worker-icon stack. */
export function workerIconNode(
  footprint: DoorFootprint | undefined,
  anchor: HalfCellNode,
  buildingId?: string,
): HalfCellNode {
  const door = doorNode(footprint, anchor);
  const offset = workerIconOffset(buildingId);
  return { hx: door.hx + offset.dx, hy: door.hy + offset.dy };
}
