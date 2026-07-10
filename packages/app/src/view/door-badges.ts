import type { DoorBadge } from '@vinland/render';
import { type WorldSnapshot, nodeOfPosition, positionOfNode } from '@vinland/sim';
import { isBuilding, isSettler, num, positionOf } from '../game/snapshot.js';

/**
 * The DOOR-BADGE projection — turn the frozen snapshot into the per-building worker tally the render
 * {@link DoorBadge} layer draws beside each staffed building's door. It reads the SAME employment
 * binding the sim's JobSystem writes ({@link JobAssignment}.`workplace`), so a badge appears for every
 * worker bound to a building — whether the economy auto-assigned it or the player did (the
 * `assignWorker` command). Pure over the snapshot + the building-type door table (unit-tested); the
 * app calls it once per frame and hands the result to `renderer.update(...)`.
 *
 * Two passes over the entities (buildings and their workers can appear in any order): tally each
 * building's bound settlers, split carrier vs other, then project the door node of every building that
 * has a tally. The door node is the building's anchor node plus its type's `footprint.door` half-cell
 * offset ({@link interactionNode}'s app-side twin), converted back to a fixed-point `Position` the
 * render layer projects with the same iso math as the building sprite.
 */

/** The slice of a building TYPE this projection needs: its door offset (half-cell, from the placed
 *  anchor), if the type declares one. Absent → the badge anchors on the building's anchor node. */
export interface BuildingDoorInfo {
  readonly footprint?:
    | { readonly door?: { readonly dx: number; readonly dy: number } | undefined }
    | undefined;
}

export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  carrierJobType: number,
): DoorBadge[] {
  // Pass 1 — tally the settlers bound to each building, splitting carriers from other workers. A count
  // (addition commutes) so entity order doesn't matter; this is a view read, not a sim decision.
  const tally = new Map<number, { workers: number; carriers: number }>();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    const workplace = num(assignment?.workplace);
    if (workplace === undefined) continue; // an unemployed / unbound settler shows no building badge
    const settler = e.components.Settler as { jobType?: unknown } | undefined;
    const bucket = tally.get(workplace) ?? { workers: 0, carriers: 0 };
    if (num(settler?.jobType) === carrierJobType) bucket.carriers++;
    else bucket.workers++;
    tally.set(workplace, bucket);
  }
  if (tally.size === 0) return [];

  // Pass 2 — project the door node of every building that has bound workers.
  const out: DoorBadge[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    const counts = tally.get(e.id);
    if (counts === undefined) continue; // no workers here — no badge
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const anchor = nodeOfPosition(pos.x, pos.y);
    const building = e.components.Building as { buildingType?: unknown } | undefined;
    const typeId = num(building?.buildingType);
    const door = typeId !== undefined ? buildingsByType.get(typeId)?.footprint?.door : undefined;
    const node = door !== undefined ? { hx: anchor.hx + door.dx, hy: anchor.hy + door.dy } : anchor;
    const dpos = positionOfNode(node.hx, node.hy);
    out.push({ id: e.id, x: dpos.x, y: dpos.y, workers: counts.workers, carriers: counts.carriers });
  }
  return out;
}
