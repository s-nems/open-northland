import type { ContentSet } from '@open-northland/data';

/** The livestock join tables - see {@link livestockTables}. */
export interface LivestockTables {
  /** `catchable` animal tribeType → its species good, the farm's breeding product and herd row. */
  readonly goodByTribe: ReadonlyMap<number, number>;
  /** Reverse of {@link goodByTribe}: species goodType → the species' animal tribeType. */
  readonly tribeByGood: ReadonlyMap<number, number>;
  /** Building typeIds with a breeding recipe (a recipe whose product is a species good) - the farms a
   *  claimed herd attaches to. */
  readonly workplaceTypes: ReadonlySet<number>;
  /** Species good → the breeder atomic that slaughters one of its adults. */
  readonly slayAtomicByGood: ReadonlyMap<number, number>;
}

/**
 * The species⇄good join behind husbandry: the original counts a farm's herd in the `sheep` 57 /
 * `cattle` 58 stock rows its breeders produce from grain+water, while the live creature is an
 * `animaltypes.ini` record keyed by tribe. No numeric link exists in the readable data, but both sides
 * carry the same species slug (good id `sheep` = tribe id `sheep`), so the join is by that name
 * (approximation: a slug join over the base data's own naming). Only `catchable` species join, the two
 * the original lets a scout claim (cow 10, sheep 19). First-wins per key on both sides.
 *
 * The slaughter atomic rides the same slug: the breeder binds `setatomic 16 87 "<tribe>_breeder_slay_sheep"`
 * and `88 "..._slay_cattle"`, and the engine picks 87 or 88 by species in code, so the clip name is the
 * only readable link (approximation).
 */
export function livestockTables(content: ContentSet): LivestockTables {
  const goodBySlug = new Map<string, number>();
  for (const g of content.goods) if (!goodBySlug.has(g.id)) goodBySlug.set(g.id, g.typeId);
  const slugByTribe = new Map<number, string>();
  for (const t of content.tribes) if (!slugByTribe.has(t.typeId)) slugByTribe.set(t.typeId, t.id);

  const goodByTribe = new Map<number, number>();
  const tribeByGood = new Map<number, number>();
  const slugByGood = new Map<number, string>();
  for (const a of content.animals) {
    if (!a.catchable || goodByTribe.has(a.tribeType)) continue;
    const slug = slugByTribe.get(a.tribeType);
    const good = slug === undefined ? undefined : goodBySlug.get(slug);
    if (slug === undefined || good === undefined || tribeByGood.has(good)) continue;
    goodByTribe.set(a.tribeType, good);
    tribeByGood.set(good, a.tribeType);
    slugByGood.set(good, slug);
  }

  const workplaceTypes = new Set<number>();
  const seen = new Set<number>();
  for (const b of content.buildings) {
    if (seen.has(b.typeId)) continue;
    seen.add(b.typeId);
    const breeds = b.recipes.some((r) => {
      const product = r.outputs[0]?.goodType;
      return product !== undefined && tribeByGood.has(product);
    });
    if (breeds) workplaceTypes.add(b.typeId);
  }

  const slayAtomicByGood = new Map<number, number>();
  for (const tribe of content.tribes) {
    for (const binding of tribe.atomicBindings) {
      for (const [good, slug] of slugByGood) {
        if (slayAtomicByGood.has(good) || !binding.animation.endsWith(`${SLAY_CLIP_INFIX}${slug}`)) continue;
        slayAtomicByGood.set(good, binding.atomicId);
      }
    }
  }
  return { goodByTribe, tribeByGood, workplaceTypes, slayAtomicByGood };
}

/** The clip-name part before the species slug in every tribe's `<tribe>_breeder_slay_<species>`. */
const SLAY_CLIP_INFIX = '_slay_';
