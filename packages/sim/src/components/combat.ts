import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';
import type { MilitaryMode } from '../systems/readviews/stances.js';

/**
 * An entity's hitpoints. Whole integers rather than fixed point: `animaltypes.ini` `hitpoints_adult` runs
 * 200..20000 and damage is an integer join, so the pool and its `hitpoints <= 0` death test stay exact.
 */
export const Health = defineComponent<{ hitpoints: number; max: number }>('Health', 'combat');

/**
 * A combatant's worn armor class - the `[armortype]` tier (`ArmorType.typeId`, 1..4 in base data) whose
 * materialType selects the attacker's damage column in the `weapontypes` x `armortypes` join. The uniform
 * `blockingValue 5` is intentionally not subtracted: its engine role is unreadable.
 */
export const Armor = defineComponent<{ armorClass: number }>('Armor', 'combat');

/**
 * A combatant's wielded weapon. `weaponTypeId` is tribe-scoped - a `typeId` like 2 = "fist" recurs once per
 * tribe - so it resolves against the settler's own tribe. The `weapontypes` damage and reach params are
 * extracted; which settler holds which weapon is an approximation.
 */
export const Weapon = defineComponent<{ weaponTypeId: number }>('Weapon', 'combat');

/**
 * A provoked animal's anger timer: an `animaltypes.ini` `getangry` species that is not `aggressive` fights
 * back until `until`, the tick (`hit tick + angryGameTime`) the anger lapses on.
 */
export const Anger = defineComponent<{ until: number }>('Anger', 'combat');

/**
 * A wild animal's fright: it runs away from `from`, the node its attacker struck from, until the `until`
 * tick, re-aiming on the `repathAt` throttle. Separate from {@link Fleeing}, which the stance ladder strips
 * from any unit not in FLEE stance - an unowned animal carries no stance.
 */
export const Frightened = defineComponent<{ until: number; repathAt: number; from: NodeId }>(
  'Frightened',
  'combat',
);

/**
 * A hunter's empty-search breather: skip prey acquisition until the `until` tick. A cost throttle only -
 * the hunting ground is far wider than a soldier's sight band.
 */
export const HuntRest = defineComponent<{ until: number }>('HuntRest', 'combat');

/**
 * A hunter's committed prey: the animal it stays on until the kill instead of re-picking the nearest each
 * tick. Never outlives the carrier's {@link Engagement}. `needBreakAt` is the tick before which a pressing
 * need does not stop the hunt again, absent until the first break.
 */
export const HuntFocus = defineComponent<{ target: Entity; needBreakAt?: number }>('HuntFocus', 'combat');

/**
 * Present while a unit chases an enemy, and while an owned one trades blows - the marker the planner's
 * ownership gate reads to leave it to combat. `repathAt` is the tick throttling the chase's re-path. `stall`
 * counts consecutive refused routes toward one target, absent (never null) so a stall-free engagement keeps
 * its serialized shape.
 */
export const Engagement = defineComponent<{
  repathAt: number;
  stall?: { target: Entity; routes: number } | undefined;
}>('Engagement', 'combat');

/** One given-up enemy: the entity, and the tick it stops being skipped. */
export interface UnreachableTarget {
  readonly target: Entity;
  readonly until: number;
}

/**
 * The enemies this combatant's chase gave up as sealed off by buildings, skipped by its target acquisition
 * until they lapse. A bounded FIFO like the economy's `UnreachableGoals`.
 */
export const UnreachableTargets = defineComponent<{ entries: readonly UnreachableTarget[] }>(
  'UnreachableTargets',
  'combat',
);

/**
 * A combatant's military stance - the {@link MilitaryMode} the CombatSystem reads to decide
 * auto-engagement, stamped owned-only. `anchorCell` is the DEFEND leash anchor captured at
 * `setStance(DEFEND)`, null in every other mode.
 */
export const Stance = defineComponent<{ mode: MilitaryMode; anchorCell: NodeId | null }>('Stance', 'combat');

/**
 * A {@link Stance} `FLEE` combatant's active run-away state, distinct from the persistent mode: a FLEE unit
 * with no threat in sight carries none. `repathAt` throttles the flee-destination recompute; `calmUntil` is
 * null while a threat is in sight, and set to `tick + cool-down` when the last one leaves.
 */
export const Fleeing = defineComponent<{ repathAt: number; calmUntil: number | null }>('Fleeing', 'combat');

/**
 * A combatant posted to a defensive building and standing on it; `returnTo` is the doorstep it walked in
 * from. The marker is not proof of position - every read confirms it against the settler's tile.
 * Approximation: `houses.ini` posts bow soldiers to the towers, but what manning one does is unreadable.
 */
export const Garrison = defineComponent<{ post: Entity; returnTo: { x: Fixed; y: Fixed } }>(
  'Garrison',
  'combat',
);

/**
 * An explicit attack order on an owned combatant: it chases `target` regardless of sight radius until the
 * target dies or stops being a valid target, then reverts to auto-engagement. A move order or a profession
 * change supersedes it.
 */
export const AttackOrder = defineComponent<{ target: Entity }>('AttackOrder', 'combat');

/**
 * A projectile in flight - a first-class entity carrying a `Position` advanced each tick toward the point
 * frozen at release. Original behavior: a shot is aimed at a point, not at a victim, and on landing it
 * strikes whatever stands there, its damage resolved then against that victim's armor. A shooter that died
 * meanwhile still lands its arrow.
 */
export const Projectile = defineComponent<{
  source: Entity;
  /** The victim the shot was loosed at; it is struck first when it stands where the shot lands. */
  target: Entity;
  /** The shooter's player, whose own units and those of its friends and neutrals a shot passes over; null for
   *  an unowned shooter. */
  player: number | null;
  /** The weapon's `damagevalue` table, keyed by armor material. Original behavior: a shot lands its column
   *  as it stands, with none of the shooter's experience. */
  damage: Readonly<Record<string, number>>;
  /** The weapon's `soundtype_Hit` table, keyed by armor material. */
  hitSounds: Readonly<Record<string, number>>;
  /** Keys the fight-XP bucket; `null` grants no fight XP. */
  weaponMainType: number | null;
  /** The weapon's `soundtype_NoHit` table by ground logic type: what a shot that strikes nothing plays
   *  where it comes down. Carried whole and handed on with the miss event, because the sim navigates
   *  terrain classes and never sees the landscape under the landing node. */
  missSounds: Readonly<Record<string, number>>;
  munitionType: number;
  /** The extracted `WeaponType.speed`, stored raw because its unit is unreadable. */
  speed: number;
  /** The render's ballistic-arc start, frozen at release and never read in flight. */
  originX: Fixed;
  originY: Fixed;
  /** Where the shot comes down, frozen at release. Sim flight and render presentation share this one
   *  chord. */
  aimX: Fixed;
  aimY: Fixed;
  /** The defence-mode building that fired the shot itself, read only by the render. */
  cover: Entity | null;
  /** The tick the string was loosed on; the flight rests at the bow through it, so a shot is observable at
   *  its launch point. */
  launchTick: number;
}>('Projectile', 'combat');
