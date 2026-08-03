import type { WeaponType } from '@open-northland/data';
import {
  AssistantRecruit,
  AttackOrder,
  Engagement,
  Position,
  Settler,
  type SettlerIdentity,
  Weapon,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import { attackerWeapon } from '../../conflict/weapons.js';
import type { SystemContext } from '../../context.js';
import { isFighterJob, isRangedWeapon, WEAPON_MAIN_TYPE, weaponClassOf } from '../../readviews/index.js';
import { ownedSettlers } from '../shared.js';

/** The seat's fighters, sorted by what this decision can do with them (canonical ascending id). */
export interface ArmyCensus {
  /** Armed and free to be ordered - the army this decision commands. */
  readonly ready: readonly Entity[];
  /** Bare-handed with a booking that says a weapon is coming for him: never sent in, only called home
   *  for the arming pass to dress him (user rule). One nobody is arming counts as {@link ready} - for
   *  him it is his fists or nothing. */
  readonly awaitingWeapon: readonly Entity[];
  /** Fighters already chasing a focus or trading blows - not orderable this decision, but still the
   *  seat's army. The muster counts them, or a wave leaving would read as a collapse and walk the next
   *  rank home behind it. */
  readonly committed: number;
}

/** How a body of fighters splits between shot and reach - the mix the launch rule reads. */
export interface WeaponMix {
  readonly total: number;
  readonly ranged: number;
  readonly melee: number;
}

/**
 * Sort the seat's fighters. A man chasing an {@link AttackOrder} focus, or trading blows right now
 * ({@link Engagement}), lands in neither list and is only counted: re-ordering him would cancel the swing
 * he is halfway through - which is also why no march order needs a "same focus already" check.
 *
 * A man holding a tower post leaves the army altogether - he is neither ordered nor counted
 * ({@link import('./defence/index.js').TOWER_GARRISON_ARCHERS}). {@link towerPostFor}'s entitlement is the
 * test rather than the garrison marker, so an archer still walking to his tower is already gone from the
 * muster.
 */
export function takeCensus(world: World, ctx: SystemContext, player: number): ArmyCensus {
  const ready: Entity[] = [];
  const awaitingWeapon: Entity[] = [];
  let committed = 0;
  for (const e of ownedSettlers(world, player)) {
    const settler = world.get(e, Settler);
    const jobType = settler.jobType;
    if (jobType === null || !isFighterJob(ctx.content, jobType)) continue;
    if (towerPostFor(world, ctx, e, jobType) !== null) continue;
    if (world.has(e, AttackOrder) || world.has(e, Engagement)) {
      committed++;
      continue;
    }
    if (!world.has(e, Position)) continue;
    const bare = fightingWeapon(world, ctx, e, settler) === null;
    (bare && world.has(e, AssistantRecruit) ? awaitingWeapon : ready).push(e);
  }
  return { ready, awaitingWeapon, committed };
}

/** The weapon mix of one body of fighters. A man with nothing to fight with counts as melee: he has no
 *  reach to keep, so he goes in with the front rank. */
export function weaponMix(world: World, ctx: SystemContext, units: readonly Entity[]): WeaponMix {
  let ranged = 0;
  for (const e of units) {
    const weapon = fightingWeapon(world, ctx, e, world.get(e, Settler));
    if (weapon !== null && isRangedWeapon(weapon)) ranged++;
  }
  return { total: units.length, ranged, melee: units.length - ranged };
}

/** The weapon the CombatSystem would resolve for a fighter - the worn one, else his class default - or
 *  null when he goes in with nothing but his hands: no row at all, or one whose class is the bare fist /
 *  no class ({@link WEAPON_MAIN_TYPE}). A row with no `mainType` AT ALL still arms him: the content named
 *  him a weapon, only not what kind. */
function fightingWeapon(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
): WeaponType | null {
  const armed = attackerWeapon(ctx, settler.tribe, settler.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  if (armed === null) return null;
  const weaponClass = weaponClassOf(armed.weapon);
  return weaponClass !== undefined && BARE_HANDED.has(weaponClass) ? null : armed.weapon;
}

const BARE_HANDED: ReadonlySet<number> = new Set([WEAPON_MAIN_TYPE.NONE, WEAPON_MAIN_TYPE.UNARMED]);
