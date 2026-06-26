import type { ContentSet, WeaponType } from '@vinland/data';

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
