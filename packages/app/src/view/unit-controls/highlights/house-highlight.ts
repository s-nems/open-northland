import type { BuildingType, GoodType } from '@open-northland/data';
import type { TargetMark } from '@open-northland/render';
import { entitiesWith, entityById, homeFamilyCapacityView, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  homeFamiliesOf,
  isBuilding,
  ownerKeyOf,
  ownerPlayerOf,
  residenceHomeOf,
  type SnapshotEntity,
  settlersIn,
} from '../../../game/snapshot/index.js';
import { markOf } from './target-mark.js';

/** A house type as the verdict reads it: `homeSize` (the original `logichomesize`, 1..5 by level) counts
 *  FAMILIES, not settlers, and furniture adds `furnishedFamilies` more. */
export type HouseInfo = Pick<BuildingType, 'kind' | 'homeSize' | 'furnishedFamilies'>;

/**
 * The selected members a group home order moves, counted by owner, as the sim's
 * `groupPlacementOrder` picks them: the homeless while any member is homeless, otherwise everyone, less
 * the ones already living in the clicked home.
 */
interface Movers {
  readonly owners: ReadonlySet<number | undefined>;
  readonly byKey: ReadonlyMap<string, number>;
  /** Per home id, the movers living there by key: a family already in the clicked home stays put. */
  readonly livingAt: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

function moversOf(snapshot: WorldSnapshot, settlerIds: readonly number[]): Movers | null {
  const settlers = settlersIn(snapshot, settlerIds);
  if (settlers.length === 0) return null;
  const homeless = settlers.filter((e) => residenceHomeOf(e) === undefined);
  const movers = homeless.length > 0 ? homeless : settlers;
  const owners = new Set<number | undefined>();
  const byKey = new Map<string, number>();
  const livingAt = new Map<number, Map<string, number>>();
  for (const e of movers) {
    const key = ownerKeyOf(e);
    owners.add(ownerPlayerOf(e));
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    const home = residenceHomeOf(e);
    if (home === undefined) continue;
    const here = livingAt.get(home) ?? new Map<string, number>();
    here.set(key, (here.get(key) ?? 0) + 1);
    livingAt.set(home, here);
  }
  return { owners, byKey, livingAt };
}

/** Whether `house` is an own home of some mover, and whether one mover not yet living there fits. */
function houseVerdict(
  snapshot: WorldSnapshot,
  house: SnapshotEntity,
  movers: Movers,
  housesByType: ReadonlyMap<number, HouseInfo>,
  goods: readonly GoodType[],
): { readonly candidate: boolean; readonly ok: boolean } {
  if (!isBuilding(house)) return { candidate: false, ok: false };
  const typeId = buildingTypeOf(house);
  const info = typeId !== undefined ? housesByType.get(typeId) : undefined;
  if (info?.kind !== 'home' || !movers.owners.has(ownerPlayerOf(house))) {
    return { candidate: false, ok: false };
  }
  const key = ownerKeyOf(house);
  const moving = (movers.byKey.get(key) ?? 0) - (movers.livingAt.get(house.id)?.get(key) ?? 0);
  return { candidate: true, ok: moving > 0 && homeHasFamilyRoom(snapshot, house.id, info, goods) };
}

/** Whether a family from outside `house` fits beside the households living there: the sim's
 *  `moveFamilyInto` caps families, not people, at the home's capacity with the furniture of `goods`. */
export function homeHasFamilyRoom(
  snapshot: WorldSnapshot,
  house: number,
  info: HouseInfo,
  goods: readonly GoodType[],
): boolean {
  return (
    (homeFamiliesOf(snapshot, house)?.length ?? 0) < homeFamilyCapacityView(snapshot, house, info, goods)
  );
}

/**
 * The marks for a selected group over every own home: lit when it has a free family slot for a member
 * the order would move. Known gap: signpost confinement is not mirrored, so an out-of-area
 * home can still light up.
 */
export function computeHouseHighlight(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  housesByType: ReadonlyMap<number, HouseInfo>,
  goods: readonly GoodType[],
): TargetMark[] {
  const movers = moversOf(snapshot, settlerIds);
  if (movers === null) return [];
  const items: TargetMark[] = [];
  for (const e of entitiesWith(snapshot, 'Building')) {
    const { candidate, ok } = houseVerdict(snapshot, e, movers, housesByType, goods);
    if (candidate) items.push(markOf(e.id, ok));
  }
  return items;
}

/** The click-resolution twin of {@link computeHouseHighlight}: whether the group order would move anyone
 *  into `buildingId`. */
export function houseAssignableAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerIds: readonly number[],
  housesByType: ReadonlyMap<number, HouseInfo>,
  goods: readonly GoodType[],
): boolean {
  const house = entityById(snapshot, buildingId);
  const movers = moversOf(snapshot, settlerIds);
  if (house === undefined || movers === null) return false;
  return houseVerdict(snapshot, house, movers, housesByType, goods).ok;
}
