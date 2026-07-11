import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * An entity's **hitpoints** — the life pool the hit-resolution loop and starvation drain. A settler/
 * animal with a `Health` can be attacked: a completed `attack` atomic subtracts its resolved net
 * damage from `hitpoints` (clamped at 0 — a hit never heals; see the AtomicSystem's `attack` effect),
 * the NeedsSystem's starvation bite drains it while hunger is pinned, and a pool that reaches 0 is
 * reaped by the CleanupSystem (`settlerDied`).
 *
 * `hitpoints`/`max` are **whole integers**, not fixed-point 0..ONE bars: hitpoints are a large
 * integer scale in the original (`animaltypes.ini` `hitpoints_adult` runs 200..20000, e.g. wolf
 * 1000, bear 7000, mammoth 20000) and net damage is the integer `combatDamage` join (the victim's
 * armor-material column of the `weapontypes` damage table), so the whole pool stays integer arithmetic —
 * no truncation, exact `hitpoints <= 0` death test. Since 2026-07-11 EVERY settler carries one
 * (civilians too — user decision; a spawn without an explicit pool gets
 * {@link import('../systems/conflict/spawn.js').DEFAULT_SETTLER_HITPOINTS}), so `Health` is only
 * optional on non-settler entities (buildings carry their own pool via content `hitpoints`).
 * Determinism: drained by fixed integer subtractions, no RNG/wall-clock.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A combatant's worn **armor class** — the `[armortype]` tier (`ArmorType.typeId`, 1..4 in the base
 * data) the hit-resolution loop joins against to mitigate incoming damage. A target carrying an
 * `Armor{armorClass}` takes the attacker's weapon damage **column selected by that armor's
 * materialType** (the verbatim `weapontypes`×`armortypes` join {@link combatDamage} tabulates; the
 * uniform `blockingValue 5` has an unknown engine role and is deliberately NOT subtracted), instead
 * of the unarmored class-0 damage every target took before. Which armor protects best depends on the
 * weapon — the table is deliberate rock-paper-scissors (spears pierce plate, swords beat chain).
 *
 * It is a **separate optional component** (like {@link JobAssignment}/{@link Age}/{@link Health}):
 * only an armored combatant carries one, so a bare target — every animal, every golden/slice settler,
 * and a combatant spawned without an armor class — has none and resolves as **armor class 0**
 * (unarmored), leaving the hash untouched. So adding this component changes no existing scenario; only
 * a settler explicitly stamped with armor (`spawnSettler{armorClass}`) is mitigated.
 *
 * `armorClass` is a whole integer (a class id, not a fixed-point bar), so it hashes deterministically
 * like every other component. A class with **no `[armortype]` record** (the out-of-table 6/7, or a bad
 * value) resolves as unarmored the same way {@link combatDamage} treats it — armor
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
 * source-basis: the weapon's stats (damage/reach) are the verbatim extracted `weapontypes` params; *which*
 * settler holds *which* weapon is caller-supplied (`spawnSettler{weaponTypeId}`), NOT yet pinned to a
 * soldier-class→weapon loadout (the equip drive — the *acquire/carry-the-weapon-good behavior* — stays
 * oracle-blocked, the same "structure faithful, loadout approximated" stance as {@link Armor};
 * source basis "Settler-side Weapon stamping"). Determinism: read by a pure content scan in the
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

/**
 * A combatant's **combat-engagement** marker — "this unit is fighting (or advancing on) an enemy right
 * now". The CombatSystem stamps it while a combatant is swinging at, or chasing, an enemy, and removes
 * it the moment the fight ends (no valid enemy in reach/sight). Two consumers read it:
 *
 *  - the **AISystem** skips ECONOMY planning for an engaged unit (the {@link PlayerOrder}-skip pattern):
 *    combat owns the unit's movement (the chase) and its atomic (the swing), so the economy must not
 *    re-task it mid-fight. Placed below the needs drives so it is a **soft** override — hunger/fatigue/
 *    piety can still pull a combatant away, faithful to the autonomous-settler model;
 *  - the CombatSystem itself uses `repathAt` to **throttle the chase**: a chaser re-issues its walk toward
 *    a moving enemy only every {@link REPATH_CADENCE} ticks (following its live path in between), so a
 *    field of chasers never triggers a per-tick full re-path — the RTS-scale rule (golden rule 7).
 *
 * It is a **separate optional component** (like {@link Health}/{@link Anger}): only a mid-fight combatant
 * carries one, so a peaceful settler / the golden slice has none and the hash is untouched. Only OWNED
 * combatants engage (the walk-into-melee advance is the player's army's; wildlife fights in place), so a
 * neutral/economy fixture never carries it. `repathAt` is a monotonic integer tick value (no fixed-point),
 * so it hashes deterministically. Determinism: set/cleared from the integer tick + the ring-search target,
 * no RNG/wall-clock.
 */
