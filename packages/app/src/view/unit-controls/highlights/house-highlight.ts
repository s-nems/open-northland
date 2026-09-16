import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTribeOf,
  buildingTypeOf,
  familiesByHome,
  type HomeFamily,
  isAdult,
  isBuilding,
  isSettler,
  marriageOf,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerTribeOf,
} from '../../../game/snapshot.js';

/** `homeSize` (the original `logichomesize`, 1..5 by level) counts FAMILIES, not settlers. */
export interface HouseInfo {
  readonly kind?: string | undefined;
  readonly homeSize?: number | undefined;
}

/** Mirrors the sim's `familyOf` over the snapshot: self, living spouse, still-growing child. */
export function familyIdsOf(snapshot: WorldSnapshot, settlerId: number): number[] {
  const e = entityById(snapshot, settlerId);
  if (e === undefined || !isSettler(e)) return [];
  const family = [settlerId];
  const marriage = marriageOf(e);
  if (marriage !== undefined) {
    if (entityById(snapshot, marriage.spouse) !== undefined) family.push(marriage.spouse);
    const childId = marriage.child;
    const child = childId !== null ? entityById(snapshot, childId) : undefined;
    if (childId !== null && child !== undefined && !isAdult(child)) family.push(childId);
  }
  return family;
}

function isHome(e: SnapshotEntity, housesByType: ReadonlyMap<number, HouseInfo>): boolean {
  if (!isBuilding(e)) return false;
  const typeId = buildingTypeOf(e);
  return typeId !== undefined && housesByType.get(typeId)?.kind === 'home';
}

/** The mover's own family keeps its slot on a same-home re-assign, so only OTHER households count. */
function houseFitsFamily(
  house: SnapshotEntity,
  family: readonly number[],
  families: readonly HomeFamily[] | undefined,
  housesByType: ReadonlyMap<number, HouseInfo>,
): boolean {
  const typeId = buildingTypeOf(house);
  const size = (typeId !== undefined ? housesByType.get(typeId)?.homeSize : undefined) ?? 0;
  const members = new Set(family);
  const others = (families ?? []).filter((fam) => !fam.members.some((m) => members.has(m))).length;
  return others + 1 <= size;
}

/** Known gap: signpost confinement is not mirrored, so an out-of-area home can still wash green. */
export function computeHouseHighlight(
  snapshot: WorldSnapshot,
  settlerId: number,
  housesByType: ReadonlyMap<number, HouseInfo>,
): BuildingHighlightItem[] {
  const settler = entityById(snapshot, settlerId);
  if (settler === undefined || !isSettler(settler)) return [];
  const family = familyIdsOf(snapshot, settlerId);
  const families = familiesByHome(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    if (!isHome(e, housesByType)) continue;
    if (ownerPlayerOf(e) !== ownerPlayerOf(settler)) continue;
    const ok =
      buildingTribeOf(e) === settlerTribeOf(settler) &&
      houseFitsFamily(e, family, families.get(e.id), housesByType);
    items.push({ id: e.id, ok });
  }
  return items;
}

export function houseAssignableAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerId: number,
  housesByType: ReadonlyMap<number, HouseInfo>,
): boolean {
  const settler = entityById(snapshot, settlerId);
  const house = entityById(snapshot, buildingId);
  if (settler === undefined || !isSettler(settler) || house === undefined) return false;
  if (!isHome(house, housesByType)) return false;
  if (ownerPlayerOf(house) !== ownerPlayerOf(settler)) return false;
  if (buildingTribeOf(house) !== settlerTribeOf(settler)) return false;
  const families = familiesByHome(snapshot).get(buildingId);
  return houseFitsFamily(house, familyIdsOf(snapshot, settlerId), families, housesByType);
}
