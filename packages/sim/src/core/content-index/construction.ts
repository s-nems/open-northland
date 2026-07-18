import type { BuildingType, ContentSet } from '@open-northland/data';
import type { GoodsLine } from '../../components/economy/infrastructure.js';
import { byKey } from './by-key.js';

/**
 * The per-type from-scratch construction bills
 * ({@link import('../content-index.js').ContentIndex.constructionBillByBuilding}). First-wins per typeId,
 * like the other tables (a leveled tier resolves each chain member through the first-wins views, so the
 * summed rows are the ones every other read sees).
 */
export function constructionBills(content: ContentSet): ReadonlyMap<number, readonly GoodsLine[]> {
  const prev = prevTierLinks(content.buildings);
  const buildings = byKey(content.buildings, (b) => b.typeId);
  const bills = new Map<number, readonly GoodsLine[]>();
  for (const b of content.buildings) {
    if (!bills.has(b.typeId)) bills.set(b.typeId, billOf(buildings, prev, b));
  }
  return bills;
}

/** The reverse of the `upgradeTarget` chain links: target typeId → the tier that upgrades into it.
 *  First-wins on a duplicate target (matching `byKey`), so a malformed double-link is deterministic. */
function prevTierLinks(buildings: readonly BuildingType[]): ReadonlyMap<number, number> {
  const prev = new Map<number, number>();
  for (const b of buildings) {
    if (b.upgradeTarget !== undefined && !prev.has(b.upgradeTarget)) prev.set(b.upgradeTarget, b.typeId);
  }
  return prev;
}

/** One type's from-scratch bill over the typeId-keyed building view + the reverse chain links: the
 *  tier's chain is walked DOWN to its base via `prev` and every visited tier's own cost is merged per
 *  goodType, sorted ascending; an unchained type is its own cost. The visited-set guards a malformed
 *  content cycle (a→b→a) from hanging the walk. */
function billOf(
  buildings: ReadonlyMap<number, BuildingType>,
  prev: ReadonlyMap<number, number>,
  building: BuildingType,
): readonly GoodsLine[] {
  if (!prev.has(building.typeId)) return building.construction; // a chain base / unchained type
  const merged = new Map<number, number>();
  const visited = new Set<number>();
  let tier: BuildingType | undefined = building;
  while (tier !== undefined && !visited.has(tier.typeId)) {
    visited.add(tier.typeId);
    for (const line of tier.construction) {
      merged.set(line.goodType, (merged.get(line.goodType) ?? 0) + line.amount);
    }
    const prevId = prev.get(tier.typeId);
    tier = prevId === undefined ? undefined : buildings.get(prevId);
  }
  return [...merged.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([goodType, amount]) => ({ goodType, amount }));
}

/** One typeId view + reverse-chain-link map per building list, keyed on the list's identity — a WeakMap
 *  so a dropped list frees its views with it. {@link constructionBillForType} is a per-frame path (the
 *  HUD's construction window asks every frame while a site is selected), and rebuilding the O(buildings)
 *  maps per call was that frame cost. */
const billViewCache = new WeakMap<
  readonly BuildingType[],
  { readonly byId: ReadonlyMap<number, BuildingType>; readonly prev: ReadonlyMap<number, number> }
>();

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
  let views = billViewCache.get(buildings);
  if (views === undefined) {
    views = { byId: byKey(buildings, (b) => b.typeId), prev: prevTierLinks(buildings) };
    billViewCache.set(buildings, views);
  }
  const building = views.byId.get(buildingType);
  return building === undefined ? [] : billOf(views.byId, views.prev, building);
}
