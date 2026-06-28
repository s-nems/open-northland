import { defineComponent } from '../ecs/world.js';

/**
 * A combatant's **hitpoints** — the life pool the hit-resolution loop drains. A settler/animal with
 * a `Health` can be attacked: a completed `attack` atomic subtracts its resolved net damage from
 * `hitpoints` (clamped at 0 — a hit never heals; see the AtomicSystem's `attack` effect), and a
 * pool that reaches 0 is "dead" (the death/cleanup loop is a later slice — for now a 0-HP entity
 * just stops being a viable target).
 *
 * `hitpoints`/`max` are **whole integers**, not fixed-point 0..ONE bars: hitpoints are a large
 * integer scale in the original (`animaltypes.ini` `hitpoints_adult` runs 200..20000, e.g. wolf
 * 1000, bear 7000, mammoth 20000) and net damage is the integer `combatDamage` join (the per-class
 * `weapontypes` damage minus the armor `blockingValue`), so the whole pool stays integer arithmetic —
 * no truncation, exact `hitpoints <= 0` death test. It is a **separate optional component** (like
 * {@link JobAssignment}/{@link Age}): only a combatant carries one, so a non-combat settler/the
 * golden slice has none and the hash is untouched. Determinism: drained by a fixed integer
 * subtraction, no RNG/wall-clock.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A combatant's worn **armor class** — the `[armortype]` tier (`ArmorType.typeId`, 1..4 in the base
 * data) the hit-resolution loop joins against to mitigate incoming damage. A target carrying an
 * `Armor{armorClass}` takes the attacker's weapon `damage[armorClass]` **minus** that armor's
 * `blockingValue` (the verbatim `weapontypes`×`armortypes` join {@link combatDamage} tabulates),
 * instead of the unarmored class-0 damage every target took before. A higher class is heavier mail:
 * class 3/4 chain/plate blocks more than class 1 woolen.
 *
 * It is a **separate optional component** (like {@link JobAssignment}/{@link Age}/{@link Health}):
 * only an armored combatant carries one, so a bare target — every animal, every golden/slice settler,
 * and a combatant spawned without an armor class — has none and resolves as **armor class 0**
 * (unarmored), leaving the hash untouched. So adding this component changes no existing scenario; only
 * a settler explicitly stamped with armor (`spawnSettler{armorClass}`) is mitigated.
 *
 * `armorClass` is a whole integer (a class id, not a fixed-point bar), so it hashes deterministically
 * like every other component. A class with **no `[armortype]` record** (the out-of-table 6/7, or a bad
 * value) resolves as unarmored (`blockingValue 0`) the same way {@link combatDamage} treats it — armor
 * the data doesn't define mitigates nothing rather than crashing. Determinism: read by a pure content
 * join in the CombatSystem, no RNG/wall-clock.
 */
export const Armor = defineComponent<{ armorClass: number }>('Armor');

/**
 * A combatant's wielded **weapon** — the `[weapontype]` it carries, identified by `weaponTypeId` (the
 * `WeaponType.typeId`, resolved against the settler's OWN tribe since a `typeId` like 2="fist" recurs
 * once per tribe — see {@link WeaponType}). When a combatant wears one, the CombatSystem resolves its
 * attack through THIS specific weapon (its damage table + reach) instead of the default
 * `(tribe, jobType)` first-match scan ({@link attackerWeapon}). This is what lets a settler hold a
 * *specific* one of the several weapons its soldier-class may wield (`weaponsForJob` returns a roster,
 * e.g. `soldier_unarmed → {fist, claw}`; the scan just takes the first — the worn component picks one).
 *
 * It is a **separate optional component** (like {@link Armor}/{@link Health}): only an explicitly-equipped
 * combatant carries one, so a bare settler — every animal, every golden/slice settler, and a combatant
 * spawned without a weapon id — has none and falls back to the `(tribe, jobType)` weapon scan exactly as
 * before, leaving the hash untouched. So adding this component changes no existing scenario; only a settler
 * stamped with a worn weapon (`spawnSettler{weaponTypeId}`) overrides its default loadout.
 *
 * `weaponTypeId` is a whole integer (a `typeId`, not a fixed-point value), so it hashes deterministically
 * like every other component. A `(tribe, weaponTypeId)` that resolves to **no `[weapontype]` record** (a
 * bad/unknown id) leaves the combatant **unarmed for the tick** ({@link attackerWeapon} returns null) —
 * a worn weapon the data doesn't define grants no attack rather than crashing, the same "the data doesn't
 * define it → it does nothing" stance {@link Armor} takes for an out-of-table class.
 *
 * FIDELITY: the weapon's stats (damage/reach) are the verbatim extracted `weapontypes` params; *which*
 * settler holds *which* weapon is caller-supplied (`spawnSettler{weaponTypeId}`), NOT yet pinned to a
 * soldier-class→weapon loadout (the equip drive — the *acquire/carry-the-weapon-good behavior* — stays
 * oracle-blocked, the same "structure faithful, loadout approximated" stance as {@link Armor};
 * docs/FIDELITY.md "Settler-side Weapon stamping"). Determinism: read by a pure content scan in the
 * CombatSystem, no RNG/wall-clock.
 */
export const Weapon = defineComponent<{ weaponTypeId: number }>('Weapon');

/**
 * A **provoked-anger timer** on an otherwise-passive animal — the `animaltypes.ini` `getAngry`/
 * `angryGameTime` half of aggression. An animal whose record sets `getangry` but **not** `aggressive`
 * does not pick fights on its own, but if a civilization **strikes** it (a hunter's hit landing on its
 * {@link Health}, resolved by the AtomicSystem's `attack` effect) it turns temporarily hostile: an
 * `Anger{until}` is stamped/refreshed on it with `until = tick + angryGameTime` (the record's anger
 * duration in ticks). While the current tick is **before** `until`, the CombatSystem treats it like an
 * aggressive animal — it fights the civ back, and the civ may target it — so a provoked deer/boar
 * defends itself for `angryGameTime` ticks, then reverts to passive when the timer lapses (the
 * CombatSystem removes the expired component so an idle angry animal can't keep a stale timer).
 *
 * It is a **separate optional component** (like {@link JobAssignment}/{@link Age}/{@link Health}/
 * {@link HerdMember}): only a provoked animal carries one — an always-aggressive animal (a bear) never
 * needs it (it is hostile unconditionally), a civilization never does, and the golden slice has none,
 * so the hash is untouched. `until` is a monotonic integer tick value (no fixed-point — it is a whole
 * tick count compared against {@link SystemContext.tick}), so it hashes deterministically like every
 * other component. Determinism: set from the integer `tick + angryGameTime` at the provocation point,
 * removed by the exact `tick >= until` compare — no RNG, no wall-clock.
 */
export const Anger = defineComponent<{ until: number }>('Anger');
