import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  familiesByHome,
  type HomeFamily,
  isBuilding,
  ownerPlayerOf,
  ownerTribeKeyOf,
  residenceHomeOf,
  type SnapshotEntity,
  settlersIn,
} from '../../../game/snapshot.js';

/** `homeSize` (the original `logichomesize`, 1..5 by level) counts FAMILIES, not settlers. */
export interface HouseInfo {
  readonly kind?: string | undefined;
  readonly homeSize?: number | undefined;
}

/**
 * The selected members a group home order moves, counted by owner and tribe, as the sim's
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
    const key = ownerTribeKeyOf(e);
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
  house: SnapshotEntity,
  movers: Movers,
  families: ReadonlyMap<number, readonly HomeFamily[]>,
  housesByType: ReadonlyMap<number, HouseInfo>,
): { readonly candidate: boolean; readonly ok: boolean } {
  if (!isBuilding(house)) return { candidate: false, ok: false };
  const typeId = buildingTypeOf(house);
  const info = typeId !== undefined ? housesByType.get(typeId) : undefined;
  if (info?.kind !== 'home' || !movers.owners.has(ownerPlayerOf(house))) {
    return { candidate: false, ok: false };
  }
  const key = ownerTribeKeyOf(house);
  const moving = (movers.byKey.get(key) ?? 0) - (movers.livingAt.get(house.id)?.get(key) ?? 0);
  const free = (families.get(house.id)?.length ?? 0) < (info.homeSize ?? 0);
  return { candidate: true, ok: moving > 0 && free };
}

/**
 * The highlight verdicts for a selected group over every own home: green when it has a free family slot
 * for a member the order would move. Known gap: signpost confinement is not mirrored, so an out-of-area
 * home can still wash green.
 */
export function computeHouseHighlight(
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  housesByType: ReadonlyMap<number, HouseInfo>,
): BuildingHighlightItem[] {
  const movers = moversOf(snapshot, settlerIds);
  if (movers === null) return [];
  const families = familiesByHome(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    const { candidate, ok } = houseVerdict(e, movers, families, housesByType);
    if (candidate) items.push({ id: e.id, ok });
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
): boolean {
  const house = entityById(snapshot, buildingId);
  const movers = moversOf(snapshot, settlerIds);
  if (house === undefined || movers === null) return false;
  return houseVerdict(house, movers, familiesByHome(snapshot), housesByType).ok;
}
