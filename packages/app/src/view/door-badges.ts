import type { DoorBadge } from '@open-northland/render';
import { nodeOfPosition, positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import type { WorkerRole } from '../game/sandbox/index.js';
import { buildingTypeOf, isBuilding, isSettler, num, positionOf } from '../game/snapshot.js';
import { type DoorFootprint, workerIconNode } from './building-points.js';

/**
 * The door-badge projection — turn the frozen snapshot into the per-building worker tally the render
 * {@link DoorBadge} layer draws beside each staffed building's door. It reads the same employment binding
 * the sim's JobSystem writes ({@link JobAssignment}.`workplace`), so a badge appears for every worker bound
 * to a building, whether auto-assigned or player-assigned (the `assignWorker` command). Pure over the
 * snapshot + the building-type door table + a job-role classifier (unit-tested); called once per frame.
 *
 * The badge anchors at the worker-icon node — the door node (anchor + `footprint.door`) shifted one node
 * right of the doorway, or the building's committed override ({@link workerIconNode} over
 * `catalog/building-tweaks.ts`), the same point the `?debug=geometry` diagram marks — converted back to a
 * fixed-point `Position` the render layer projects with the same iso math as the building sprite.
 */

/** The slice of a building type this projection needs: its door offset (half-cell, from the placed
 *  anchor; absent → the stack anchors beside the building's anchor node) and its stable `id`, the
 *  per-building worker-icon override key. */
export interface BuildingDoorInfo {
  readonly id?: string | undefined;
  readonly footprint?: DoorFootprint | undefined;
}

export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  roleOf: (jobType: number) => WorkerRole,
): DoorBadge[] {
  // Pass 1 — tally the settlers bound to each building, split by worker role. A count (addition commutes)
  // so entity order doesn't matter; this is a view read, not a sim decision.
  const tally = new Map<number, { craftsmen: number; carriers: number; gatherers: number }>();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    const workplace = num(assignment?.workplace);
    if (workplace === undefined) continue; // an unemployed / unbound settler shows no building badge
    const settler = e.components.Settler as { jobType?: unknown } | undefined;
    const jobType = num(settler?.jobType);
    if (jobType === undefined) continue; // a bound settler with no job (shouldn't happen) — nothing to draw
    const bucket = tally.get(workplace) ?? { craftsmen: 0, carriers: 0, gatherers: 0 };
    const role = roleOf(jobType);
    if (role === 'carrier') bucket.carriers++;
    else if (role === 'gatherer') bucket.gatherers++;
    else bucket.craftsmen++;
    tally.set(workplace, bucket);
  }
  if (tally.size === 0) return [];

  // Pass 2 — project the worker-icon anchor of every building that has bound workers.
  const out: DoorBadge[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    const counts = tally.get(e.id);
    if (counts === undefined) continue; // no workers here — no badge
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const anchor = nodeOfPosition(pos.x, pos.y);
    const typeId = buildingTypeOf(e);
    const info = typeId !== undefined ? buildingsByType.get(typeId) : undefined;
    const node = workerIconNode(info?.footprint, anchor, info?.id);
    const dpos = positionOfNode(node.hx, node.hy);
    out.push({
      id: e.id,
      x: dpos.x,
      y: dpos.y,
      craftsmen: counts.craftsmen,
      carriers: counts.carriers,
      gatherers: counts.gatherers,
    });
  }
  return out;
}
