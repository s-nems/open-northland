import type { BuildingFootprint } from '@open-northland/data';
import type { BuildingHighlightCell, BuildingHighlightItem } from '@open-northland/render';
import { nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { assignmentPriorityFor } from '../../game/sandbox/index.js';
import {
  buildingTypeOf,
  entityById,
  isBuilding,
  isSettler,
  num,
  ownerPlayerOf,
  positionOf,
  settlerJobType,
} from '../../game/snapshot.js';

/**
 * The "przydziel miejsce pracy" (assign a workplace) highlight — the pure snapshot projection behind the
 * button + the green/red building wash. Given the selected settler, it decides for every own building
 * whether the settler can be assigned there (a slot in its assignment-priority order is open — the
 * capacity-and-offer half of what the sim's `assignWorker` gate enforces) and hands the render layer the
 * verdict plus each building's footprint cells. A gatherer's candidates are the warehouses + workshops
 * with a gatherer slot; a baker's are the bakeries with a free baker slot — driven by the same
 * {@link assignmentPriorityFor} the right-click uses, so the highlight and the actual bind agree.
 *
 * It approximates the sim's tech/XP gates (those live in the sim and can't be read from a plain snapshot):
 * a green building is one that offers this settler an open slot, and the sim still gates the command, so a
 * click on a green building can at worst be a no-op — never an illegal bind. Red = no open slot this settler
 * could take.
 */

/** The slice of a building type this projection needs: its worker slots + footprint. */
export interface AssignBuildingInfo {
  readonly workers?: readonly { readonly jobType: number; readonly count: number }[] | undefined;
  readonly footprint?: BuildingFootprint | undefined;
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
 * The job this settler would be bound to at `slots`, or null when the building offers it no open slot: the
 * first job in its {@link assignmentPriorityFor} order whose slot still has room at this building (`held <
 * count`). The same preference the right-click issues, gated by live capacity — so the green wash marks
 * exactly the buildings a click would actually staff (modulo the sim's own tech/XP gate).
 */
export function assignableJobAt(
  currentJob: number | undefined,
  slots: readonly { readonly jobType: number; readonly count: number }[] | undefined,
  boundByJob: ReadonlyMap<number, number> | undefined,
): number | null {
  for (const job of assignmentPriorityFor(currentJob, slots)) {
    const slot = slots?.find((s) => s.jobType === job);
    if (slot === undefined) continue;
    if ((boundByJob?.get(job) ?? 0) < slot.count) return job;
  }
  return null;
}

/** The footprint cells to wash for a building — its reserved plot ∪ its door ∪ the anchor node — so the
 *  highlight covers the building's ground extent, not a single tile. Falls back to just the anchor when the
 *  type carries no footprint (the hand-authored catalog path). */
function highlightCells(footprint: BuildingFootprint | undefined): BuildingHighlightCell[] {
  const cells = new Map<string, BuildingHighlightCell>();
  const add = (dx: number, dy: number): void => {
    cells.set(`${dx},${dy}`, { dx, dy });
  };
  add(0, 0);
  for (const c of footprint?.reserved ?? []) add(c.dx, c.dy);
  if (footprint?.door !== undefined) add(footprint.door.dx, footprint.door.dy);
  return [...cells.values()];
}

/**
 * The assignment-highlight items for a selected settler over every own building. Buildings of another
 * owner or another tribe are skipped (never staffable by this settler); the rest are washed green when
 * {@link assignableJobAt} finds an open slot and red otherwise. Pure over the snapshot + the building-type
 * table, so it is unit-testable and never touches sim state.
 */
export function computeAssignHighlight(
  snapshot: WorldSnapshot,
  settlerId: number,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): BuildingHighlightItem[] {
  const settler = entityById(snapshot, settlerId);
  if (settler === undefined || !isSettler(settler)) return [];
  const owner = ownerPlayerOf(settler);
  const tribe = settlerTribe(settler);
  const currentJob = settlerJobType(settler);
  const staffing = buildStaffing(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    if (!isBuilding(e)) continue;
    if (ownerPlayerOf(e) !== owner) continue; // only the settler's own buildings are candidates
    if (buildingTribe(e) !== tribe) continue;
    if (e.components.UnderConstruction !== undefined) continue; // a site takes builders, not workers
    const pos = positionOf(e);
    const typeId = buildingTypeOf(e);
    if (pos === undefined || typeId === undefined) continue;
    const info = buildingsByType.get(typeId);
    const slots = info?.workers;
    if (slots === undefined || slots.length === 0) continue; // employs nobody (a home) — not a candidate
    const ok = assignableJobAt(currentJob, slots, staffing.get(e.id)) !== null;
    items.push({ anchor: nodeOfPosition(pos.x, pos.y), cells: highlightCells(info?.footprint), ok });
  }
  return items;
}

/**
 * Whether the settler can be assigned to ONE specific building right now, and the job it would take — the
 * click-resolution twin of {@link computeAssignHighlight}. Returns null when the building is another
 * owner's/tribe's, a construction site, employs nobody, or offers this settler no open slot (a red
 * building). Used to decide whether a click in assign mode binds the settler (green) or cancels (red).
 */
export function assignableJobForBuilding(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerId: number,
  buildingsByType: ReadonlyMap<number, AssignBuildingInfo>,
): number | null {
  const settler = entityById(snapshot, settlerId);
  const building = entityById(snapshot, buildingId);
  if (settler === undefined || !isSettler(settler)) return null;
  if (building === undefined || !isBuilding(building)) return null;
  if (ownerPlayerOf(building) !== ownerPlayerOf(settler)) return null;
  if (buildingTribe(building) !== settlerTribe(settler)) return null;
  if (building.components.UnderConstruction !== undefined) return null;
  const typeId = buildingTypeOf(building);
  const slots = typeId !== undefined ? buildingsByType.get(typeId)?.workers : undefined;
  return assignableJobAt(settlerJobType(settler), slots, buildStaffing(snapshot).get(buildingId));
}
