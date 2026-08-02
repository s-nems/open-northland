import type { DoorBadge, DoorBadgeRow, HouseholdKind } from '@open-northland/render';
import {
  entityById,
  type Fixed,
  nodeOfPosition,
  positionOfNode,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { WorkerRole } from '../../game/sandbox/index.js';
import {
  actorsOf,
  buildingTypeOf,
  familiesByHome,
  type HomeFamily,
  isAdult,
  isBuilding,
  isFemale,
  isMakingLove,
  isSettler,
  ownerPlayerOf,
  positionOf,
  settlerJobType,
  workplaceOf,
} from '../../game/snapshot.js';
import { type DoorFootprint, workerIconNode } from './building-points.js';

/**
 * The door-badge projection turns the read-only snapshot into the per-building sign rows the render
 * {@link DoorBadge} layer draws at each staffed building's sign post. It reads the same employment
 * binding the sim's JobSystem writes ({@link JobAssignment}.`workplace`), so a row appears for every
 * worker bound to a building, whether auto-assigned or player-assigned (the `assignWorker` command).
 * Pure over the snapshot + the building-type table + a job-role classifier (unit-tested); called once
 * per frame.
 *
 * This projection owns the stack order (bottom-to-top: resident families, worker discs, carrier
 * pennants on top) and each row's click-pick settler id, so drawing and picking share one row list.
 * The anchor is the building's `GfxFlagPoint` (the original's sign-post pixel offset from the sprite
 * anchor) when the content carries one; a type without it falls back to the derived worker-icon node
 * beside the door ({@link workerIconNode}).
 */

/** The slice of a building type this projection needs: its door offset (half-cell, from the placed
 *  anchor; absent → the stack anchors beside the building's anchor node), its stable `id` (the
 *  per-building worker-icon override key), and the extracted `GfxFlagPoint` when the content has one. */
export interface BuildingDoorInfo {
  readonly id?: string | undefined;
  readonly footprint?: DoorFootprint | undefined;
  readonly flagPoint?: { readonly x: number; readonly y: number } | undefined;
}

export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  roleOf: (jobType: number) => WorkerRole,
): DoorBadge[] {
  // Pass 1 - collect the settlers bound to each building, split by worker role. Entity order is
  // ascending id (the snapshot's actor order), so each bucket is deterministic; this is a view read,
  // not a sim decision.
  const tally = new Map<number, { craftsmen: number[]; carriers: number[]; gatherers: number[] }>();
  // Resident families per home - one banner row per family (see familiesByHome).
  const households = familiesByHome(snapshot);
  const actors = actorsOf(snapshot);
  for (const e of actors) {
    if (!isSettler(e)) continue;
    const workplace = workplaceOf(e);
    if (workplace === undefined) continue; // an unemployed / unbound settler shows no building badge
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue; // a bound settler with no job (shouldn't happen) - nothing to draw
    const bucket = tally.get(workplace) ?? { craftsmen: [], carriers: [], gatherers: [] };
    const role = roleOf(jobType);
    if (role === 'carrier') bucket.carriers.push(e.id);
    else if (role === 'gatherer') bucket.gatherers.push(e.id);
    else bucket.craftsmen.push(e.id);
    tally.set(workplace, bucket);
  }

  // Pass 2 - anchor + rows for every building with workers, residents, or hearts.
  const out: DoorBadge[] = [];
  for (const e of actors) {
    if (!isBuilding(e)) continue;
    const counts = tally.get(e.id);
    const families = households.get(e.id);
    const hearts = isMakingLove(e);
    if (counts === undefined && families === undefined && !hearts) continue; // nothing to draw here
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const typeId = buildingTypeOf(e);
    const info = typeId !== undefined ? buildingsByType.get(typeId) : undefined;
    const player = ownerPlayerOf(e);

    // Bottom-to-top: the home's family banners at the base, then the worker discs
    // (craftsmen + gatherers), then the carrier pennants always on top.
    const rows: DoorBadgeRow[] = [];
    for (const family of families ?? []) {
      const settler = selectableResident(snapshot, family);
      rows.push({ role: householdKindOf(family), ...(settler !== undefined ? { settler } : {}) });
    }
    for (const id of counts?.craftsmen ?? []) rows.push({ role: 'craftsman', settler: id });
    for (const id of counts?.gatherers ?? []) rows.push({ role: 'gatherer', settler: id });
    for (const id of counts?.carriers ?? []) rows.push({ role: 'carrier', settler: id });

    out.push({
      id: e.id,
      ...anchorOf(pos, info),
      ...(player !== undefined ? { player } : {}),
      rows,
      ...(hearts ? { hearts } : {}),
    });
  }
  return out;
}

/** The badge anchor: the building position + its `GfxFlagPoint` pixel offset when extracted, else the
 *  derived worker-icon node beside the door (the no-flag-point fallback). */
function anchorOf(
  pos: { readonly x: Fixed; readonly y: Fixed },
  info: BuildingDoorInfo | undefined,
): Pick<DoorBadge, 'x' | 'y' | 'dx' | 'dy'> {
  if (info?.flagPoint !== undefined) {
    return { x: pos.x, y: pos.y, dx: info.flagPoint.x, dy: info.flagPoint.y };
  }
  const anchor = nodeOfPosition(pos.x, pos.y);
  const node = workerIconNode(info?.footprint, anchor, info?.id);
  const dpos = positionOfNode(node.hx, node.hy);
  return { x: dpos.x, y: dpos.y };
}

/** Classify one resident family into its door banner: parents raising a child read 'family', a
 *  childless pair 'couple', anyone alone (including an orphaned minor) 'single'. */
function householdKindOf(family: HomeFamily): HouseholdKind {
  if (family.adults > 0 && family.minors > 0) return 'family';
  if (family.adults >= 2) return 'couple';
  return 'single';
}

/** The settler a click on this family's banner selects: the wife (the adult female) of a couple, else
 *  the lone resident (a single adult or an orphaned minor). */
function selectableResident(snapshot: WorldSnapshot, family: HomeFamily): number | undefined {
  if (family.adults >= 2) {
    for (const id of family.members) {
      const member = entityById(snapshot, id);
      if (member !== undefined && isAdult(member) && isFemale(member)) return id;
    }
  }
  return family.members[0];
}
