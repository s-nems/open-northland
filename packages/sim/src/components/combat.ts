import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';
import type { MilitaryMode } from '../systems/readviews/stances.js';

/**
 * An entity's hitpoints, drained by resolved attack damage (clamped at 0) and by the NeedsSystem's starvation
 * bite; the CleanupSystem reaps at 0 (`settlerDied`). Whole integers, not fixed-point 0..ONE bars: the
 * original's scale is large (`animaltypes.ini` `hitpoints_adult` 200..20000) and net damage is the integer
 * `combatDamage` join, so the pool stays exact integer arithmetic with an exact `hitpoints <= 0` death test.
 * Every settler carries one (defaulting to
 * {@link import('../systems/conflict/spawn/index.js').DEFAULT_SETTLER_HITPOINTS}); optional elsewhere.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A combatant's worn armor class — the `[armortype]` tier (`ArmorType.typeId`, 1..4 in base data) whose
 * materialType selects the attacker's damage column in the `weapontypes`×`armortypes` join
 * ({@link combatDamage}). The uniform `blockingValue 5` has an unknown engine role and is deliberately not
 * subtracted. Optional: no component, or a class with no `[armortype]` record (out-of-table 6/7, or a bad
 * value), resolves as armor class 0 — armor the data doesn't define mitigates nothing rather than crashing.
 */
export const Armor = defineComponent<{ armorClass: number }>('Armor');

/**
 * A combatant's wielded weapon, resolved against the settler's own tribe since a `typeId` like 2="fist"
 * recurs once per tribe. When present the CombatSystem uses this weapon's damage table and reach instead of
 * the default `(tribe, jobType)` first-match scan ({@link attackerWeapon}). Optional: without one a settler
 * falls back to the scan; a `(tribe, weaponTypeId)` resolving to no record leaves the combatant unarmed for
 * the tick, matching {@link Armor}'s out-of-table stance. The damage/reach params are extracted
 * `weapontypes`, but which settler holds which weapon is caller-supplied (`spawnSettler{weaponTypeId}`) —
 * that loadout is approximated (oracle-blocked).
 */
export const Weapon = defineComponent<{ weaponTypeId: number }>('Weapon');

/**
 * A provoked-anger timer on an animal whose `animaltypes.ini` record sets `getangry` but not `aggressive`:
 * it starts no fights, but a hit on its {@link Health} stamps/refreshes `until = tick + angryGameTime`, and
 * while `tick < until` the CombatSystem treats it as aggressive, removing the component when the timer lapses.
 * Optional — an always-aggressive bear never needs one. `until` is a monotonic integer tick compared against
 * {@link SystemContext.tick}.
 */
export const Anger = defineComponent<{ until: number }>('Anger');

/**
 * A combat-engagement marker, present while a unit is swinging at or chasing an enemy and removed once no
 * valid enemy is in reach/sight. The AISystem skips economy planning for an engaged unit but sits below the
 * needs drives, so hunger/fatigue/piety still pull it away. `repathAt` throttles the chase: a chaser re-issues
 * its walk toward a moving enemy only every {@link REPATH_CADENCE} ticks, following its live path between, so
 * a field of chasers never triggers a per-tick full re-path. Optional, on owned combatants only (wildlife
 * fights in place); `repathAt` is a monotonic integer tick.
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
 * `anchorCell` is the DEFEND anchor (a raw row-major cell id) captured from the unit's tile at
 * `setStance(DEFEND)`, null for every other mode. Stamped owned-only on spawn/job-change (defaults from
 * {@link import('../systems/readviews/stances.js').defaultStanceForJob}), so unowned combatants keep their
 * content-relation behavior.
 */
export const Stance = defineComponent<{ mode: MilitaryMode; anchorCell: NodeId | null }>('Stance');

/**
 * A {@link Stance} `FLEE` combatant's active run-away state — distinct from the persistent mode: a FLEE unit
 * with no threat in sight carries no `Fleeing`. The unit moves at its normal pace (there is no run/sprint
 * gait); the drive only steers, and the AISystem skips need-scheduling while it is present. `repathAt`
 * throttles the flee-destination recompute ({@link Engagement}'s throttle); `calmUntil` is the cool-down
 * clock: null while a threat is in sight, set to `tick + cool-down` when the last threat leaves, and reset to
 * null if a threat reappears; reaching it ends the drive. Both ticks are monotonic integers.
 */
export const Fleeing = defineComponent<{ repathAt: number; calmUntil: number | null }>('Fleeing');

/**
 * An explicit attack order the `attackUnit` command stamps on an owned combatant. Unlike auto-engagement,
 * which re-acquires the nearest enemy in sight each tick, an ordered unit chases this specific `target`
 * regardless of sight radius until it dies or becomes invalid — then the CombatSystem drops the order and the
 * unit reverts to auto-engagement. A move/profession order, or the target becoming un-hostile, supersedes it.
 */
export const AttackOrder = defineComponent<{ target: Entity }>('AttackOrder');

/**
 * A projectile in flight — an arrow/rock launched at the shooter's ATTACK-event frame, homing on its target
 * until it lands or expires. A first-class {@link Entity} carrying a {@link import('./movement.js').Position}
 * the `projectileSystem` advances each tick. The payload is resolved once at launch, so the flight needs no
 * content lookup mid-air:
 *  - `source` — the shooter, for the fight-XP grant + provoked-anger side effect on impact (a `tryGet`
 *    no-ops if it died mid-flight, so a dead archer's arrow still lands);
 *  - `target` — homed on at its current position each tick (homing, approximated — the original's
 *    ballistic-vs-homing choice is unreadable). A target that dies/vanishes ⇒ expires;
 *  - `damage` — the pre-resolved material-column damage (`weapon.damagevalue[targetMaterial]`), resolved at
 *    launch rather than on contact (equivalent since armor is immutable in flight);
 *  - `weaponMainType` — the coarse weapon class keying the fight-XP bucket (`null` ⇒ no fight XP);
 *  - `munitionType` — the ammunition class (1 arrow / 2 rock) the `projectileLaunched`/`projectileHit`
 *    events carry for render/audio;
 *  - `speed` — the extracted `WeaponType.speed`, stored raw because its unit is unreadable; the
 *    `projectileSystem` maps it onto a per-tick tile step via a named calibration constant;
 *  - `originX`/`originY` — the shooter's Position at the release frame (fixed-point, frozen at launch), read
 *    only by the render, which needs the chord's start to place the shot on its ballistic arc (the original
 *    visibly lobs arrows — observed, height approximated).
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
