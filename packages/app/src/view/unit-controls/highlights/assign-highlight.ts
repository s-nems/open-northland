import type { BuildingHighlightItem } from '@open-northland/render';
import {
  type Entity,
  entitiesWith,
  entityById,
  type GroupWorker,
  type WorldSnapshot,
} from '@open-northland/sim';
import { canonicalJobType } from '../../../game/sandbox/ids/index.js';
import {
  buildingTypeOf,
  isBuilding,
  ownerKeyOf,
  type SnapshotEntity,
  settlerJobType,
  settlersIn,
  staffOf,
  workplaceOf,
} from '../../../game/snapshot.js';

/**
 * The pure snapshot projection behind the assign-a-workplace button and its green or red building tint.
 * The button places each member's current profession and never re-trades them, so a building greens when
 * a worker slot matches a member's trade canonically and still has room. The sim keeps enforcing its own
 * XP gate on each member's `assignWorker`.
 */

/** A building type's worker slots. */
type WorkerSlots = readonly { readonly jobType: number; readonly count: number }[];

/** The slice of a building type this projection needs: its worker slots. */
export interface AssignBuildingInfo {
  readonly workers?: WorkerSlots | undefined;
}

/** The settlers bound to `building` counted by jobType - the capacity check reads it. */
function staffingOf(snapshot: WorldSnapshot, building: number): Map<number, number> {
  const byJob = new Map<number, number>();
  for (const e of staffOf(snapshot, building)) {
    const jobType = settlerJobType(e);
    if (jobType !== undefined) byJob.set(jobType, (byJob.get(jobType) ?? 0) + 1);
  }
  return byJob;
}

/**
 * The slot jobs that seat `job`, matched by canonical trade, so a picker-assigned raw id lines up with
 * the building's rebased slot id. There is no fallback to another trade.
 */
export function tradeSlotsOf(job: number | undefined, slots: WorkerSlots): number[] {
  if (job === undefined) return [];
  const want = canonicalJobType(job);
  return slots.filter((slot) => canonicalJobType(slot.jobType) === want).map((slot) => slot.jobType);
}

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
    const team = ownerKeyOf(e);
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

/**
 * Whether `building` employs anyone of a member's owner, and whether it has a free seat for a
 * member the order would post there. A building under construction is a candidate, since its slots take
 * staff from the moment the foundation is placed.
 */
function workplaceVerdict(
  snapshot: WorldSnapshot,
  building: SnapshotEntity,
  crew: Crew,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): { readonly candidate: boolean; readonly ok: boolean } {
  const slots = slotsOf(building, buildingsByType);
  const team = ownerKeyOf(building);
  if (slots.length === 0 || !crew.teams.has(team)) return { candidate: false, ok: false };
  const seats = slots.map((slot) => ({ slot, key: seatKey(team, slot.jobType) }));
  const unemployedHere = seats.some(({ key }) => (crew.unemployed.get(key) ?? 0) > 0);
  const employedHere = crew.employedAt.get(building.id);
  const staffed = staffingOf(snapshot, building.id);
  const ok = seats.some(({ slot, key }) => {
    if ((staffed.get(slot.jobType) ?? 0) >= slot.count) return false;
    if (unemployedHere) return (crew.unemployed.get(key) ?? 0) > 0;
    return (crew.all.get(key) ?? 0) - (employedHere?.get(key) ?? 0) > 0;
  });
  return { candidate: true, ok };
}

/**
 * The highlight verdicts for a selected group over every own building: green when it has a free seat
 * for a member the order would post there. Buildings employing nobody of a member's owner are
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
  const items: BuildingHighlightItem[] = [];
  for (const e of entitiesWith(snapshot, 'Building')) {
    const { candidate, ok } = workplaceVerdict(snapshot, e, crew, buildingsByType);
    if (candidate) items.push({ id: e.id, ok });
  }
  return items;
}

/**
 * The members a click on one building posts, each with the building's slots for its trade, or null when
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
  const settlers = settlersIn(snapshot, settlerIds);
  if (!workplaceVerdict(snapshot, building, crewOf(settlers), buildingsByType).ok) return null;
  const slots = slotsOf(building, buildingsByType);
  const team = ownerKeyOf(building);
  const workers: GroupWorker[] = [];
  for (const settler of settlers) {
    const jobPriority = tradeSlotsOf(settlerJobType(settler), slots);
    if (ownerKeyOf(settler) === team && jobPriority.length > 0) {
      workers.push({ entity: settler.id as Entity, jobPriority });
    }
  }
  return workers;
}
