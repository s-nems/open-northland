import type { ArmorType, ContentSet, WeaponType } from '@vinland/data';

// Pure, terminal **read views** for combat — the static weapon-vs-armor damage *lookup* table the
// CombatSystem reads. No mechanic is added here (nothing is hit, no hitpoints change); see ./index.ts
// for why read views are grouped out of systems/shared.ts.

/**
 * One row of the {@link combatDamage} view — a single weapon resolved against **one** armor class:
 * how much damage it lands on a target wearing that armor.
 */
export interface CombatDamageRow {
  /** The target's armor class — the key the original's `damagevalue <armorClass> <value>` uses.
   *  Class `0` = **unarmored** (a bare target, no `[armortype]` record). */
  armorClass: number;
  /** The weapon's listed damage against this armor class (`WeaponType.damage["<armorClass>"]`), i.e.
   *  the raw per-class value the original `weapontypes` table pre-tabulates. `0` if the weapon lists
   *  no value for this class (it does the target no harm). */
  rawDamage: number;
  /** The mitigation the target's armor subtracts (`ArmorType.blockingValue` for `armorClass`). `0`
   *  for an unarmored class (`0`) and for a class with **no `[armortype]` record** (the higher tiers
   *  `6`/`7` the real `weapontypes` references but `armortypes.ini` doesn't define) — those are treated
   *  as unarmored rather than crashing, the KNOWN GAP the roadmap names. */
  blockingValue: number;
  /** The **net** damage actually dealt: `max(0, rawDamage - blockingValue)`. Clamped at `0` so a
   *  target's armor can fully absorb a weak hit but never *heals* the target (no negative damage). */
  netDamage: number;
  /** Whether `armorClass` has a real `[armortype]` record (`1..4` in the base data). `false` for the
   *  unarmored class `0` and for an out-of-table class (`6`/`7`) — both resolve as unarmored
   *  (`blockingValue 0`); the flag lets a consumer tell "bare target" from "undefined armor tier". */
  hasArmorRecord: boolean;
}

/**
 * One weapon's combat profile in the {@link combatDamage} view — its identity (the composite
 * `(tribeType, typeId)`, exactly as the cross-ref system keys `weapontypes`, plus the `id` slug for
 * display) and its resolved {@link CombatDamageRow}s, one per armor class it can target.
 */
export interface CombatProfile {
  /** Owning tribe (`WeaponType.tribeType`) — part of the canonical `(tribeType, typeId)` identity. */
  tribeType: number | undefined;
  /** The weapon's `typeId` — NOT globally unique on its own (recurs per tribe); paired with
   *  `tribeType` for identity, and even that pair is reused for a few animal weapons (see the fn doc). */
  typeId: number;
  /** The weapon's `id` slug (`"fist"`, `"wooden_spear"`, …) — also not globally unique. */
  id: string;
  /** The composite key `"<tribeType>:<typeId>"` ({@link weaponKey}) — the cross-ref identity, surfaced
   *  so a consumer can index by it (mind that animal weapons reuse a pair; see the fn doc). */
  key: string;
  /** Net damage vs. every armor class this weapon can target, ascending by `armorClass`. */
  rows: readonly CombatDamageRow[];
}

/**
 * The **combat damage table** as a derived **read view** over `content` — the read half of the
 * CombatSystem, exactly analogous to the HUD's content-only {@link goodsGraph}: it joins each
 * {@link WeaponType} against every armor class (plus the unarmored class `0`), resolving
 * the **net** damage a weapon lands on a target — `max(0, weapon.damage[armorClass] -
 * armor.blockingValue)`. No mechanic is added (nothing is hit, no entity loses hitpoints); this is the
 * static damage *lookup* the later combat atomics will read, surfaced once so a hit doesn't re-walk
 * the two tables.
 *
 * The armor classes covered are the **union** of `content.armor`'s `typeId`s (the real 1..4) and the
 * unarmored class `0`, plus any extra class a weapon's `damage` references — the real `weapontypes`
 * lists classes **6 and 7** with *no* `[armortype]` record (higher tiers outside the 4-record table).
 * Those out-of-table classes are treated as **unarmored** (`blockingValue 0`, `hasArmorRecord false`)
 * rather than dropped or thrown on — the KNOWN GAP the roadmap calls out. So every armor class a
 * weapon can target gets a row, and an absent armor record never crashes the join.
 *
 * Returned as an **array of {@link CombatProfile}**, one per `content.weapons` entry, in source array
 * order — **not** a Map keyed by weapon identity, deliberately: no weapon key is globally unique. A
 * `WeaponType.typeId` recurs per tribe (`2 = "fist"` for every tribe), so we carry the composite
 * `(tribeType, typeId)` `key`; but the real **animal** weapons reuse even that pair (tribe 5 has both
 * `chicken` and `claw` at typeId 1; tribe 8 lists `bearfist` twice), so a Map keyed on the composite
 * would silently drop those records (last-wins). An array loses nothing — every weapon gets a profile —
 * which a read view must guarantee. Each profile's `rows` are sorted ascending by `armorClass`.
 *
 * FIDELITY n/a: a pure derived **read view** of the already-extracted `weapontypes`/`armortypes` IR,
 * like {@link goodsGraph} — it adds no behavior (no hit resolution, no hitpoints, no targeting) and
 * invents no data; the `damage`/`blockingValue` params it joins are the faithful values the pipeline
 * pinned (see docs/FIDELITY.md "Armor type table"). The *combat behavior* (who hits whom, when, the
 * hitpoint loop) is a separate, still-unbuilt mechanic with no oracle — this is only its lookup table.
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock); the class union is
 * built by walking the armor `typeId`s + the weapon's `damage` keys into a Set then **sorting**, and
 * the profiles keep `content.weapons` array order, so the same content yields a byte-identical array
 * every call.
 */
