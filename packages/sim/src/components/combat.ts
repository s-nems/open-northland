import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';
import type { MilitaryMode } from '../systems/readviews/stances.js';

/**
 * An entity's hitpoints. Whole integers, not a fixed-point 0..ONE bar: the original's scale is large
 * (`animaltypes.ini` `hitpoints_adult` 200..20000) and net damage is the integer `combatDamage` join, so
 * the pool stays exact with an exact `hitpoints <= 0` death test. Every settler carries one.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health');

/**
 * A combatant's worn armor class - the `[armortype]` tier (`ArmorType.typeId`, 1..4 in base data) whose
 * materialType selects the attacker's damage column in the `weapontypes`x`armortypes` join. The uniform
 * `blockingValue 5` has an unknown engine role and is deliberately not subtracted. An absent component, or
 * a class with no `[armortype]` record, resolves as armor class 0 rather than failing.
 */
export const Armor = defineComponent<{ armorClass: number }>('Armor');

/**
 * A combatant's wielded weapon, resolved against the settler's own tribe since a `typeId` like 2="fist"
 * recurs once per tribe. Without one a settler falls back to the `(tribe, jobType)` first-match scan; a
 * pair resolving to no record leaves the combatant unarmed for the tick. The damage/reach params are
 * extracted `weapontypes`, but which settler holds which weapon is caller-supplied and approximated.
 */
export const Weapon = defineComponent<{ weaponTypeId: number }>('Weapon');

/**
 * A provoked-anger timer on an animal whose `animaltypes.ini` record sets `getangry` but not `aggressive`:
 * a hit stamps `until = tick + angryGameTime`, and while `tick < until` the CombatSystem treats it as
 * aggressive. `until` is a monotonic integer tick.
 */
export const Anger = defineComponent<{ until: number }>('Anger');

/**
 * A wild animal's fright: the `animalFrightSystem` runs the carrier away from the scare node `from` until
 * `until` lapses, re-aiming on the `repathAt` throttle. Separate from {@link Fleeing} because the stance
 * ladder strips that from any unit whose stance is not FLEE, and unowned animals have no stance. Tick
 * fields are monotonic integers.
 */
export const Frightened = defineComponent<{ until: number; repathAt: number; from: NodeId }>('Frightened');

/**
 * A hunter's empty-search breather: skip prey searches until `until` (a monotonic tick). Purely a cost
 * throttle - the hunter's ground is far wider than a soldier's sight, so a search that takes nothing must
 * not ring-walk the full band every tick.
 */
export const HuntRest = defineComponent<{ until: number }>('HuntRest');

/**
 * A hunter's committed prey: the animal it stays on until the kill, rather than re-picking the nearest one
 * each tick. Never outlives the carrier's {@link Engagement}.
 */
export const HuntFocus = defineComponent<{ target: Entity }>('HuntFocus');

/**
 * Present while a unit is swinging at or chasing an enemy, on owned combatants only. Economy planning skips
 * an engaged unit, but the needs drives still outrank it. `repathAt` is a monotonic tick throttling the
 * chase's re-path, so a field of chasers never re-paths every tick.
 */
export const Engagement = defineComponent<{ repathAt: number }>('Engagement');

/**
 * A combatant's military stance - the original's `MILITARY_MODE_{NONE,ATTACK,DEFEND,IGNORE,FLEE}`
 * (`logicdefines.inc` ~l.1107, ids 0..4) the CombatSystem reads to decide auto-engagement. `anchorCell` is
 * the DEFEND leash anchor (a raw row-major cell id) captured at `setStance(DEFEND)`, null for every other
 * mode. Stamped owned-only, so unowned combatants keep their content-relation behavior.
 */
export const Stance = defineComponent<{ mode: MilitaryMode; anchorCell: NodeId | null }>('Stance');

/**
 * A {@link Stance} `FLEE` combatant's active run-away state, distinct from the persistent mode: a FLEE unit
 * with no threat in sight carries none. `repathAt` throttles the flee-destination recompute; `calmUntil` is
 * null while a threat is in sight and set to `tick + cool-down` when the last one leaves, ending the drive
 * when reached. Both ticks are monotonic integers.
 */
export const Fleeing = defineComponent<{ repathAt: number; calmUntil: number | null }>('Fleeing');

/**
 * A combatant posted to a defensive building and standing on it; `returnTo` is the doorstep it walked in
 * from. The marker alone is not proof it is still up there - every read confirms it against the settler's
 * tile.
 *
 * Approximation: `houses.ini` gives the towers their bow-soldier `logicworker 40/41` posts, but what
 * manning one does is unreadable.
 */
export const Garrison = defineComponent<{ post: Entity; returnTo: { x: Fixed; y: Fixed } }>('Garrison');

/**
 * An explicit attack order on an owned combatant: it chases this specific `target` regardless of sight
 * radius until the target dies or becomes invalid, then reverts to auto-engagement. A move/profession
 * order, or the target becoming un-hostile, supersedes it.
 */
export const AttackOrder = defineComponent<{ target: Entity }>('AttackOrder');

/**
 * A projectile in flight - a first-class entity carrying a `Position` advanced each tick, homing on
 * `target`'s live position. The payload is resolved once at launch, so the flight needs no content lookup
 * mid-air and a shooter that died meanwhile still lands its arrow.
 *
 * Approximated: homing rather than ballistic flight, the drawn arc height, and the sub-tick release instant.
 */
export const Projectile = defineComponent<{
  source: Entity;
  target: Entity;
  /** The pre-resolved material-column damage (`weapon.damagevalue[targetMaterial]`), equivalent to
   *  resolving on contact since armor is immutable in flight. */
  damage: number;
  /** Keys the fight-XP bucket; `null` grants no fight XP. */
  weaponMainType: number | null;
  munitionType: number;
  /** The extracted `WeaponType.speed`, stored raw because its unit is unreadable. */
  speed: number;
  /** The render's ballistic-arc start, frozen at release and never read in flight. */
  originX: Fixed;
  originY: Fixed;
  /** The defence-mode shelter a manning shooter loosed from, read only by the render. */
  cover: Entity | null;
  /** The frozen aim of a shot that missed at release or lost its mark mid-flight; it lands there dealing
   *  nothing. `null` while the shot still homes. */
  missAim: { x: Fixed; y: Fixed } | null;
  /** The tick the string was loosed on; the flight rests at the bow through it, so a shot is observable at
   *  its launch point. */
  launchTick: number;
}>('Projectile');
