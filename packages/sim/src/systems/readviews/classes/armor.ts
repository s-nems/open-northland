import type { ArmorType, ContentSet } from '@open-northland/data';

/**
 * An {@link ArmorType}'s coarse armor class — its extracted `mainType` (`1` = light/cloth+leather, `2` =
 * heavy/chain+plate), or `undefined` if the record carries none. The armor-side twin of {@link weaponClassOf}.
 *
 * A different axis from the `armorClass` the `combatDamage` join (./combat.ts) keys on: that join key is the
 * armor's `typeId` (the per-record `damagevalue <armorClass>` index, `1..N`), whereas `mainType` is the
 * coarse material-tier class several records share (`armortypes.ini` ships four records with `mainType`
 * `{1,1,2,2}`). `mainType` is a multi-valued class enum carried by every record, so its read view is a
 * grouping ({@link armorByClass}), not a filter.
 */
export function armorClassOf(armor: ArmorType): number | undefined {
  return armor.mainType;
}

/**
 * The armor records grouped by their coarse class ({@link armorClassOf}: the extracted `mainType`) —
 * `Map<mainType, ArmorType[]>`, one bucket per class. The armor-side twin of {@link weaponsByClass}.
 *
 * Each bucket is an {@link ArmorType} array in `content.armor` source order. Unlike a weapon's
 * `(tribeType, typeId)` — which recurs, forcing array values — an armor's `typeId` is globally unique (the
 * `armortypes.ini` is a flat 1..N table), so a record could be keyed; we still return arrays so the shape
 * matches {@link weaponsByClass} and several records sharing a `mainType` coexist (two per class in the real
 * data). Records with no `mainType` are omitted; real data has none, so this only drops a malformed row.
 *
 * The Map's iteration order is insertion order = first-appearance of each class (not ascending by class id),
 * the same idiom as {@link weaponsByClass}: order-independent per bucket, no system branches a game decision
 * on it. A display consumer wanting id order must sort the keys itself.
 */
export function armorByClass(content: ContentSet): Map<number, ArmorType[]> {
  const byClass = new Map<number, ArmorType[]>();
  for (const armor of content.armor) {
    const cls = armorClassOf(armor);
    if (cls === undefined) continue; // no class — drop it (real data has none)
    const bucket = byClass.get(cls);
    if (bucket === undefined) byClass.set(cls, [armor]);
    else bucket.push(armor);
  }
  return byClass;
}

/**
 * An {@link ArmorType}'s material tier — its extracted `materialType` (`1` = cloth, `2` = leather, `3` =
 * chain, `4` = plate), or `undefined` if the record carries none. A finer axis than {@link armorClassOf}'s
 * coarse `mainType`: where `mainType` collapses the four base records into two classes (light `{1,1}` / heavy
 * `{2,2}`), `materialType` distinguishes all four (`{1,2,3,4}`), the granular material identity the deferred
 * soldier-class→armor-tier binding joins on.
 */
export function armorMaterialOf(armor: ArmorType): number | undefined {
  return armor.materialType;
}

/**
 * An {@link ArmorType}'s encumbrance weight — its extracted `weight` (leather 0, cloth 1, chain/plate 3), the
 * armor-side twin of {@link weaponWeightOf}. The per-armor load a deferred movement-penalty drive would read
 * to slow a heavily-armored soldier.
 *
 * The schema defaults `weight` to 0 (`.default(0)`), so this returns a plain `number`, never `undefined`:
 * weightless armor reads 0 (the leather record), the same value the source carries — no "no record" sentinel.
 * A different axis from the material tier ({@link armorMaterialOf}): the tiers do not map monotonically to
 * weight (leather tier 2 weighs 0 while cloth tier 1 weighs 1), so weight is its own field.
 */
export function armorWeightOf(armor: ArmorType): number {
  return armor.weight;
}

/**
 * The armor records grouped by their material tier ({@link armorMaterialOf}: the extracted `materialType`) —
 * `Map<materialType, ArmorType[]>`, one bucket per tier. The finer-grained sibling of {@link armorByClass}:
 * where the coarse `mainType` collapses the four base records into two buckets, `materialType` splits them
 * into four singletons (`{1,2,3,4}` — cloth/leather/chain/plate).
 *
 * Each bucket is an {@link ArmorType} array in `content.armor` source order — kept as arrays so the shape
 * matches {@link armorByClass} and several records sharing a tier coexist (the base data has one per tier,
 * but a richer mod could ship several). Records with no `materialType` are omitted (real data has none).
 *
 * The Map's iteration order is insertion order, not ascending by tier id (same idiom as {@link armorByClass});
 * a consumer wanting id order must sort the keys itself.
 */
export function armorByMaterial(content: ContentSet): Map<number, ArmorType[]> {
  const byMaterial = new Map<number, ArmorType[]>();
  for (const armor of content.armor) {
    const tier = armorMaterialOf(armor);
    if (tier === undefined) continue; // no material tier — drop it (real data has none)
    const bucket = byMaterial.get(tier);
    if (bucket === undefined) byMaterial.set(tier, [armor]);
    else bucket.push(armor);
  }
  return byMaterial;
}
