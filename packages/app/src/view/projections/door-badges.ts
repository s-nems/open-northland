import {
  type DoorBadge,
  type DoorBadgeRow,
  GARRISON_MAST_FALLBACK_DX,
  type HouseholdKind,
} from '@open-northland/render';
import { ONE, tileToScreen } from '@open-northland/render/data';
import {
  collectPositioned,
  entitiesWith,
  entityById,
  type Fixed,
  nodeOfPosition,
  positionOfNode,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { WorkerRole } from '../../game/sandbox/index.js';
import {
  buildingTribeOf,
  buildingTypeOf,
  type HomeFamily,
  homeFamiliesOf,
  isAdult,
  isFemale,
  isMakingLove,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  staffOf,
} from '../../game/snapshot.js';
import { type DoorFootprint, workerIconNode } from './building-points.js';

/**
 * Turns the snapshot into the per-building sign rows the render layer draws at a staffed building's sign
 * post, owning both the stack order and each row's click-pick settler id, so drawing and picking share
 * one list. The stack stands at the building's `GfxFlagPoint` when the content carries one, and
 * otherwise at the derived worker-icon node beside the door. A garrison draws no row: the whole post
 * flies one flag from its mast, a star per man.
 */

/** The slice of a building type this projection needs: the half-cell door offset from the placed anchor,
 *  the stable `id` used as the worker-icon override key, the extracted `GfxFlagPoint`, and the mast
 *  point a garrison flag flies from. */
export interface BuildingDoorInfo {
  readonly id?: string | undefined;
  readonly footprint?: DoorFootprint | undefined;
  readonly flagPoint?: { readonly x: number; readonly y: number } | undefined;
  readonly mastPoint?: { readonly x: number; readonly y: number; readonly behindFrom?: number } | undefined;
}

/** Body-relative anchors by type and tribe, with the entity's authored variant when present. */
export type BuildingDoorInfoOf = (
  typeId: number | undefined,
  tribe: number | undefined,
  entity?: number,
) => BuildingDoorInfo | undefined;

/** Reused output of the box query; the slots past a query's count hold earlier frames' bodies. */
const boxed: SnapshotEntity[] = [];

/** What one building's badge was made from: the building's own object, its families grouping and each
 *  staff member's id and `Settler` (the job a row reads), so a building whose inputs held keeps its badge. */
interface HeldBadge {
  readonly building: SnapshotEntity;
  readonly families: readonly HomeFamily[] | undefined;
  readonly staff: readonly unknown[];
  readonly badge: DoorBadge | null;
}

/** The badges last made per building in view, kept across snapshots by one caller. */
export interface DoorBadgeCache {
  held: Map<number, HeldBadge>;
}

function sameStaff(held: readonly unknown[], staff: readonly SnapshotEntity[]): boolean {
  if (held.length !== staff.length * 2) return false;
  for (let i = 0; i < staff.length; i++) {
    const member = staff[i] as SnapshotEntity;
    if (held[i * 2] !== member.id || held[i * 2 + 1] !== member.components.Settler) return false;
  }
  return true;
}

/** The badges of the buildings standing in `box`, ascending by building id; no box reads the whole map.
 *  With `cache`, a building whose own object, families and staff jobs held since the last call keeps
 *  its badge. */
export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
  roleOf: (jobType: number) => WorkerRole,
  box?: TileBox,
  cache?: DoorBadgeCache,
): DoorBadge[] {
  const out: DoorBadge[] = [];
  const buildings = box === undefined ? entitiesWith(snapshot, 'Building') : buildingsIn(snapshot, box);
  // Only the buildings in this view are kept, so the cache never outgrows a screen.
  const kept = cache === undefined ? undefined : new Map<number, HeldBadge>();
  for (const e of buildings) {
    const staff = staffOf(snapshot, e.id);
    const families = homeFamiliesOf(snapshot, e.id);
    const held = cache?.held.get(e.id);
    if (
      held !== undefined &&
      held.building === e &&
      held.families === families &&
      sameStaff(held.staff, staff)
    ) {
      kept?.set(e.id, held);
      if (held.badge !== null) out.push(held.badge);
      continue;
    }
    const badge = doorBadgeOf(snapshot, e, staff, families, buildingInfoOf, roleOf);
    if (kept !== undefined) {
      const staffKey: unknown[] = [];
      for (const member of staff) staffKey.push(member.id, member.components.Settler);
      kept.set(e.id, { building: e, families, staff: staffKey, badge });
    }
    if (badge !== null) out.push(badge);
  }
  if (cache !== undefined && kept !== undefined) cache.held = kept;
  return out;
}

