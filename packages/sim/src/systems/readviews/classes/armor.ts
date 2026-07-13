import type { ArmorType, ContentSet } from '@vinland/data';

/**
 * An {@link ArmorType}'s **coarse armor class** — its extracted `mainType` (`1` = light/cloth+leather,
 * `2` = heavy/chain+plate in the base data), or `undefined` if the record carries none. The armor-side
 * twin of {@link weaponClassOf}, completing the class-marker symmetry across the two combat tables.
 *
 * Note this is a *different* axis from the `armorClass` the `combatDamage` join (./combat.ts) keys on: that
 * join key is the armor's `typeId` (the per-record `damagevalue <armorClass>` index, `1..N`), whereas
 * `mainType` is the **coarse material-tier class** several records share (the real `armortypes.ini` ships
 * four records with `mainType` `{1,1,2,2}` — two light, two heavy). `mainType` is a multi-valued class
 * enum carried by every armor record, so its read view is a *grouping* ({@link armorByClass}), not a
 * filter — exactly as `mainType` partitions the weapon table.
 *
 * source-basis n/a: a pure field accessor over the already-extracted `mainType` param (see
 * {@link ArmorType.mainType}) — it adds no mechanic and invents no data. Determinism: a pure field read —
 * no world, no RNG, no wall-clock.
 */
export function armorClassOf(armor: ArmorType): number | undefined {
  return armor.mainType;
}

/**
 * The armor records **grouped by their coarse class** ({@link armorClassOf}: the extracted `mainType`) as
 * a derived **read view** over `content` — `Map<mainType, ArmorType[]>`, one bucket per class an armor
 * record carries, classifying `content.armor` *by the data alone*. The armor-side twin of
 * {@link weaponsByClass}: `mainType` is a class enum every armor record carries (`1` light / `2` heavy in
 * the base data), so the natural view partitions the table rather than selecting a subset.
 *
 * Each bucket is an {@link ArmorType} **array in `content.armor` source order**. Unlike a weapon's
 * `(tribeType, typeId)` — which recurs/reuses, forcing array values (see `combatDamage` in ./combat.ts) —
 * an armor's `typeId` IS globally unique (the readable `armortypes.ini` is a flat 1..N table, not
 * per-tribe; see {@link ArmorType.typeId}), so a record could in principle be keyed; we still return arrays
 * so the shape matches {@link weaponsByClass} exactly and several records sharing a `mainType` coexist (the
 * real data has two per class). Records with **no `mainType`** are omitted (no `undefined` bucket) — in the
 * real data every record carries one, so this only drops a malformed/partial fixture row.
 *
 * The returned Map's iteration order is **insertion order** = first-appearance of each class in
 * `content.armor` (NOT ascending by class id) — the same [cef9629] idiom {@link weaponsByClass} uses: a
 * `Map`-valued read view may be built by a single non-canonical pass because its values are
 * order-independent *per bucket* (each bucket preserves source order, and which bucket a record lands in
 * never depends on visit order), and no system reads it back to branch on a game decision. A display
 * consumer that wants the classes in id order must **sort the keys itself**.
 *
 * source-basis n/a: a pure derived read view over the already-extracted armor IR (like {@link weaponsByClass}
 * over weapons) — adds no mechanic, invents no classification (the class split is read straight off the
 * `mainType` marker the pipeline pinned). Determinism: a single pass over the plain `content.armor` array
 * building a fresh Map (the shared content is never mutated); no world, no RNG, no wall-clock — so the
 * same content yields a byte-identical grouping every call.
 */
export function armorByClass(content: ContentSet): Map<number, ArmorType[]> {
  const byClass = new Map<number, ArmorType[]>();
  for (const armor of content.armor) {
    const cls = armorClassOf(armor);
    if (cls === undefined) continue; // a malformed/partial record with no class — drop it (real data has none)
    const bucket = byClass.get(cls);
    if (bucket === undefined) byClass.set(cls, [armor]);
    else bucket.push(armor);
  }
  return byClass;
}

/**
 * An {@link ArmorType}'s **material tier** — its extracted `materialType` (`1` = cloth/wool, `2` =
 * leather, `3` = chain, `4` = plate in the base data), or `undefined` if the record carries none. A
 * **finer** axis than {@link armorClassOf}'s coarse `mainType`: where `mainType` collapses the four
 * base records into two classes (light `{1,1}` / heavy `{2,2}`), `materialType` distinguishes all four
 * (`{1,2,3,4}` — one tier per record), so it is the granular material identity the deferred
 * soldier-class→armor-tier binding joins on, the last extracted armor field to get a read accessor
 * (the others — `mainType`/`blockingValue`/`goodType`/`typeId` — already have one).
 *
 * source-basis n/a: a pure field accessor over the already-extracted `materialType` param (see
 * {@link ArmorType.materialType}) — it adds no mechanic and invents no data. Determinism: a pure field
 * read — no world, no RNG, no wall-clock.
 */
