import type { BuildingType, ContentSet } from '@open-northland/data';
import type { GoodsLine } from '../../components/economy/infrastructure.js';
import { byKey } from './by-key.js';

/**
 * The per-type from-scratch construction bills
 * ({@link import('../content-index.js').ContentIndex.constructionBillByBuilding}). First-wins per typeId,
 * like the other tables (a home tier resolves each chain member through the first-wins `byKey` view, so the
 * summed rows are the ones every other read sees).
 */
export function constructionBills(content: ContentSet): ReadonlyMap<number, readonly GoodsLine[]> {
  const buildings = byKey(content.buildings, (b) => b.typeId);
  const bills = new Map<number, readonly GoodsLine[]>();
  for (const b of content.buildings) {
    if (!bills.has(b.typeId)) bills.set(b.typeId, billOf(buildings, b));
  }
  return bills;
}

/** One type's from-scratch bill over a typeId-keyed building view: a home's chain base is found by
 *  walking the consecutive `home` typeIds downward (the mirror of `homeNextTier`'s upward walk), and
 *  the tiers' costs are merged per goodType and sorted ascending; any other kind is its own cost. */
function billOf(buildings: ReadonlyMap<number, BuildingType>, building: BuildingType): readonly GoodsLine[] {
  if (building.kind !== 'home') return building.construction;
  let base = building.typeId;
  while (buildings.get(base - 1)?.kind === 'home') base -= 1;
  const merged = new Map<number, number>();
  for (let typeId = base; typeId <= building.typeId; typeId++) {
    for (const line of buildings.get(typeId)?.construction ?? []) {
      merged.set(line.goodType, (merged.get(line.goodType) ?? 0) + line.amount);
    }
  }
  return [...merged.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([goodType, amount]) => ({ goodType, amount }));
}

/** One typeId view per building list, keyed on the list's identity — a WeakMap so a dropped list frees its
 *  view with it. {@link constructionBillForType} is a per-frame path (the HUD's construction window asks
 *  every frame while a site is selected), and rebuilding an O(buildings) map per call was that frame cost. */
const billViewCache = new WeakMap<readonly BuildingType[], ReadonlyMap<number, BuildingType>>();

/**
 * The from-scratch construction bill of one `buildingType` over a plain building list — the pure
 * content-level accessor for a consumer holding building defs but no `ContentSet` (the HUD's
 * construction window shows the same delivered/needed rows the sim demands). Empty for an unknown
 * type. The same math as {@link import('../content-index.js').ContentIndex.constructionBillByBuilding};
 * sim systems read that memoized table instead.
 */
export function constructionBillForType(
  buildings: readonly BuildingType[],
  buildingType: number,
): readonly GoodsLine[] {
  let byId = billViewCache.get(buildings);
  if (byId === undefined) {
    byId = byKey(buildings, (b) => b.typeId);
    billViewCache.set(buildings, byId);
  }
  const building = byId.get(buildingType);
  return building === undefined ? [] : billOf(byId, building);
}
