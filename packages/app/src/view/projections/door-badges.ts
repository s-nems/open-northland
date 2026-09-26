import {
  type DoorBadge,
  type DoorBadgeRow,
  GARRISON_MAST_FALLBACK_DX,
  type HouseholdKind,
} from '@open-northland/render';
import { ONE, tileToScreen } from '@open-northland/render/data';
import {
  entitiesWith,
  entityById,
  type Fixed,
  nodeOfPosition,
  positionOfNode,
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
 *  the stable `id` used as the worker-icon override key, the extracted `GfxFlagPoint`, and the authored
 *  mast point a garrison flag flies from. */
export interface BuildingDoorInfo {
  readonly id?: string | undefined;
  readonly footprint?: DoorFootprint | undefined;
  readonly flagPoint?: { readonly x: number; readonly y: number } | undefined;
  readonly mastPoint?: { readonly x: number; readonly y: number } | undefined;
}

/** A building's anchors by type and tribe: the anchors are per-skin pixel offsets, so the frank tower's
 *  mast differs from the viking one on the same typeId. */
export type BuildingDoorInfoOf = (
  typeId: number | undefined,
  tribe: number | undefined,
) => BuildingDoorInfo | undefined;

export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
  roleOf: (jobType: number) => WorkerRole,
): DoorBadge[] {
  const out: DoorBadge[] = [];
  for (const e of entitiesWith(snapshot, 'Building')) {
    const counts = staffTallyOf(staffOf(snapshot, e.id), roleOf);
    // One banner row per resident family.
    const families = homeFamiliesOf(snapshot, e.id);
    const hearts = isMakingLove(e);
    if (counts === undefined && families === undefined && !hearts) continue;
    // No flag over a foundation: the mast point is the finished tower's, some 239 px up, and the sim
    // refuses an unbuilt post anyway.
    const garrison = e.components.UnderConstruction === undefined ? (counts?.garrison ?? 0) : 0;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const info = buildingInfoOf(buildingTypeOf(e), buildingTribeOf(e));
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
    out.push({
      id: e.id,
      ...anchor,
      ...(player !== undefined ? { player } : {}),
      rows,
      ...(hearts ? { hearts } : {}),
      ...(garrison > 0 ? { garrison: { stars: garrison, ...mastOf(info, anchor) } } : {}),
    });
  }
  return out;
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

/** Where the garrison flag is planted: the authored mast point, else beside the sign post the badges
 *  stand on, so a mastless post's flag does not cover the rows a click has to reach. */
function mastOf(
  info: BuildingDoorInfo | undefined,
  post: Pick<DoorBadge, 'dx' | 'dy'>,
): { readonly dx: number; readonly dy: number } {
  const mast = info?.mastPoint;
  if (mast !== undefined) return { dx: mast.x, dy: mast.y };
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