function doorBadgeOf(
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  staff: readonly SnapshotEntity[],
  families: readonly HomeFamily[] | undefined,
  buildingInfoOf: BuildingDoorInfoOf,
  roleOf: (jobType: number) => WorkerRole,
): DoorBadge | null {
  const counts = staffTallyOf(staff, roleOf);
  const hearts = isMakingLove(e);
  if (counts === undefined && families === undefined && !hearts) return null;
  // No flag over a foundation: the mast point is the finished tower's, some 239 px up, and the sim
  // refuses an unbuilt post anyway.
  const garrison = e.components.UnderConstruction === undefined ? (counts?.garrison ?? 0) : 0;
  const pos = positionOf(e);
  if (pos === undefined) return null;
  const info = buildingInfoOf(buildingTypeOf(e), buildingTribeOf(e), e.id);
  const player = ownerPlayerOf(e);

  // Bottom to top: family banners, then worker discs, then the carrier pennants.
  const rows: DoorBadgeRow[] = [];
  for (const family of families ?? []) {
    const settler = selectableResident(snapshot, family);
    rows.push({ role: householdKindOf(family), ...(settler !== undefined ? { settler } : {}) });
  }
  for (const id of counts?.craftsmen ?? []) rows.push({ role: 'craftsman', settler: id });
  for (const id of counts?.gatherers ?? []) rows.push({ role: 'gatherer', settler: id });
  for (const id of counts?.carriers ?? []) rows.push({ role: 'carrier', settler: id });

  const anchor = anchorOf(pos, info);
  return {
    id: e.id,
    ...anchor,
    ...(player !== undefined ? { player } : {}),
    rows,
    ...(hearts ? { hearts } : {}),
    ...(garrison > 0 ? { garrison: { stars: garrison, ...mastOf(info, anchor) } } : {}),
  };
}

/** The positioned buildings the box query returns, ascending by id. */
function buildingsIn(snapshot: WorldSnapshot, box: TileBox): SnapshotEntity[] {
  const count = collectPositioned(snapshot, box, boxed);
  const buildings: SnapshotEntity[] = [];
  for (let i = 0; i < count; i++) {
    const e = boxed[i] as SnapshotEntity;
    if (e.components.Building !== undefined) buildings.push(e);
  }
  return buildings.sort((a, b) => a.id - b.id);
}

interface StaffTally {
  readonly craftsmen: number[];
  readonly carriers: number[];
  readonly gatherers: number[];
  garrison: number;
}

/** A building's staff by role, each list ascending by id like the staff; undefined when no member holds
 *  a job, so the building shows no worker row. */
function staffTallyOf(
  staff: readonly SnapshotEntity[],
  roleOf: (jobType: number) => WorkerRole,
): StaffTally | undefined {
  let tally: StaffTally | undefined;
  for (const e of staff) {
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue;
    tally ??= { craftsmen: [], carriers: [], gatherers: [], garrison: 0 };
    switch (roleOf(jobType)) {
      case 'carrier':
        tally.carriers.push(e.id);
        break;
      case 'gatherer':
        tally.gatherers.push(e.id);
        break;
      // Counted rather than bucketed: the post flies one flag, and its soldiers stay unpickable inside.
      case 'garrison':
        tally.garrison++;
        break;
      case 'craftsman':
        tally.craftsmen.push(e.id);
        break;
    }
  }
  return tally;
}

/** Both anchors reach the layer as the building's position plus a screen-px offset, so the layer
 *  depth-sorts the chain with its house; a node anchor behind the house would sort it into the body. */
function anchorOf(
  pos: { readonly x: Fixed; readonly y: Fixed },
  info: BuildingDoorInfo | undefined,
): Pick<DoorBadge, 'x' | 'y' | 'dx' | 'dy'> {
  if (info?.flagPoint !== undefined) {
    return { x: pos.x, y: pos.y, dx: info.flagPoint.x, dy: info.flagPoint.y };
  }
  const node = workerIconNode(info?.footprint, nodeOfPosition(pos.x, pos.y), info?.id);
  const npos = positionOfNode(node.hx, node.hy);
  const from = tileToScreen(pos.x / ONE, pos.y / ONE);
  const to = tileToScreen(npos.x / ONE, npos.y / ONE);
  return { x: pos.x, y: pos.y, dx: to.x - from.x, dy: to.y - from.y };
}

/** Where the garrison flag is planted: the type's mast point, else beside the sign post the badges
 *  stand on, so a mastless post's flag does not cover the rows a click has to reach. */
function mastOf(
  info: BuildingDoorInfo | undefined,
  post: Pick<DoorBadge, 'dx' | 'dy'>,
): { readonly dx: number; readonly dy: number; readonly behindFromDy?: number } {
  const mast = info?.mastPoint;
  if (mast !== undefined) {
    const { x: dx, y: dy, behindFrom } = mast;
    return { dx, dy, ...(behindFrom !== undefined ? { behindFromDy: behindFrom } : {}) };
  }
  return { dx: (post.dx ?? 0) + GARRISON_MAST_FALLBACK_DX, dy: post.dy ?? 0 };
}

/** Parents raising a child read 'family', a childless pair 'couple', anyone alone 'single'. */
function householdKindOf(family: HomeFamily): HouseholdKind {
  if (family.adults > 0 && family.minors > 0) return 'family';
  if (family.adults >= 2) return 'couple';
  return 'single';
}

/** A click on the banner selects the adult female of a couple, else the lone resident. */
function selectableResident(snapshot: WorldSnapshot, family: HomeFamily): number | undefined {
  if (family.adults >= 2) {
    for (const id of family.members) {
      const member = entityById(snapshot, id);
      if (member !== undefined && isAdult(member) && isFemale(member)) return id;
    }
  }
  return family.members[0];
}
