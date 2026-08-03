import type { DoorBadge, DoorBadgeRow, HouseholdKind } from '@open-northland/render';
import { ONE, tileToScreen } from '@open-northland/render/data';
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

export function computeDoorBadges(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
  roleOf: (jobType: number) => WorkerRole,
): DoorBadge[] {
  // Buckets follow the snapshot's ascending-id actor order, so each one is deterministic.
  const tally = new Map<
    number,
    { craftsmen: number[]; carriers: number[]; gatherers: number[]; garrison: number }
  >();
  // One banner row per resident family.
  const households = familiesByHome(snapshot);
  const actors = actorsOf(snapshot);
  for (const e of actors) {
    if (!isSettler(e)) continue;
    const workplace = workplaceOf(e);
    if (workplace === undefined) continue; // an unbound settler shows no building badge
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue;
    const bucket = tally.get(workplace) ?? { craftsmen: [], carriers: [], gatherers: [], garrison: 0 };
    switch (roleOf(jobType)) {
      case 'carrier':
        bucket.carriers.push(e.id);
        break;
      case 'gatherer':
        bucket.gatherers.push(e.id);
        break;
      // Counted rather than bucketed: the post flies one flag, and its soldiers stay unpickable inside.
      case 'garrison':
        bucket.garrison++;
        break;
      case 'craftsman':
        bucket.craftsmen.push(e.id);
        break;
    }
    tally.set(workplace, bucket);
  }

  const out: DoorBadge[] = [];
  for (const e of actors) {
    if (!isBuilding(e)) continue;
    const counts = tally.get(e.id);
    const families = households.get(e.id);
    const hearts = isMakingLove(e);
    if (counts === undefined && families === undefined && !hearts) continue;
    // No flag over a foundation: the mast point is the finished tower's, some 239 px up, and the sim
    // refuses an unbuilt post anyway.
    const garrison = e.components.UnderConstruction === undefined ? (counts?.garrison ?? 0) : 0;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const typeId = buildingTypeOf(e);
    const info = typeId !== undefined ? buildingsByType.get(typeId) : undefined;
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

/** Both anchors reach the layer as the BUILDING's position plus a screen-px offset, the derived node
 *  included: that is what lets the layer depth-sort the chain with its house, where a node anchor
 *  behind the house (a north-facing door) would sort the chain into the house body. */
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

/** Where this type's garrison flag is planted: its authored mast point (a roof), else the sign post the
 *  badges already stand on - a garrison building nobody measured a roof for still shows it is manned. */
function mastOf(
  info: BuildingDoorInfo | undefined,
  post: Pick<DoorBadge, 'dx' | 'dy'>,
): { readonly dx: number; readonly dy: number } {
  const mast = info?.mastPoint;
  return mast !== undefined ? { dx: mast.x, dy: mast.y } : { dx: post.dx ?? 0, dy: post.dy ?? 0 };
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
