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
 * The button places each member's current profession and never re-trades them, so a building greens when
 * a worker slot matches a member's trade canonically and still has room. The sim keeps enforcing its own
 * XP gate on each member's `assignWorker`.
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
 * construction is a candidate, since its slots take staff from the moment the foundation is placed.
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

type WorkerSlots = readonly { readonly jobType: number; readonly count: number }[];

/** The owner and tribe a building must share with a member it employs. */
const teamKey = (owner: number | undefined, tribe: number | undefined): string => `${owner}:${tribe}`;

/** A slot seats a member of its owner, tribe and canonical trade. */
const seatKey = (team: string, jobType: number): string => `${team}:${canonicalJobType(jobType)}`;

/**
 * The selected members counted by seat key, as the sim's `groupPlacementOrder` picks them at one
 * building: the unemployed its slots take while there are any, otherwise the members its slots take,
 * less the ones already employed there.
 */
interface Crew {
  readonly teams: ReadonlySet<string>;
  readonly all: ReadonlyMap<string, number>;
  readonly unemployed: ReadonlyMap<string, number>;
  /** Per building id, the members employed there by seat key. */
  readonly employedAt: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

function crewOf(settlers: readonly SnapshotEntity[]): Crew {
  const teams = new Set<string>();
  const all = new Map<string, number>();
  const unemployed = new Map<string, number>();
  const employedAt = new Map<number, Map<string, number>>();
  const bump = (counts: Map<string, number>, key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const e of settlers) {
    const job = settlerJobType(e);
    if (job === undefined) continue;
    const team = teamKey(ownerPlayerOf(e), settlerTribeOf(e));
    const key = seatKey(team, job);
    teams.add(team);
    bump(all, key);
    const workplace = workplaceOf(e);
    if (workplace === undefined) {
      bump(unemployed, key);
      continue;
    }
    const here = employedAt.get(workplace) ?? new Map<string, number>();
    bump(here, key);
    employedAt.set(workplace, here);
  }
  return { teams, all, unemployed, employedAt };
}

function slotsOf(
  building: SnapshotEntity,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): WorkerSlots {
  if (!isBuilding(building)) return [];
  const typeId = buildingTypeOf(building);
  return (typeId !== undefined ? buildingsByType.get(typeId)?.workers : undefined) ?? [];
}

/** Whether `building` employs anyone of a member's owner and tribe, and whether it has a free seat for a
 *  member the order would post there. */
function workplaceVerdict(
  building: SnapshotEntity,
  crew: Crew,
  staffing: Staffing,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): { readonly candidate: boolean; readonly ok: boolean } {
  const slots = slotsOf(building, buildingsByType);
  const team = teamKey(ownerPlayerOf(building), buildingTribeOf(building));
  if (slots.length === 0 || !crew.teams.has(team)) return { candidate: false, ok: false };
  const seats = slots.map((slot) => ({ slot, key: seatKey(team, slot.jobType) }));
  const unemployedHere = seats.some(({ key }) => (crew.unemployed.get(key) ?? 0) > 0);
  const employedHere = crew.employedAt.get(building.id);
  const staffed = staffing.get(building.id);
  const ok = seats.some(({ slot, key }) => {
    if ((staffed?.get(slot.jobType) ?? 0) >= slot.count) return false;
    if (unemployedHere) return (crew.unemployed.get(key) ?? 0) > 0;
    return (crew.all.get(key) ?? 0) - (employedHere?.get(key) ?? 0) > 0;
  });
  return { candidate: true, ok };
}

/**
 * The highlight verdicts for a selected group over every own building: green when it has a free seat
 * for a member the order would post there. Buildings employing nobody of a member's owner and tribe are
 * skipped, not tinted.
 */
export function computeAssignHighlight(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): BuildingHighlightItem[] {
  const settlers = settlersIn(snapshot, settlerIds);
  if (settlers.length === 0) return [];
  const crew = crewOf(settlers);
  const staffing = buildStaffing(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    const { candidate, ok } = workplaceVerdict(e, crew, staffing, buildingsByType);
    if (candidate) items.push({ id: e.id, ok });
  }
  return items;
}

/**
 * The members a click on one building posts, each with the building's slot for its trade, or null when
 * the highlight reds it, so a red building cancels the click. Every member the building offers its trade
 * goes along; the sim picks who is seated against its current staffing.
 */
export function workerGroupAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerIds: readonly number[],
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): GroupWorker[] | null {
  const building = entityById(snapshot, buildingId);
  if (building === undefined) return null;
  const workers: GroupWorker[] = [];
  const offered: SnapshotEntity[] = [];
  for (const settler of settlersIn(snapshot, settlerIds)) {
    const slots = candidateSlots(building, settler, buildingsByType);
    const job = currentTradeSlotAt(settlerJobType(settler), slots ?? undefined, undefined);
    if (job === null) continue;
    workers.push({ entity: settler.id as Entity, jobPriority: [job] });
    offered.push(settler);
  }
  const { ok } = workplaceVerdict(building, crewOf(offered), buildStaffing(snapshot), buildingsByType);
  return ok ? workers : null;
}

function settlersIn(snapshot: WorldSnapshot, ids: readonly number[]): SnapshotEntity[] {
  const settlers: SnapshotEntity[] = [];
  for (const id of ids) {
    const e = entityById(snapshot, id);
    if (e !== undefined && isSettler(e)) settlers.push(e);
  }
  return settlers;
}
