import type { DoorBadge, HouseholdKind } from '@open-northland/render';
import { nodeOfPosition, positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import type { WorkerRole } from '../../game/sandbox/index.js';
import {
  buildingTypeOf,
  familiesByHome,
  type HomeFamily,
  isBuilding,
  isMakingLove,
  isSettler,
  positionOf,
  settlerJobType,
  workplaceOf,
} from '../../game/snapshot.js';
import { type DoorFootprint, workerIconNode } from './building-points.js';

/**
 * The door-badge projection turns the read-only snapshot into the per-building worker tally the render
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
  // Resident families per home — one door dot per family (see familiesByHome).
  const households = familiesByHome(snapshot);
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const workplace = workplaceOf(e);
    if (workplace === undefined) continue; // an unemployed / unbound settler shows no building badge
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue; // a bound settler with no job (shouldn't happen) — nothing to draw
    const bucket = tally.get(workplace) ?? { craftsmen: 0, carriers: 0, gatherers: 0 };
    const role = roleOf(jobType);
    if (role === 'carrier') bucket.carriers++;
    else if (role === 'gatherer') bucket.gatherers++;
    else bucket.craftsmen++;
    tally.set(workplace, bucket);
  }

  // Pass 2 — project the worker-icon anchor of every building with workers, residents, or hearts.
  const out: DoorBadge[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    const counts = tally.get(e.id);
    const families = households.get(e.id);
    const hearts = isMakingLove(e);
    if (counts === undefined && families === undefined && !hearts) continue; // nothing to draw here
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
      craftsmen: counts?.craftsmen ?? 0,
      carriers: counts?.carriers ?? 0,
      gatherers: counts?.gatherers ?? 0,
      ...(families !== undefined ? { households: families.map(householdKindOf) } : {}),
      ...(hearts ? { hearts } : {}),
    });
  }
  return out;
}

/** Classify one resident family into its door dot: parents raising a child read 'family', a childless
 *  pair 'couple', anyone alone (including an orphaned minor) 'single'. */
function householdKindOf(family: HomeFamily): HouseholdKind {
  if (family.adults > 0 && family.minors > 0) return 'family';
  if (family.adults >= 2) return 'couple';
  return 'single';
}
