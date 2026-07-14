import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * An entity's hitpoints — the life pool the hit-resolution loop and starvation drain, reaped by the
 * CleanupSystem when it reaches 0 (`settlerDied`). A completed `attack` atomic subtracts its resolved net
 * damage, clamped at 0 (a hit never heals); the NeedsSystem's starvation bite drains it while hunger is
 * pinned.
 *
 * `hitpoints`/`max` are whole integers, not fixed-point 0..ONE bars: the original's scale is large
 * (`animaltypes.ini` `hitpoints_adult` 200..20000; wolf 1000, bear 7000, mammoth 20000) and net damage is
 * the integer `combatDamage` join (the victim's armor-material column of the `weapontypes` table), so the
 * pool stays exact integer arithmetic with an exact `hitpoints <= 0` death test. Every settler carries one
 * (a spawn without an explicit pool gets
 * {@link import('../systems/conflict/spawn/index.js').DEFAULT_SETTLER_HITPOINTS}); it is optional only on
 * non-settler entities (buildings carry their own pool via content `hitpoints`).
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A combatant's worn armor class — the `[armortype]` tier (`ArmorType.typeId`, 1..4 in base data) the
 * hit-resolution loop joins against to mitigate incoming damage. A target takes the attacker's weapon-
 * damage column selected by this armor's materialType (the verbatim `weapontypes`×`armortypes` join
 * {@link combatDamage} tabulates; the uniform `blockingValue 5` has an unknown engine role and is
 * deliberately not subtracted). The table is deliberate rock-paper-scissors (spears pierce plate, swords
 * beat chain).
 *
 * A separate optional component: a target without one resolves as armor class 0 (unarmored), as does a
 * class with no `[armortype]` record (the out-of-table 6/7, or a bad value) — armor the data doesn't
 * define mitigates nothing rather than crashing, matching {@link combatDamage}. `armorClass` is a whole
 * integer class id.
 */
export const Armor = defineComponent<{ armorClass: number }>('Armor');

/**
 * A combatant's wielded weapon — the `[weapontype]` it carries, identified by `weaponTypeId` (the
 * `WeaponType.typeId`, resolved against the settler's own tribe since a `typeId` like 2="fist" recurs once
 * per tribe). When present the CombatSystem resolves the attack through this weapon (its damage table +
 * reach) instead of the default `(tribe, jobType)` first-match scan ({@link attackerWeapon}), letting a
 * settler hold a specific one of the weapons its class may wield (`weaponsForJob` returns a roster, e.g.
 * `soldier_unarmed → {fist, claw}`; the scan takes the first, the worn component picks one).
 *
 * A separate optional component: without one a settler falls back to the `(tribe, jobType)` scan. A
 * `(tribe, weaponTypeId)` resolving to no `[weapontype]` record (a bad/unknown id) leaves the combatant
 * unarmed for the tick ({@link attackerWeapon} returns null), matching {@link Armor}'s out-of-table stance.
 * `weaponTypeId` is a whole integer typeId.
 *
 * source-basis: the weapon's stats (damage/reach) are the verbatim extracted `weapontypes` params; which
 * settler holds which weapon is caller-supplied (`spawnSettler{weaponTypeId}`), not yet pinned to a
 * soldier-class→weapon loadout (the equip drive stays oracle-blocked — structure faithful, loadout
 * approximated, matching {@link Armor}).
 */
export const Weapon = defineComponent<{ weaponTypeId: number }>('Weapon');

/**
 * A provoked-anger timer on an otherwise-passive animal — the `animaltypes.ini` `getAngry`/`angryGameTime`
 * half of aggression. An animal whose record sets `getangry` but not `aggressive` does not pick fights on
 * its own, but when a civilization strikes it (a hit landing on its {@link Health}) it turns temporarily
 * hostile: `Anger{until}` is stamped/refreshed with `until = tick + angryGameTime`. While `tick < until`
 * the CombatSystem treats it like an aggressive animal (it fights back, and may be targeted); when the
 * timer lapses the CombatSystem removes the component and it reverts to passive.
 *
 * A separate optional component: only a provoked animal carries one (an always-aggressive bear never needs
 * it). `until` is a monotonic integer tick compared against {@link SystemContext.tick}.
 */
export const Anger = defineComponent<{ until: number }>('Anger');

/**
 * A combatant's combat-engagement marker — set while a unit is swinging at or chasing an enemy, removed the
 * moment the fight ends (no valid enemy in reach/sight). Two consumers:
 *
 *  - the AISystem skips economy planning for an engaged unit (the {@link PlayerOrder}-skip pattern) so the
 *    economy can't re-task it mid-fight; placed below the needs drives, so it is a soft override —
 *    hunger/fatigue/piety can still pull it away;
 *  - the CombatSystem uses `repathAt` to throttle the chase: a chaser re-issues its walk toward a moving
 *    enemy only every {@link REPATH_CADENCE} ticks (following its live path between), so a field of chasers
 *    never triggers a per-tick full re-path (golden rule 7).
 *
 * A separate optional component on owned combatants only (wildlife fights in place). `repathAt` is a
 * monotonic integer tick.
 */
export const Engagement = defineComponent<{ repathAt: number }>('Engagement');

