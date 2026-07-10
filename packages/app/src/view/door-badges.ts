import type { DoorBadge } from '@vinland/render';
import { type WorldSnapshot, nodeOfPosition, positionOfNode } from '@vinland/sim';
import type { WorkerRole } from '../game/sandbox/index.js';
import { isBuilding, isSettler, num, positionOf } from '../game/snapshot.js';
import { type DoorFootprint, workerIconNode } from './building-points.js';

/**
 * The DOOR-BADGE projection — turn the frozen snapshot into the per-building worker tally the render
 * {@link DoorBadge} layer draws beside each staffed building's door. It reads the SAME employment
 * binding the sim's JobSystem writes ({@link JobAssignment}.`workplace`), so a badge appears for every
 * worker bound to a building — whether the economy auto-assigned it or the player did (the
 * `assignWorker` command). Pure over the snapshot + the building-type door table + a job-role classifier
 * (unit-tested); the app calls it once per frame and hands the result to `renderer.update(...)`.
 *
 * Two passes over the entities (buildings and their workers can appear in any order): tally each
 * building's bound settlers, split by worker ROLE (craftsman / carrier / gatherer, via `roleOf`), then
 * project the WORKER-ICON anchor of every building that has a tally: the door node (anchor +
 * `footprint.door`, {@link interactionNode}'s app-side twin) shifted one node right of the doorway —
 * or that building's committed override ({@link workerIconNode} over `catalog/building-tweaks.ts`), the
 * same point the `?debug=geometry` diagram marks with the blue dot — converted back to a fixed-point
 * `Position` the render layer projects with the same iso math as the building sprite.
 */

/** The slice of a building TYPE this projection needs: its door offset (half-cell, from the placed
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
    const building = e.components.Building as { buildingType?: unknown } | undefined;
    const typeId = num(building?.buildingType);
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
