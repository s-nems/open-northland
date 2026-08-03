import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
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
 * The highlight verdicts for a selected settler over every own building: green when the building offers
 * the settler's current trade with a free slot, red otherwise. Non-candidates are skipped, not tinted.
 */
export function computeAssignHighlight(
  snapshot: WorldSnapshot,
  settlerId: number,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): BuildingHighlightItem[] {
  const settler = entityById(snapshot, settlerId);
  if (settler === undefined || !isSettler(settler)) return [];
  const currentJob = settlerJobType(settler);
  const staffing = buildStaffing(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    const slots = candidateSlots(e, settler, buildingsByType);
    if (slots === null) continue; // not a candidate - skipped, never tinted
    const ok = currentTradeSlotAt(currentJob, slots, staffing.get(e.id)) !== null;
    items.push({ id: e.id, ok });
  }
  return items;
}

/**
 * The job the button would bind the settler to at one building, or null when that building does not
 * offer the trade. The click-resolution twin of the highlight, so a red building cancels the click.
 */
export function assignableJobForBuilding(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerId: number,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): number | null {
  const settler = entityById(snapshot, settlerId);
  const building = entityById(snapshot, buildingId);
  if (settler === undefined || !isSettler(settler) || building === undefined) return null;
  const slots = candidateSlots(building, settler, buildingsByType);
  if (slots === null) return null; // not a candidate - the click cancels
  return currentTradeSlotAt(settlerJobType(settler), slots, buildStaffing(snapshot).get(buildingId));
}