/**
 * A combatant's military stance — the original's `MILITARY_MODE_{NONE,ATTACK,DEFEND,IGNORE,FLEE}`
 * (`logicdefines.inc` ~l.1107, ids 0..4; the {@link import('../systems/readviews/stances.js').MILITARY_MODE}
 * constants) the CombatSystem reads to decide auto-engagement:
 *
 *  - ATTACK (`1`) — auto-acquire the nearest enemy in sight, chase it, and fight.
 *  - DEFEND (`2`) — engage only enemies inside a small radius of `anchorCell`, never chase past the leash,
 *    and return to the anchor when clear.
 *  - IGNORE (`3`) — never auto-engage; an explicit {@link AttackOrder} still works.
 *  - FLEE (`4`) — path away from the nearest threat (the {@link Fleeing} drive).
 *  - NONE (`0`) — no assigned mode; treated as passive like IGNORE.
 *
 * `anchorCell` is the DEFEND anchor (a raw row-major cell id) captured from the unit's tile when
 * `setStance(DEFEND)` is issued; null for every other mode. Stamped on every owned settler at
 * spawn/job-change (the default table {@link import('../systems/readviews/stances.js').defaultStanceForJob})
 * and changed by `setStance`; a separate optional component stamped owned-only, so unowned combatants keep
 * their content-relation behavior. `mode` is a small integer id, `anchorCell` a plain cell id or null.
 */
export const Stance = defineComponent<{ mode: number; anchorCell: NodeId | null }>('Stance');

/**
 * A fleeing unit's run-away drive state — this {@link Stance} `FLEE` combatant is actively running from a
 * threat now (distinct from the persistent FLEE mode: a FLEE unit with no threat in sight carries no
 * `Fleeing`). Stamped when a threat enters sight, removed after the threat has been out of sight for the
 * cool-down. It moves at its normal pace — there is no run/sprint gait; the drive only steers. Consumers:
 *
 *  - the CombatSystem uses `repathAt` to throttle the re-aim — the flee destination is recomputed every
 *    few ticks, not per tick (the chase-throttle discipline of {@link Engagement}, golden rule 7);
 *  - the AISystem skips need-scheduling for a `Fleeing` unit.
 *
 * `calmUntil` is the cool-down clock: null while a threat is in sight; set to `tick + cool-down` when the
 * last threat leaves sight; when the tick reaches it the drive ends and the unit returns to the economy. A
 * threat reappearing resets it to null. A separate optional component on actively-fleeing owned units.
 * `repathAt` is a monotonic integer tick, `calmUntil` an integer tick or null.
 */
export const Fleeing = defineComponent<{ repathAt: number; calmUntil: number | null }>('Fleeing');

/**
 * An explicit attack order on an owned combatant — the RTS "attack that unit" focus the `attackUnit`
 * command stamps (the combat twin of {@link PlayerOrder}'s move order). Where auto-engagement re-acquires
 * the nearest enemy within sight each tick, an ordered unit chases and strikes this specific `target`
 * regardless of sight radius, until the target dies or becomes invalid (then the CombatSystem drops the
 * order and the unit reverts to auto-engagement). Reissuing a move/profession order, or the target becoming
 * un-hostile, supersedes it.
 *
 * A separate optional component; `target` is an {@link Entity} id.
 */
export const AttackOrder = defineComponent<{ target: Entity }>('AttackOrder');

/**
 * A projectile in flight — an arrow/rock a ranged weapon launched at the shooter's ATTACK-event frame,
 * homing on its target until it lands the blow or expires. A first-class {@link Entity} carrying a
 * {@link import('./movement.js').Position} (advanced each tick by the `projectileSystem`) plus this
 * payload, so per-tick cost scales with active projectiles (golden rule 7) and a spent projectile is
 * destroyed the moment it hits/expires.
 *
 * The payload is resolved once at launch so the flight itself is a pure advance (no content lookup mid-air):
 *  - `source` — the shooter, for the fight-XP grant + provoked-anger side effect on impact (a `tryGet`
 *    no-ops if it died mid-flight, so a dead archer's arrow still lands);
 *  - `target` — homed on at its current position each tick (homing, approximated — the original's
 *    ballistic-vs-homing choice is unreadable, source basis). A target that dies/vanishes ⇒ expires;
 *  - `damage` — the pre-resolved material-column damage (`weapon.damagevalue[targetMaterial]`), resolved at
 *    launch not on contact (equivalent since armor is immutable in flight);
 *  - `weaponMainType` — the coarse weapon class keying the fight-XP bucket the landing swing accrues into
 *    (`null` for a weapon with no `mainType` → no fight XP);
 *  - `munitionType` — the ammunition class (1 arrow / 2 rock) for render/audio (the `projectileLaunched`/
 *    `projectileHit` events carry it);
 *  - `speed` — the weapon's extracted `WeaponType.speed` (a faithful param); the `projectileSystem` maps it
 *    onto a per-tick tile step via a named calibration constant (the unit is unreadable — source basis
 *    "Combat ranged projectiles"). Stored raw so the component stays faithful data and the approximated
 *    mapping lives in the system;
 *  - `originX`/`originY` — the shooter's {@link import('./movement.js').Position} at the release frame
 *    (fixed-point, frozen at launch). The flight never reads it, but the render needs the chord's start to
 *    place the shot on its ballistic arc (the original visibly lobs arrows — observed, height approximated).
 *
 * A separate optional component on a bare entity (only a Position beside it): no existing system scans it, so
 * it is inert on the goldens. Every field is a whole integer or fixed-point.
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
