import type { ContentSet } from '@open-northland/data';

/** The livestock join tables - see {@link livestockTables}. */
export interface LivestockTables {
  /** `catchable` animal tribeType → the stocked good representing one fed animal of that species. */
  readonly goodByTribe: ReadonlyMap<number, number>;
  /** Reverse of {@link goodByTribe}: livestock goodType → the species' animal tribeType. */
  readonly tribeByGood: ReadonlyMap<number, number>;
  /** Building typeIds with a FEED recipe (a recipe whose product is a livestock good) - the
   *  workplaces claimed livestock is herded to and processed at. */
  readonly workplaceTypes: ReadonlySet<number>;
  /** The feed-cycle byproduct ware - the `meat` good, resolved by slug (the sandbox catalog rides an
   *  id offset over `goodtypes.ini`, so a numeric pin would miss it there). Null without a meat good. */
  readonly meatGood: number | null;
}

/**
 * The species⇄good join behind husbandry: the original stocks a FED animal as a good (`goodtypes.ini`
 * `sheep` 57 / `cattle` 58, produced from grain+water by the animal farm's feed recipes), while the
 * live creature is an `animaltypes.ini` record keyed by tribe. No numeric link exists in the readable
 * data, but both sides carry the same species slug (good id `sheep` = tribe id `sheep`), so the join
 * is by that name (approximation: a slug join over the base data's own naming). Only `catchable`
 * species join, the two the original lets a scout claim (cow 10, sheep 19). First-wins per key on both
 * sides.
 */
export function livestockTables(content: ContentSet): LivestockTables {
  const goodBySlug = new Map<string, number>();
  for (const g of content.goods) if (!goodBySlug.has(g.id)) goodBySlug.set(g.id, g.typeId);
  const slugByTribe = new Map<number, string>();
  for (const t of content.tribes) if (!slugByTribe.has(t.typeId)) slugByTribe.set(t.typeId, t.id);

  const goodByTribe = new Map<number, number>();
  const tribeByGood = new Map<number, number>();
  for (const a of content.animals) {
    if (!a.catchable || goodByTribe.has(a.tribeType)) continue;
    const slug = slugByTribe.get(a.tribeType);
    const good = slug === undefined ? undefined : goodBySlug.get(slug);
    if (good === undefined || tribeByGood.has(good)) continue;
    goodByTribe.set(a.tribeType, good);
    tribeByGood.set(good, a.tribeType);
  }

  const workplaceTypes = new Set<number>();
  const seen = new Set<number>();
  for (const b of content.buildings) {
    if (seen.has(b.typeId)) continue;
    seen.add(b.typeId);
    const feeds = b.recipes.some((r) => {
      const product = r.outputs[0]?.goodType;
      return product !== undefined && tribeByGood.has(product);
    });
    if (feeds) workplaceTypes.add(b.typeId);
  }
  return { goodByTribe, tribeByGood, workplaceTypes, meatGood: goodBySlug.get('meat') ?? null };
}
