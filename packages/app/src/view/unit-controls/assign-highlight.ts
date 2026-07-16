import type { BuildingHighlightItem } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { canonicalJobType } from '../../game/sandbox/ids/index.js';
import {
  buildingTypeOf,
  entityById,
  isBuilding,
  isSettler,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../game/snapshot.js';

/**
 * The "przydziel miejsce pracy" (assign a workplace) highlight — the pure snapshot projection behind the
 * button + the green/red building tint. Unlike the right-click (which best-fits a trade), this button
 * places the settler's CURRENT profession: it greens exactly the buildings that offer that trade with a
 * free slot and binds the settler to it, never re-trading them. A miller greens only mills; a coin-maker
 * only mints; a gatherer only the warehouses / workshops that carry a gatherer slot.
 *
 * A building offers the current trade when one of its worker slots is the same trade canonically
 * ({@link canonicalJobType} — a settler's picker id 14 and a building's rebased slot id 1014 are both
 * coin-maker) and that slot still has room (`held < count` at this building). The sim still enforces its
 * own tech/XP gate on the `assignWorker` command; here green = "an own, built building with my trade's free
 * slot", the candidacy + capacity half the player reads at a glance.
 */

/** The slice of a building type this projection needs: its worker slots. */
export interface AssignBuildingInfo {
  readonly workers?: readonly { readonly jobType: number; readonly count: number }[] | undefined;
}

/** The bound-settler headcount per (building id, jobType) — the capacity check reads it. */
type Staffing = Map<number, Map<number, number>>;

function buildStaffing(snapshot: WorldSnapshot): Staffing {
  const staffing: Staffing = new Map();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const jobType = settlerJobType(e);
    const workplace = num((e.components.JobAssignment as { workplace?: unknown } | undefined)?.workplace);
    if (jobType === undefined || workplace === undefined) continue;
    const byJob = staffing.get(workplace) ?? new Map<number, number>();
    byJob.set(jobType, (byJob.get(jobType) ?? 0) + 1);
    staffing.set(workplace, byJob);
  }
  return staffing;
}

/** The building's tribe (`Building.tribe`), or undefined. */
function buildingTribe(e: { readonly components: Record<string, unknown> }): number | undefined {
  return num((e.components.Building as { tribe?: unknown } | undefined)?.tribe);
}

/** The settler's tribe (`Settler.tribe`), or undefined. */
function settlerTribe(e: { readonly components: Record<string, unknown> }): number | undefined {
  return num((e.components.Settler as { tribe?: unknown } | undefined)?.tribe);
}

/**
 * The candidacy gate — the worker slots of a building this settler could be assigned to at all, or null
 * when it is not a candidate: another owner's / tribe's building, a construction site (takes builders, not
 * workers), or a building that employs nobody (a home). The single home of "which buildings the assign
 * gesture considers", shared by the highlight (a non-candidate is skipped, not tinted red) and the click
 * resolver (a non-candidate cancels) so the green wash and the bind can never disagree about candidacy.
 */
function candidateSlots(
  building: SnapshotEntity,
  settler: SnapshotEntity,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): readonly { readonly jobType: number; readonly count: number }[] | null {
  if (!isBuilding(building)) return null;
  if (ownerPlayerOf(building) !== ownerPlayerOf(settler)) return null; // only the settler's own buildings
  if (buildingTribe(building) !== settlerTribe(settler)) return null;
  if (building.components.UnderConstruction !== undefined) return null; // a site takes builders, not workers
  const typeId = buildingTypeOf(building);
  const slots = typeId !== undefined ? buildingsByType.get(typeId)?.workers : undefined;
  return slots !== undefined && slots.length > 0 ? slots : null; // employs nobody (a home) → not a candidate
}

/**
 * The building's slot job that IS the settler's current trade with a free seat, or null — the exact job
 * the button would bind. Matches by canonical trade ({@link canonicalJobType}) so a picker-assigned trade
 * (raw id) lines up with the building's rebased slot id, and checks live capacity at this building. This
 * is the whole "assign my current profession here" rule: no fallback to another trade.
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
 * The assignment-highlight verdicts for a selected settler over every own building: green when the
 * building offers the settler's current trade with a free slot, red otherwise. Buildings of another
 * owner/tribe or under construction are skipped (never candidates). Pure over the snapshot + the
 * building-type table, so it is unit-testable and never touches sim state.
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
    if (slots === null) continue; // not a candidate — skipped, never tinted
    const ok = currentTradeSlotAt(currentJob, slots, staffing.get(e.id)) !== null;
    items.push({ id: e.id, ok });
  }
  return items;
}

/**
 * The job the button would bind the settler to at ONE building — its current trade's free slot, or null
 * when the building doesn't offer that trade (a red building). The click-resolution twin of
 * {@link computeAssignHighlight}: a green building returns its matching slot job, a red one returns null
 * (the click cancels).
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
  if (slots === null) return null; // not a candidate — the click cancels
  return currentTradeSlotAt(settlerJobType(settler), slots, buildStaffing(snapshot).get(buildingId));
}
