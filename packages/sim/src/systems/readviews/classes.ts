import type { ArmorType, ContentSet, WeaponType } from '@vinland/data';

// Pure, terminal **read views** for the weapon/armor **class taxonomy** — the data-defined
// predicates, field accessors, and groupings that classify the two combat tables *by the data
// alone* (the extracted `mainType`/`munitionType`/`damageType`/`materialType`/`weight`/`jobType`
// markers). No mechanic is added here (nothing is hit, no hitpoints change, no soldier equips a
// weapon); these are the data-defined seeds the deferred, oracle-blocked combat drives (ranged
// fire, siege/AoE, equip, carry-penalty) will switch on. Split out of ./combat.ts — which keeps the
// static weapon-vs-armor *damage lookup table* (`combatDamage`/`weaponKey`) — when that file grew
// past one ~300-line concern; see ./index.ts for why read views live out of systems/shared.ts.

/**
 * Whether a {@link WeaponType} is **ranged** — a weapon that fires ammunition (a bow or a catapult), as
 * opposed to a melee weapon (fist/spear/sword). The discriminator is the extracted `munitionType` being
 * **present**: in the real `weapons.ini` only the rows that fire ammo carry a `munitiontype` at all
 * (`1` = bow ammo / arrow, `2` = catapult projectile), so its mere presence is the data-pinned "this
 * weapon shoots" marker — every melee weapon leaves it `undefined`. This is the weapon-side twin of
 * `isShipVehicle` (a vehicle classified by an extracted marker), and the data-defined seed the
 * deferred ranged-attack drive will switch on (a bow's `[minRange,maxRange]` band already gates its
 * reach in `attackerWeapon`; the *fire-from-afar behavior* is the still-unbuilt, oracle-blocked half).
 *
 * FIDELITY n/a: a pure derived classification off the already-extracted `munitionType` param (see
 * {@link WeaponType.munitionType}) — it adds no mechanic and invents no data. The reading "munitionType
 * present ⇔ ranged" is the marker's documented semantics, pinned to the real data (30/105 weapons carry
 * it: the 5 bow types per tribe + the catapult). Determinism: a pure field test, no world/RNG/wall-clock.
 */
export function isRangedWeapon(weapon: WeaponType): boolean {
  return weapon.munitionType !== undefined;
}

/**
 * Whether a {@link WeaponType} is a **siege / area-damage** weapon (the catapult) — distinguished *by the
 * data alone* by carrying a `damageType` (the siege/AoE damage class, value `2` in the base data). In the
 * real `weapons.ini` only the catapult carries a `damagetype`, so its mere presence is the data-pinned
 * "this weapon deals siege/area damage" marker — every fist/spear/sword/bow leaves it `undefined`. Note a
 * siege weapon is also ranged ({@link isRangedWeapon}: the catapult's `munitiontype 2`), but the converse
 * does not hold (a bow is ranged yet not siege) — the two markers are independent classifications, so this
 * is the narrower set. The seed the deferred siege/AoE combat-resolution drive will switch on.
 *
 * FIDELITY n/a: a pure derived classification off the already-extracted `damageType` param (see
 * {@link WeaponType.damageType}). The reading "damageType present ⇔ siege" is the marker's documented
 * semantics, pinned to the real data (5/105 weapons carry it: the catapult, one per tribe). Determinism:
 * a pure field test — no world, no RNG, no wall-clock.
 */
export function isSiegeWeapon(weapon: WeaponType): boolean {
  return weapon.damageType !== undefined;
}

