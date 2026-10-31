import { type EconomicSide, Equipment, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { fighterWeaponClass } from '../../ai-shared/military/census.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { armorGoodsByProtection, mayChangeEquipSlot } from '../../readviews/index.js';
import { seatHasSide } from '../build-order/seat-order.js';
import { seatArmsStock } from './outfit.js';

/** The arms sides whose seat dresses its army: chain and plate on `ironArms`, tunics on the other two. */
const ARMOURED_SIDES: readonly EconomicSide[] = ['ironArms', 'ironWeapons', 'naturalArms'];

/** Whether `player`'s army waits for armour: the seat's strategy picked an arms side that dresses its army,
 *  and armour lies in the stock its dressing errands can fetch ({@link seatArmsStock}). With none to fetch
 *  an armed man fights as he is: a sword without a coat still counts, a coat waiting in store does not. */
export function armyWearsArmour(world: World, ctx: SystemContext, player: number): boolean {
  if (!seatDressesArmy(world, ctx, player)) return false;
  const stock = seatArmsStock(world, ctx, player);
  return stock !== null && armorGoodsByProtection(ctx.content).some((good) => stock.units(good) > 0);
}

/** Whether `player`'s strategy dresses its army: the content has armour and the seat picked an arms side
 *  that dresses its men in it. */
export function seatDressesArmy(world: World, ctx: SystemContext, player: number): boolean {
  if (armorGoodsByProtection(ctx.content).length === 0) return false;
  return ARMOURED_SIDES.some((side) => seatHasSide(world, player, side));
}

/**
 * Whether the fighter `e` counts in the seat's army. Owner ruling: a soldier without a weapon, or without
 * armour while his seat has armour to give him (`wearsArmour`, {@link armyWearsArmour}), is no army at all;
 * he is armed and dressed at home before the seat counts or sends him. Authored: a man holding a tower post and one
 * whose trade wears no armour need none, since no errand dresses either.
 */
export function isFitSoldier(world: World, ctx: SystemContext, e: Entity, wearsArmour: boolean): boolean {
  if (fighterWeaponClass(world, ctx, e) === null) return false;
  if (!wearsArmour || (world.tryGet(e, Equipment)?.armor ?? null) !== null) return true;
  if (!mayChangeEquipSlot(world, ctx.content, e, 'armor')) return true;
  const jobType = world.get(e, Settler).jobType;
  return jobType !== null && towerPostFor(world, ctx, e, jobType) !== null;
}
