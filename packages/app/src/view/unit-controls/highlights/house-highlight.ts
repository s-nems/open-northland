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

interface Mover {
  readonly settler: SnapshotEntity;
  readonly family: readonly number[];
}

function moversOf(snapshot: WorldSnapshot, settlerIds: readonly number[]): Mover[] {
  const movers: Mover[] = [];
  for (const id of settlerIds) {
    const settler = entityById(snapshot, id);
    if (settler !== undefined && isSettler(settler))
      movers.push({ settler, family: familyIdsOf(snapshot, id) });
  }
  return movers;
}

/** Whether `house` is a candidate for any mover (an own home), and whether one mover's family fits it. */
function houseVerdict(
  house: SnapshotEntity,
  movers: readonly Mover[],
  families: ReadonlyMap<number, readonly HomeFamily[]>,
  housesByType: ReadonlyMap<number, HouseInfo>,
): { readonly candidate: boolean; readonly ok: boolean } {
  if (!isHome(house, housesByType)) return { candidate: false, ok: false };
  const owned = movers.filter(({ settler }) => ownerPlayerOf(house) === ownerPlayerOf(settler));
  const ok = owned.some(
    ({ settler, family }) =>
      buildingTribeOf(house) === settlerTribeOf(settler) &&
      houseFitsFamily(house, family, families.get(house.id), housesByType),
  );
  return { candidate: owned.length > 0, ok };
}

/**
 * The highlight verdicts for a selected group over every own home: green when one member's family fits.
 * Known gap: signpost confinement is not mirrored, so an out-of-area home can still wash green.
 */
export function computeHouseHighlight(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  housesByType: ReadonlyMap<number, HouseInfo>,
): BuildingHighlightItem[] {
  const movers = moversOf(snapshot, settlerIds);
  if (movers.length === 0) return [];
  const families = familiesByHome(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    const { candidate, ok } = houseVerdict(e, movers, families, housesByType);
    if (candidate) items.push({ id: e.id, ok });
  }
  return items;
}

/** The click-resolution twin of {@link computeHouseHighlight}: whether one member's family fits `buildingId`. */
export function houseAssignableAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerIds: readonly number[],
  housesByType: ReadonlyMap<number, HouseInfo>,
): boolean {
  const house = entityById(snapshot, buildingId);
  if (house === undefined) return false;
  return houseVerdict(house, moversOf(snapshot, settlerIds), familiesByHome(snapshot), housesByType).ok;
}