/**
 * The **ranged weapon types** as a derived **read view** over `content` — the bow/catapult rows that fire
 * ammunition, distinguished from melee weapons *by the data alone* ({@link isRangedWeapon}: the weapons
 * that carry a `munitiontype`). The weapon-side twin of `shipVehicles`; the data-defined seed the
 * deferred ranged-attack drive builds on, with nothing hardcoded.
 *
 * Returned as a {@link WeaponType} **array in `content.weapons` source order** — NOT keyed by `typeId` or
 * `(tribeType, typeId)`: a weapon's `typeId` recurs per tribe and even the composite pair is reused by a
 * few animal weapons (see `combatDamage`/`weaponKey` in ./combat.ts), so a keyed collection would silently
 * drop records. Source order is the same stable, lossless stance `combatDamage` keeps; the bow rows
 * already sit in a deterministic order in the IR. {@link isRangedWeapon} is the matching predicate.
 *
 * FIDELITY n/a: a pure derived read view over the already-extracted weapon IR (like `shipVehicles`
 * over vehicles) — adds no mechanic, invents no classification (the ranged/melee split is read straight
 * off the `munitionType` marker the pipeline pinned). Determinism: a pure `filter` over the plain
 * `content.weapons` array (a fresh array, so the shared content is never mutated); no world/RNG/wall-clock.
 */
export function rangedWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isRangedWeapon);
}

/**
 * The **siege weapon types** as a derived **read view** over `content` — the catapult rows that deal
 * area/siege damage, distinguished *by the data alone* ({@link isSiegeWeapon}: the weapons that carry a
 * `damagetype`). A strict subset of {@link rangedWeapons} (a catapult is also ranged), the data-defined
 * seed the deferred siege/AoE combat-resolution drive builds on.
 *
 * Returned as a {@link WeaponType} **array in `content.weapons` source order**, lossless like
 * {@link rangedWeapons} (no keyed collection — see there). {@link isSiegeWeapon} is the matching predicate.
 *
 * FIDELITY n/a: a pure derived read view over the already-extracted weapon IR — adds no mechanic, invents
 * no classification (read straight off the `damageType` marker the pipeline pinned). Determinism: a pure
 * `filter` over the plain `content.weapons` array (a fresh array); no world, no RNG, no wall-clock.
 */
export function siegeWeapons(content: ContentSet): WeaponType[] {
  return content.weapons.filter(isSiegeWeapon);
}

/**
 * A {@link WeaponType}'s **coarse weapon class** — its extracted `mainType` (`1..7` in the base data:
 * fist/club/sword/axe/spear/bow/catapult), or `undefined` if the row carries none. The weapon-side twin
 * of `ArmorType.mainType`, and the last of the three weapon class markers (alongside `munitionType`'s
 * ranged marker and `damageType`'s siege marker) to get a read-side accessor.
 *
 * Unlike {@link isRangedWeapon}/{@link isSiegeWeapon} — *presence* markers that are absent on most
 * weapons, so each yields a binary classification — `mainType` is a **multi-valued** class enum carried
 * by *every* weapon (all 105 real rows have one, spread across all 7 classes), so its read view is a
 * *grouping* ({@link weaponsByClass}), not a filter. This accessor is the field reader the grouping (and
 * the deferred soldier-class→weapon-class roster binding) keys on — captured ahead of that drive.
 *
 * FIDELITY n/a: a pure field accessor over the already-extracted `mainType` param (see
 * {@link WeaponType.mainType}) — it adds no mechanic and invents no data. Determinism: a pure field
 * read — no world, no RNG, no wall-clock.
 */
export function weaponClassOf(weapon: WeaponType): number | undefined {
  return weapon.mainType;
}

/**
 * A {@link WeaponType}'s **encumbrance weight** — its extracted `weight` (`0..2` in the base data: a
 * fist/dagger weighs `0`, most weapons `1`, the heaviest `2`), the weapon-side twin of
 * {@link armorWeightOf}. The last extracted weapon-table field to get a read-side accessor, completing
 * the weapon-record consumer coverage (its siblings — `mainType` via {@link weaponClassOf},
 * `munitionType`/`damageType` via {@link isRangedWeapon}/{@link isSiegeWeapon}, `jobType` via
 * {@link weaponsByJob}, `goodType` via the good join, `damage` via `combatDamage` in ./combat.ts —
 * already read). It is the per-weapon load a deferred carry/movement-penalty drive would read to slow a
 * laden soldier; captured ahead of that drive.
 *
 * Unlike the class-enum fields ({@link weaponClassOf}'s `mainType`, which is `undefined` when absent),
 * `weight` is a quantity the schema **defaults to `0`** (`z.number().int().nonnegative().default(0)`),
 * so this returns a plain `number` — never `undefined`. A weapon that adds no encumbrance reads `0`, the
 * same value the source carries (44/105 real weapons weigh `0`), so there is no "no record" sentinel to
 * distinguish: `0` *is* weightless.
 *
 * FIDELITY n/a: a pure field accessor over the already-extracted `weight` param (see
 * {@link WeaponType.weight}) — it adds no mechanic and invents no data (the `{0,1,2}` magnitudes are the
 * faithful `weapons.ini` values the pipeline pinned). Determinism: a pure field read — no world, no RNG,
 * no wall-clock.
 */
