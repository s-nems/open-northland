import {
  AssistantRecruit,
  type AssistantRecruitIntent,
  consumeAssistantCounter,
  JobAssignment,
  ownerOf,
  Settler,
  Weapon,
} from '../../../../../components/index.js';
import { contentIndex } from '../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { applyTradeChange } from '../../../../economy/jobs/index.js';
import { baseSoldierJobType, isSoldierJob, WEAPON_MAIN_TYPE } from '../../../../readviews/index.js';

/**
 * The equip drive's good-to-class join, read from `weapons.ini` `goodtype` and `jobtype` rather than a
 * hardcoded table. The job flip and the combat `Weapon` travel together, so an armed class never exists
 * without its arms. Only the soldier band transforms: a hero keeps its class, and a civilian or scout
 * wearing a weapon good just carries it. Authored: within the band there is no schooling gate, since the
 * barracks unlocks the profession rather than the weapon.
 */

/** Which weapon class (`maintype`) each arming intent asks for - the assistant's three class rows. */
export const INTENT_WEAPON_CLASS: Readonly<Record<Exclude<AssistantRecruitIntent, 'trainSoldiers'>, number>> =
  {
    trainSword: WEAPON_MAIN_TYPE.SWORD,
    trainSpear: WEAPON_MAIN_TYPE.SPEAR,
    trainBow: WEAPON_MAIN_TYPE.BOW,
  };

/**
 * Take up the just-equipped weapon good: flip the soldier to the weapon's class and stamp the combat
 * {@link Weapon}. Settles the assistant's booking either way - a matching class pays its counter, a
 * player-forced different class releases the booking unpaid so the counter books a fresh recruit.
 */
export function takeUpWeaponGood(world: World, ctx: SystemContext, e: Entity, goodType: number): void {
  const settler = world.get(e, Settler);
  if (!isSoldierJob(ctx.content, settler.jobType)) return;
  const weapon = contentIndex(ctx.content).weaponByTribeAndGoodType.get(settler.tribe)?.get(goodType);
  if (weapon === undefined || weapon.jobType === undefined) {
    // A display-only weapon (no class row) still settles the booking: the arming pass will never fill the
    // taken slot, so the counter must book someone else instead of waiting forever.
    settleArmingBooking(world, e, undefined);
    return;
  }
  if (weapon.jobType !== settler.jobType) {
    world.remove(e, JobAssignment); // the old post is not this class's, as on any profession change
    applyTradeChange(world, ctx, e, weapon.jobType);
  }
  if (world.has(e, Weapon)) world.mut(e, Weapon).weaponTypeId = weapon.typeId;
  else world.add(e, Weapon, { weaponTypeId: weapon.typeId });
  settleArmingBooking(world, e, weapon.mainType);
}

/**
 * The weapon slot emptied: an armed soldier class falls back to the unarmed base and loses the
 * combat {@link Weapon}. Non-soldiers (hero, civilian) keep their class; leaving the band entirely
 * is `applyTradeChange`'s own disarm.
 */
export function layDownWeaponGood(world: World, ctx: SystemContext, e: Entity): void {
  const settler = world.get(e, Settler);
  if (!isSoldierJob(ctx.content, settler.jobType)) return;
  const base = baseSoldierJobType(ctx.content);
  if (base !== null && settler.jobType !== base) {
    world.remove(e, JobAssignment);
    applyTradeChange(world, ctx, e, base);
  }
  world.remove(e, Weapon);
}

/** Pay (or release) the assistant's arming booking for the weapon class that actually landed -
 *  `mainType` undefined means "not a class weapon at all", which releases like any mismatch. */
function settleArmingBooking(world: World, e: Entity, mainType: number | undefined): void {
  const booking = world.tryMut(e, AssistantRecruit);
  if (booking === undefined || booking.armed || booking.intent === 'trainSoldiers') return;
  if (mainType !== undefined && INTENT_WEAPON_CLASS[booking.intent] === mainType) {
    consumeAssistantCounter(world, ownerOf(world, e), booking.intent);
    booking.armed = true; // the armor leg may still follow
    return;
  }
  world.remove(e, AssistantRecruit);
}