export function combatDamage(content: ContentSet): CombatProfile[] {
  // Armor class -> its record's blockingValue. Class 0 (unarmored) and any out-of-table class a
  // weapon references resolve to "no record" (mitigation 0) below.
  const blockingByClass = new Map<number, number>();
  for (const armor of content.armor) blockingByClass.set(armor.typeId, armor.blockingValue);

  const profiles: CombatProfile[] = [];
  for (const weapon of content.weapons) {
    // The armor classes THIS weapon can target: the unarmored class 0, every defined armor record,
    // and any extra class its own `damage` lists (the out-of-table 6/7). A Set de-dupes; sorting
    // makes the row order stable regardless of how the classes were discovered.
    const classes = new Set<number>([0, ...blockingByClass.keys()]);
    for (const key of Object.keys(weapon.damage)) {
      const c = Number(key);
      if (Number.isInteger(c)) classes.add(c);
    }

    const rows: CombatDamageRow[] = [];
    for (const armorClass of [...classes].sort((a, b) => a - b)) {
      const rawDamage = weapon.damage[String(armorClass)] ?? 0;
      const hasArmorRecord = blockingByClass.has(armorClass);
      const blockingValue = hasArmorRecord ? (blockingByClass.get(armorClass) ?? 0) : 0;
      rows.push({
        armorClass,
        rawDamage,
        blockingValue,
        netDamage: Math.max(0, rawDamage - blockingValue),
        hasArmorRecord,
      });
    }
    profiles.push({
      tribeType: weapon.tribeType,
      typeId: weapon.typeId,
      id: weapon.id,
      key: weaponKey(weapon),
      rows,
    });
  }
  return profiles;
}

/**
 * The composite key naming a weapon's cross-ref identity — `"<tribeType>:<typeId>"`. A
 * `WeaponType.typeId` is NOT globally unique (the same id recurs once per tribe — `2 = "fist"` for
 * every tribe), so a weapon is keyed by **both** ids; a weapon with no `tribeType` keys under the
 * empty-tribe slot (`":<typeId>"`). Mirrors how the extractor keys `weapontypes` by `(tribeType,
 * typeId)` (see docs/LESSONS.md `[bfe2491]`). NOTE even this pair is reused by a few animal weapons,
 * so it identifies a weapon's *class* but is not a unique key — see {@link combatDamage}.
 */
export function weaponKey(weapon: Pick<WeaponType, 'tribeType' | 'typeId'>): string {
  return `${weapon.tribeType ?? ''}:${weapon.typeId}`;
}

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
 * few animal weapons (see {@link combatDamage}/{@link weaponKey}), so a keyed collection would silently
 * drop records. Source order is the same stable, lossless stance {@link combatDamage} keeps; the bow rows
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
 * The weapons **grouped by their coarse class** ({@link weaponClassOf}: the extracted `mainType`) as a
 * derived **read view** over `content` — `Map<mainType, WeaponType[]>`, one bucket per class a weapon
 * carries, classifying `content.weapons` *by the data alone*. The multi-valued counterpart of the
 * binary {@link rangedWeapons}/{@link siegeWeapons} filters: `mainType` is a class enum every weapon
 * carries (1..7), so the natural view partitions the table rather than selecting a subset.
 *
 * Each bucket is a {@link WeaponType} **array in `content.weapons` source order** — lossless like
 * {@link rangedWeapons} (a weapon's `(tribeType, typeId)` isn't unique, so the *values* must be arrays,
 * never a keyed collection; see {@link combatDamage}). Weapons with **no `mainType`** are omitted (no
 * `undefined` bucket) — in the real data every row carries one, so this only drops a malformed/partial
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
 * Note this is a *different* axis from the `armorClass` the {@link combatDamage} join keys on: that join
 * key is the armor's `typeId` (the per-record `damagevalue <armorClass>` index, `1..N`), whereas
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
 * `(tribeType, typeId)` — which recurs/reuses, forcing array values (see {@link combatDamage}) — an
 * armor's `typeId` IS globally unique (the readable `armortypes.ini` is a flat 1..N table, not per-tribe;
 * see {@link ArmorType.typeId}), so a record could in principle be keyed; we still return arrays so the
 * shape matches {@link weaponsByClass} exactly and several records sharing a `mainType` coexist (the real
 * data has two per class). Records with **no `mainType`** are omitted (no `undefined` bucket) — in the
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