export function weaponWeightOf(weapon: WeaponType): number {
  return weapon.weight;
}

/**
 * The weapons **grouped by their coarse class** ({@link weaponClassOf}: the extracted `mainType`) as a
 * derived **read view** over `content` — `Map<mainType, WeaponType[]>`, one bucket per class a weapon
 * carries, classifying `content.weapons` *by the data alone*. The multi-valued counterpart of the
 * binary {@link rangedWeapons}/{@link siegeWeapons} filters: `mainType` is a class enum every weapon
 * carries (1..7), so the natural view partitions the table rather than selecting a subset.
 *
 * Each bucket is a {@link WeaponType} **array in `content.weapons` source order** — lossless like
 * {@link rangedWeapons} (a weapon's `(tribeType, typeId)` isn't unique, so the *values* must be arrays,
 * never a keyed collection; see `combatDamage` in ./combat.ts). Weapons with **no `mainType`** are omitted
 * (no `undefined` bucket) — in the real data every row carries one, so this only drops a malformed/partial
 * fixture row. The Map's KEY space (the distinct classes) is the only thing keyed; the values lose no
 * record.
 *
 * The returned Map's iteration order is **insertion order** = first-appearance of each class in
 * `content.weapons` (NOT ascending by class id) — the [cef9629] idiom: a `Map`-valued read view may be
 * built by a single non-canonical pass because its values are order-independent *per bucket* (each
 * bucket preserves source order by construction, and which bucket a weapon lands in never depends on
 * visit order), and no system reads it back to branch on a game decision. A display consumer that wants
 * the classes in id order must **sort the keys itself**.
 *
 * FIDELITY n/a: a pure derived read view over the already-extracted weapon IR (like `shipVehicles` over
 * vehicles) — adds no mechanic, invents no classification (the class split is read straight off the
 * `mainType` marker the pipeline pinned). Determinism: a single pass over the plain `content.weapons`
 * array building a fresh Map (the shared content is never mutated); no world, no RNG, no wall-clock —
 * so the same content yields a byte-identical grouping every call.
 */