export const Engagement = defineComponent<{ repathAt: number }>('Engagement');

/**
 * A combatant's **military stance** — the original's `MILITARY_MODE_{NONE,ATTACK,DEFEND,IGNORE,FLEE}`
 * (`logicdefines.inc` ~l.1107, ids 0..4; the {@link import('../systems/readviews/stances.js').MILITARY_MODE}
 * constants) as a per-unit behavior mode the CombatSystem reads to decide auto-engagement:
 *
 *  - **ATTACK** (`1`) — auto-acquire the nearest enemy in sight, chase it, and fight (the step-2 drive).
 *  - **DEFEND** (`2`) — engage only enemies inside a small radius of `anchorCell` (the tile the stance was
 *    set on), never chase past a leash, and return to the anchor when clear.
 *  - **IGNORE** (`3`) — never auto-engage (the scout's mode); an explicit {@link AttackOrder} still works.
 *  - **FLEE** (`4`) — run away from the nearest threat at the run gait (the {@link Fleeing} drive).
 *  - **NONE** (`0`) — no assigned mode; treated as passive (like IGNORE) — the defaults never set it.
 *
 * `anchorCell` is the DEFEND anchor (a raw row-major cell id, like {@link import('./movement.js').MoveGoal}'s
 * `cell`), captured from the unit's tile when `setStance(DEFEND)` is issued; **null** for every other mode.
 *
 * It is stamped on every **owned** settler at spawn / job-change (the job-based default table,
 * {@link import('../systems/readviews/stances.js').defaultStanceForJob}) and changed by the `setStance`
 * command. A **separate optional component** stamped OWNED-only (like {@link Owner}): a neutral/wildlife/
 * golden-slice settler carries none, so the military-mode feature adds NO component to any unowned entity
 * and every golden hash stays byte-identical — the CombatSystem keys stance behavior off the owner axis
 * (unowned combatants keep their content-relation behavior unchanged). `mode` is a small integer id and
 * `anchorCell` a plain cell id (or null), so it hashes deterministically like every other component.
 * Determinism: set from the command / the pure default lookup, read by pure gates — no RNG/wall-clock.
 */
export const Stance = defineComponent<{ mode: number; anchorCell: number | null }>('Stance');

/**
 * A fleeing unit's **run-away drive state** — "this {@link Stance} `FLEE` combatant is actively running
 * from a threat right now" (distinct from the persistent FLEE *mode*: a FLEE unit with no threat in sight
 * works normally and carries no `Fleeing`). The CombatSystem's flee drive stamps it when a threat enters
 * sight and removes it after the threat has been out of sight for the cool-down. Two consumers read it:
 *
 *  - the **MovementSystem** walks a `Fleeing` path-follower at the **run gait** (the faster pace — reads
 *    {@link import('./movement.js').MoveSpeed}'s `runPerTick`, else the walk pace × a run multiplier), so a
 *    fleeing civilian outpaces its pursuer; a unit with no `Fleeing` walks normally (golden untouched);
 *  - the CombatSystem uses `repathAt` to **throttle the re-aim** — the flee destination (away from the
 *    nearest threat) is recomputed only every few ticks, not per tick (the same chase-throttle discipline
 *    as {@link Engagement}, golden rule 7).
 *
 * `calmUntil` is the cool-down clock: **null** while a threat is in sight (still in danger); set to
 * `tick + cool-down` when the last threat leaves sight; when the tick reaches it (a full cool-down with no
 * threat) the drive ends and the unit returns to the economy. A threat reappearing resets it to null.
 *
 * A **separate optional component** (like {@link Engagement}): only an actively-fleeing owned unit carries
 * one, so a peaceful settler / the golden slice has none and the hash is untouched. `repathAt` is a
 * monotonic integer tick and `calmUntil` an integer tick or null, so it hashes deterministically.
 * Determinism: set/cleared from the integer tick + the ring-search threat, no RNG/wall-clock.
 */
export const Fleeing = defineComponent<{ repathAt: number; calmUntil: number | null }>('Fleeing');

