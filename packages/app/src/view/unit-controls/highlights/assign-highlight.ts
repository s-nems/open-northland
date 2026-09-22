import type { BuildingHighlightItem } from '@open-northland/render';
import { type Entity, entityById, type GroupWorker, type WorldSnapshot } from '@open-northland/sim';
import { canonicalJobType } from '../../../game/sandbox/ids/index.js';
import {
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  isSettler,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  settlerTribeOf,
  workplaceOf,
} from '../../../game/snapshot.js';

/**
 * The pure snapshot projection behind the assign-a-workplace button and its green or red building tint.
 * The button places the settler's current profession and never re-trades them, so a building greens when
 * one worker slot matches that trade canonically and still has room. The sim keeps enforcing its own XP
 * gate on the `assignWorker` command.
 */

/** The slice of a building type this projection needs: its worker slots. */
export interface AssignBuildingInfo {
  readonly workers?: readonly { readonly jobType: number; readonly count: number }[] | undefined;
}

/** The bound-settler headcount per (building id, jobType) - the capacity check reads it. */
type Staffing = Map<number, Map<number, number>>;

function buildStaffing(snapshot: WorldSnapshot): Staffing {
  const staffing: Staffing = new Map();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const jobType = settlerJobType(e);
    const workplace = workplaceOf(e);
    if (jobType === undefined || workplace === undefined) continue;
    const byJob = staffing.get(workplace) ?? new Map<number, number>();
    byJob.set(jobType, (byJob.get(jobType) ?? 0) + 1);
    staffing.set(workplace, byJob);
  }
  return staffing;
}

/**
 * The worker slots of a building this settler could be assigned to at all, or null when it is not a
 * candidate: another owner's or tribe's building, or one that employs nobody. A building under
 * construction is a candidate, since its slots take staff from the moment the foundation is placed. The
 * one candidacy rule the highlight and the click resolver share.
 */
function candidateSlots(
  building: SnapshotEntity,
  settler: SnapshotEntity,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): readonly { readonly jobType: number; readonly count: number }[] | null {
  if (!isBuilding(building)) return null;
  if (ownerPlayerOf(building) !== ownerPlayerOf(settler)) return null; // only the settler's own buildings
  if (buildingTribeOf(building) !== settlerTribeOf(settler)) return null;
  const typeId = buildingTypeOf(building);
  const slots = typeId !== undefined ? buildingsByType.get(typeId)?.workers : undefined;
  return slots !== undefined && slots.length > 0 ? slots : null; // employs nobody (a home) → not a candidate
}

/**
 * The building's slot job matching the settler's current trade with a free seat, or null. Matched by
 * canonical trade, so a picker-assigned raw id lines up with the building's rebased slot id. There is no
 * fallback to another trade.
 */
export function currentTradeSlotAt(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number; readonly count: number }[] | undefined,
  boundByJob: ReadonlyMap<number, number> | undefined,
): number | null {
  if (currentJob === undefined) return null;
  const want = canonicalJobType(currentJob);
  for (const slot of slots ?? []) {
    if (canonicalJobType(slot.jobType) !== want) continue;
    if ((boundByJob?.get(slot.jobType) ?? 0) < slot.count) return slot.jobType;
  }
  return null;
}

/**
 * The highlight verdicts for a selected group over every own building: green when the building offers
 * one member's current trade with a free slot, red otherwise. Buildings no member is a candidate for are
 * skipped, not tinted.
 */
export function computeAssignHighlight(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): BuildingHighlightItem[] {
  const settlers = settlersIn(snapshot, settlerIds);
  if (settlers.length === 0) return [];
  const staffing = buildStaffing(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    let candidate = false;
    let ok = false;
    for (const settler of settlers) {
      const slots = candidateSlots(e, settler, buildingsByType);
      if (slots === null) continue;
      candidate = true;
      if (currentTradeSlotAt(settlerJobType(settler), slots, staffing.get(e.id)) !== null) {
        ok = true;
        break;
      }
    }
    if (candidate) items.push({ id: e.id, ok });
  }
  return items;
}

/**
 * The members a click on one building posts, each with the building's slot for its trade, or null when
 * no member has a free slot there: the click-resolution twin of the highlight, so a red building cancels
 * the click. A member whose slot already looks full still goes along, because the sim seats the group
 * in its own priority order against its current staffing.
 */
export function workerGroupAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerIds: readonly number[],
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): GroupWorker[] | null {
  const building = entityById(snapshot, buildingId);
  if (building === undefined) return null;
  const staffed = buildStaffing(snapshot).get(buildingId);
  const workers: GroupWorker[] = [];
  let seated = false;
  for (const settler of settlersIn(snapshot, settlerIds)) {
    const slots = candidateSlots(building, settler, buildingsByType);
    const job = currentTradeSlotAt(settlerJobType(settler), slots ?? undefined, undefined);
    if (job === null) continue;
    workers.push({ entity: settler.id as Entity, jobPriority: [job] });
    seated ||= currentTradeSlotAt(settlerJobType(settler), slots ?? undefined, staffed) !== null;
  }
  return seated ? workers : null;
}

function settlersIn(snapshot: WorldSnapshot, ids: readonly number[]): SnapshotEntity[] {
  const settlers: SnapshotEntity[] = [];
  for (const id of ids) {
    const e = entityById(snapshot, id);
    if (e !== undefined && isSettler(e)) settlers.push(e);
  }
  return settlers;
}
