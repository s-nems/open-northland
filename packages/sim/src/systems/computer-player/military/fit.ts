import {
  type EconomicSide,
  Equipment,
  operationMembersOf,
  Position,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { fighterWeaponClass } from '../../ai-shared/military/census.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { armorGoodsByProtection, isFighterJob, mayChangeEquipSlot } from '../../readviews/index.js';
import { seatHasSide } from '../build-order/order/seat-order.js';
import { seatArmsStock } from './outfit.js';
import { isLiveFighter } from './points.js';

/** The arms sides whose seat dresses its army: chain and plate on `ironArms`, tunics on the other two. */
const ARMOURED_SIDES: readonly EconomicSide[] = ['ironArms', 'ironWeapons', 'naturalArms'];

/** No man waits for armour: a read that never dresses the army. */
export const NO_ARMOUR_WAIT: ReadonlySet<Entity> = new Set();

/**
 * The men of `men` who wait for armour before the seat counts or sends them. Owner ruling: a soldier
 * without armour while his seat has armour to give him is no army. While the seat's strategy dresses its
 * army ({@link seatDressesArmy}), as many armed men of `men` without armour as there are pieces of armour in
 * the stock its dressing errands can fetch ({@link seatArmsStock}) wait, the first in `men`'s order; the
 * rest fight as they are, no piece being there for them. `men` are the men those errands may send, the
 * seat's fighters standing at home outside every operation by default ({@link homeFighters}); a man holding
 * a tower post and one whose trade wears no armour never wait, since no errand dresses either. Costs the
 * men while the seat has armour to give.
 */
export function armourWaiters(
  world: World,
  ctx: SystemContext,
  player: number,
  men?: readonly Entity[],
): ReadonlySet<Entity> {
  if (!seatDressesArmy(world, ctx, player)) return NO_ARMOUR_WAIT;
  const stock = seatArmsStock(world, ctx, player);
  if (stock === null) return NO_ARMOUR_WAIT;
  let pieces = 0;
  for (const good of armorGoodsByProtection(ctx.content)) pieces += stock.units(good);
  if (pieces <= 0) return NO_ARMOUR_WAIT;
  const waiting = new Set<Entity>();
  for (const e of men ?? homeFighters(world, ctx, player)) {
    if (waiting.size >= pieces) break;
    if (isLiveFighter(world, e) && waitsForArmour(world, ctx, e)) waiting.add(e);
  }
  return waiting;
}

/** The seat's fighters standing at home, aboard nothing and held by no operation, ascending id: the men a
 *  dressing errand may send. */
function homeFighters(world: World, ctx: SystemContext, player: number): Entity[] {
  const held = operationMembersOf(world, player);
  return homeSettlers(world, ctx, player).filter(
    (e) => world.has(e, Position) && !held.has(e) && isFighterJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Whether `e` is an armed man an errand would dress: his armour slot empty, open to armour, and no tower
 *  post held. */
function waitsForArmour(world: World, ctx: SystemContext, e: Entity): boolean {
  if (fighterWeaponClass(world, ctx, e) === null) return false;
  if ((world.tryGet(e, Equipment)?.armor ?? null) !== null) return false;
  if (!mayChangeEquipSlot(world, ctx.content, e, 'armor')) return false;
  const jobType = world.get(e, Settler).jobType;
  return jobType === null || towerPostFor(world, ctx, e, jobType) === null;
}

/** Whether `player`'s strategy dresses its army: the content has armour and the seat picked an arms side
 *  that dresses its men in it. */
export function seatDressesArmy(world: World, ctx: SystemContext, player: number): boolean {
  if (armorGoodsByProtection(ctx.content).length === 0) return false;
  return ARMOURED_SIDES.some((side) => seatHasSide(world, player, side));
}

/**
 * Whether the fighter `e` counts in the seat's army. Owner ruling: a soldier without a weapon is no army at
 * all, nor one of `waiting`, the men waiting for armour ({@link armourWaiters}); he is armed and dressed at
 * home before the seat counts or sends him.
 */
export function isFitSoldier(
  world: World,
  ctx: SystemContext,
  e: Entity,
  waiting: ReadonlySet<Entity>,
): boolean {
  return fighterWeaponClass(world, ctx, e) !== null && !waiting.has(e);
}
