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
}

/** How a body of fighters splits between shot and reach - the mix the launch rule reads. */
export interface WeaponMix {
  readonly total: number;
  readonly ranged: number;
  readonly melee: number;
}

/**
 * Sort the seat's fighters. A man chasing an {@link AttackOrder} focus, or trading blows right now
 * ({@link Engagement}), lands in neither list: he is already committed, and re-ordering him would cancel
 * the swing he is halfway through - which is also why no march order needs a "same focus already" check.
 */
export function takeCensus(world: World, ctx: SystemContext, player: number): ArmyCensus {
  const ready: Entity[] = [];
  const awaitingWeapon: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    const settler = world.get(e, Settler);
    if (!isFighterJob(ctx.content, settler.jobType)) continue;
    if (world.has(e, AttackOrder) || world.has(e, Engagement)) continue;
    if (!world.has(e, Position)) continue;
    const bare = fightingWeapon(world, ctx, e, settler) === null;
    (bare && world.has(e, AssistantRecruit) ? awaitingWeapon : ready).push(e);
  }
  return { ready, awaitingWeapon };
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
 *  null when he goes in with nothing but his hands: no row at all, a bare fist
 *  ({@link WEAPON_MAIN_TYPE.UNARMED}), or a row whose class is {@link WEAPON_MAIN_TYPE.NONE} and so names
 *  no way of fighting either. */
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