export function weaponsByClass(content: ContentSet): Map<number, WeaponType[]> {
  const byClass = new Map<number, WeaponType[]>();
  for (const weapon of content.weapons) {
    const cls = weaponClassOf(weapon);
    if (cls === undefined) continue; // a malformed/partial row with no class — drop it (real data has none)
    const bucket = byClass.get(cls);
    if (bucket === undefined) byClass.set(cls, [weapon]);
    else bucket.push(weapon);
  }
  return byClass;
}

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
 * FIDELITY n/a: a pure field accessor over the already-extracted `mainType` param (see
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
 * FIDELITY n/a: a pure derived read view over the already-extracted armor IR (like {@link weaponsByClass}
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
 * FIDELITY n/a: a pure field accessor over the already-extracted `materialType` param (see
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
 * FIDELITY n/a: a pure field accessor over the already-extracted `weight` param (see
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
 * FIDELITY n/a: a pure derived read view over the already-extracted armor IR (like {@link armorByClass}
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

/**
 * The weapons **grouped by the job (soldier-class) that wields them** ({@link WeaponType.jobType}) as a
 * derived **read view** over `content` — `Map<jobType, WeaponType[]>`, one bucket per wielding job,
 * classifying `content.weapons` *by the data alone*. This is the data-defined **soldier-class→weapon
 * roster join** the roadmap names as the deferred combat-roster slice's prerequisite: each
 * `[weapontype]` carries a `jobtype` naming the job that fights with it (`jobtype 31` = the unarmed
 * fist-fighter, `jobtype 6` = a swordsman, etc.), so this view answers "which weapons does soldier-class
 * N wield" without inventing or hardcoding a single binding. The *equip behavior* (a settler of that
 * job actually holding the weapon) is the still-unbuilt, oracle-blocked drive — this is only its lookup.
 *
 * Unlike {@link weaponsByClass}'s key — `mainType`, a coarse class enum carried by the weapon itself —
 * `jobType` is a **cross-reference** into the jobs table (validated by `parseContentSet`, so every key
 * here resolves to a real `[jobtype]`). It is a many-to-one join exactly like `mainType` (one job wields
 * several weapons across the tribes — `jobtype 31` covers 7 records), so the natural view groups the
 * table rather than selecting a subset, and the **values stay arrays** (the grouping-key cardinality
 * dictates that, per docs/LESSONS.md `[c0dcbcb]`, not the weapon's own non-unique `(tribeType,typeId)`).
 *
 * Each bucket is a {@link WeaponType} **array in `content.weapons` source order** — lossless like
 * {@link weaponsByClass} (a weapon's `(tribeType, typeId)` isn't globally unique, so the values must be
 * arrays, never a keyed collection; see `combatDamage` in ./combat.ts). Weapons with **no `jobType`** are
 * omitted (no `undefined` bucket) — in the real data every weapon carries one (no `jobtype 0` sentinel),
 * so this only drops a malformed/partial fixture row, the same drop-undefined stance as
 * {@link weaponsByClass}.
 *
 * The returned Map's iteration order is **insertion order** = first-appearance of each job in
 * `content.weapons` (NOT ascending by job id) — the same `[cef9629]` idiom {@link weaponsByClass} uses: a
 * `Map`-valued read view may be built by a single non-canonical pass because its values are
 * order-independent *per bucket* (each bucket preserves source order, and which bucket a weapon lands in
 * never depends on visit order), and no system reads it back to branch on a game decision. A display
 * consumer that wants the jobs in id order must **sort the keys itself**.
 *
 * FIDELITY n/a: a pure derived read view over the already-extracted weapon IR (like {@link weaponsByClass}
 * over weapons) — adds no mechanic, invents no classification (the wielding job is read straight off the
 * `jobtype` cross-ref the pipeline pinned and cross-ref-validated). Determinism: a single pass over the
 * plain `content.weapons` array building a fresh Map (the shared content is never mutated); no world, no
 * RNG, no wall-clock — so the same content yields a byte-identical grouping every call.
 */
export function weaponsByJob(content: ContentSet): Map<number, WeaponType[]> {
  const byJob = new Map<number, WeaponType[]>();
  for (const weapon of content.weapons) {
    const job = weapon.jobType;
    if (job === undefined) continue; // a malformed/partial row with no wielding job — drop it (real data has none)
    const bucket = byJob.get(job);
    if (bucket === undefined) byJob.set(job, [weapon]);
    else bucket.push(weapon);
  }
  return byJob;
}

/**
 * The weapons a single job (soldier-class) wields — the per-job slice of {@link weaponsByJob}: every
 * {@link WeaponType} whose `jobType` equals `job`, in `content.weapons` source order. Answers "what does
 * soldier-class `job` fight with" directly without materializing the whole grouping; the data-defined
 * roster lookup the deferred equip drive joins on (it adds no equip behavior — that drive is
 * oracle-blocked). Returns a fresh array (empty if no weapon names `job`), so the shared content is never
 * mutated.
 *
 * FIDELITY n/a: a pure derived `filter` over the already-extracted, cross-ref-validated `jobType` param —
 * adds no mechanic, invents no data. Determinism: a pure filter over the plain `content.weapons` array;
 * no world, no RNG, no wall-clock.
 */
export function weaponsForJob(content: ContentSet, job: number): WeaponType[] {
  return content.weapons.filter((w) => w.jobType === job);
}