export function armorMaterialOf(armor: ArmorType): number | undefined {
  return armor.materialType;
}

/**
 * An {@link ArmorType}'s **encumbrance weight** — its extracted `weight` (in the base data leather
 * weighs `0`, cloth `1`, chain/plate `3`), the armor-side twin of {@link weaponWeightOf}, completing the
 * weight-field consumer coverage across both combat tables. The per-armor load a deferred
 * movement-penalty drive would read to slow a heavily-armored soldier; captured ahead of that drive.
 *
 * Like {@link weaponWeightOf} — and unlike the class-enum fields {@link armorClassOf}/
 * {@link armorMaterialOf}, which are `undefined` when absent — `weight` is a quantity the schema
 * **defaults to `0`** (`z.number().int().nonnegative().default(0)`), so this returns a plain `number`,
 * never `undefined`. Armor that adds no encumbrance reads `0` (the real leather record), the same value
 * the source carries, so there is no "no record" sentinel: `0` *is* weightless. Note this is a different
 * axis from the material *tier* ({@link armorMaterialOf}): the real data's distinct tiers do not map
 * monotonically to weight (leather tier `2` weighs `0` while cloth tier `1` weighs `1`), so weight is its
 * own field, not derivable from the tier.
 *
 * source-basis n/a: a pure field accessor over the already-extracted `weight` param (see
 * {@link ArmorType.weight}) — it adds no mechanic and invents no data (the `{0,1,3,3}` magnitudes are the
 * faithful `armortypes.ini` values the pipeline pinned). Determinism: a pure field read — no world, no
 * RNG, no wall-clock.
 */
export function armorWeightOf(armor: ArmorType): number {
  return armor.weight;
}

/**
 * The armor records **grouped by their material tier** ({@link armorMaterialOf}: the extracted
 * `materialType`) as a derived **read view** over `content` — `Map<materialType, ArmorType[]>`, one
 * bucket per tier an armor record carries, classifying `content.armor` *by the data alone*. The
 * **finer-grained** sibling of {@link armorByClass}: `materialType` is a class enum every armor record
 * carries, but where the coarse `mainType` collapses the four base records into two buckets (two light
 * + two heavy), `materialType` splits them into four singleton buckets (`{1,2,3,4}` — cloth/leather/
 * chain/plate), so the same content yields a different, finer partition along the material axis.
 *
 * Each bucket is an {@link ArmorType} **array in `content.armor` source order** — kept as arrays so the
 * shape matches {@link armorByClass}/{@link weaponsByClass} exactly and several records sharing a tier
 * coexist (the base data has one record per tier, but a richer mod could ship several). Records with
 * **no `materialType`** are omitted (no `undefined` bucket) — in the real data every record carries one,
 * so this only drops a malformed/partial fixture row, the same drop-undefined stance as
 * {@link armorByClass}.
 *
 * The returned Map's iteration order is **insertion order** = first-appearance of each tier in
 * `content.armor` (NOT ascending by tier id) — the same `[cef9629]` idiom {@link armorByClass} uses: a
 * `Map`-valued read view may be built by a single non-canonical pass because its values are
 * order-independent *per bucket* (each bucket preserves source order, and which bucket a record lands in
 * never depends on visit order), and no system reads it back to branch on a game decision. A display
 * consumer that wants the tiers in id order must **sort the keys itself**.
 *
 * source-basis n/a: a pure derived read view over the already-extracted armor IR (like {@link armorByClass}
 * over the same table) — adds no mechanic, invents no classification (the tier split is read straight off
 * the `materialType` marker the pipeline pinned). Determinism: a single pass over the plain
 * `content.armor` array building a fresh Map (the shared content is never mutated); no world, no RNG, no
 * wall-clock — so the same content yields a byte-identical grouping every call.
 */
export function armorByMaterial(content: ContentSet): Map<number, ArmorType[]> {
  const byMaterial = new Map<number, ArmorType[]>();
  for (const armor of content.armor) {
    const tier = armorMaterialOf(armor);
    if (tier === undefined) continue; // a malformed/partial record with no material tier — drop it (real data has none)
    const bucket = byMaterial.get(tier);
    if (bucket === undefined) byMaterial.set(tier, [armor]);
    else bucket.push(armor);
  }
  return byMaterial;
}