/**
 * An explicit **attack order** on an OWNED combatant — the RTS "attack that unit" focus the
 * `attackUnit` command stamps (the combat twin of {@link PlayerOrder}'s move order). Where the auto-
 * engagement drive re-acquires the nearest enemy within sight each tick, an ordered unit chases and
 * strikes THIS specific `target` **regardless of sight radius**, until the target dies / becomes an
 * invalid target (then the CombatSystem drops the order and the unit reverts to auto-engagement) — the
 * focused "kill that one" the player commands. Reissuing a move/profession order, or the target
 * becoming un-hostile, supersedes it.
 *
 * It is a **separate optional component** (like {@link Engagement}): only a unit under an explicit
 * attack order carries one, so the golden slice / a peaceful unit has none and the hash is untouched.
 * `target` is an {@link Entity} id (a monotonic integer), so it hashes deterministically. Determinism:
 * set once from the command's target, read/cleared by pure component + hostility checks — no RNG/wall-clock.
 */
export const AttackOrder = defineComponent<{ target: Entity }>('AttackOrder');

/**
 * A **projectile in flight** — an arrow/rock a ranged weapon (a bow/catapult) launched at the shooter's
 * ATTACK-event frame, homing on its target until it lands the blow or expires. It is a first-class
 * {@link Entity} carrying a {@link import('./movement.js').Position} (its current point, advanced each
 * tick by the `projectileSystem`) plus this payload — so per-tick cost scales with the count of ACTIVE
 * projectiles, not with entities² (golden rule 7), and a spent projectile is destroyed the moment it
 * hits/expires (the cleanupSystem-style prompt collection).
 *
 * The payload is everything the on-contact hit needs, resolved once at launch so the flight itself is a
 * pure advance (no content lookup mid-air):
 *  - `source` — the shooter, for the fight-XP grant + the provoked-anger side effect on impact (a
 *    `tryGet` no-ops if it died mid-flight, so a dead archer's arrow still lands);
 *  - `target` — the entity the projectile homes on; it re-aims at the target's CURRENT position each
 *    tick (homing, approximated — the original's ballistic-vs-homing choice is unreadable, source basis).
 *    A target that dies / vanishes mid-flight ⇒ the projectile **expires** (no re-target);
 *  - `damage` — the **pre-resolved** material-column damage (`weapon.damagevalue[targetMaterial]`, step
 *    1's model) the blow lands. Resolved at launch, not on contact — equivalent here because armor is
 *    immutable in flight, and it keeps the payload a plain value like the melee `attack` effect's `damage`;
 *  - `weaponMainType` — the weapon's coarse class keying the fight-XP bucket the landing swing accrues
 *    into (`null` for a weapon with no `mainType` → no fight XP), the twin of the `attack` effect's field;
 *  - `munitionType` — the ammunition class (1 arrow / 2 rock) for render/audio (the `projectileLaunched`/
 *    `projectileHit` events carry it); the data-pinned marker the render slice draws the right sprite off;
 *  - `speed` — the weapon's extracted `WeaponType.speed` (a **faithful** param); the `projectileSystem`
 *    maps this onto a per-tick tile step via a named calibration constant (the unit is unreadable —
 *    source basis "Combat ranged projectiles"). Stored raw (the extracted value) so the component stays the
 *    faithful data and the approximated mapping lives in one place (the system);
 *  - `originX`/`originY` — the shooter's {@link import('./movement.js').Position} at the release frame
 *    (fixed-point, frozen at launch). The flight itself never reads it — the homing step re-aims at the
 *    target — but the render needs the chord's start to place the shot on its ballistic ARC (the drawn
 *    lob height + tangent are a pure function of how far along origin→target the shot is; the original
 *    visibly lobs arrows — observed original behaviour, height approximated).
 *
 * A **separate optional component** on a **bare** entity (only a Position beside it) — no existing system
 * scans it (combat/AI/movement all key on `Settler`/`Health`/`PathFollow`, which a projectile lacks), so
 * it is inert on the goldens (they launch no ranged shot) and adds no per-tick cost when none are in
 * flight. Every field is a whole integer (ids, raw extracted values, fixed-point scaled ints), so it hashes
 * deterministically like every other component. Determinism: created + advanced from pure integer/fixed-point
 * math, no RNG/wall-clock.
 */
export const Projectile = defineComponent<{
  source: Entity;
  target: Entity;
  damage: number;
  weaponMainType: number | null;
  munitionType: number;
  speed: number;
  originX: Fixed;
  originY: Fixed;
}>('Projectile');
