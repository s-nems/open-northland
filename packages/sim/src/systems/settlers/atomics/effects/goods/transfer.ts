import {
  CARRY_CAPACITY,
  Carrying,
  DeliveryFlag,
  Stockpile,
  setStockAmount,
  Upgrading,
} from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { flushBankedBonus } from '../../../../economy/production/bonus-output.js';
import { depositHomeQuality, homeQualityUseFor, spendHomeQuality } from '../../../../family/home-quality.js';
import { isFood } from '../../../../readviews/index.js';
import {
  accessibleStockAmounts,
  bankedSlot,
  reservedSourceSupplyInWorld,
  setAccessibleStockAmount,
} from '../../../../stores/index.js';
import { carriedGoodForm } from '../../../drives/economy/delivery-targets.js';
import { addCarry, dropCarryAtOwnTile, shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

/**
 * Resolve one completed `draw`: mint one unit of `goodType` onto the worker's back - an input-less utility
 * creates its good. The worker reached here empty, so {@link addCarry} cannot throw on a foreign load.
 */
export function drawUtilityGood(world: World, settler: Entity, goodType: number): void {
  addCarry(world, settler, goodType, CARRY_CAPACITY); // one trip's worth; more water takes more trips
}

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from the source's {@link Stockpile}
 * onto the settler's back, capped by what is left there. The amount is conserved but the identity is not:
 * a dish lands on the back as the edible it becomes in this settler's hands ({@link carriedGoodForm}), so
 * the bakery loses one bread and the carrier holds one `food_simple`. A null `from` is a sourceless pickup.
 */
export function pickupFromStore(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  const carried = carriedGoodForm(world, ctx, settler, goodType);
  if (from === null) {
    addCarry(world, settler, carried, amount);
    return;
  }
  const stock = accessibleStockAmounts(world, from);
  if (stock === undefined) return;
  const have = stock.get(goodType) ?? 0;
  const promisedToOthers = reservedSourceSupplyInWorld(world, from, goodType, settler);
  const moved = Math.min(amount, Math.max(0, have - promisedToOthers));
  if (moved <= 0) return;
  setAccessibleStockAmount(world, from, goodType, have - moved);
  addCarry(world, settler, carried, moved);
  // An upgrading workplace is stood down, and its live Stockpile is construction material rather than
  // the output shelf a banked production bonus belongs in.
  if (!world.has(from, Upgrading)) flushBankedBonus(world, ctx, from);
  reapEmptyLoosePile(world, from);
}

/**
 * Deposit a settler's carried load. A {@link DeliveryFlag} is a marker, not a store: the load drops onto a
 * ground heap on the tile the settler stands on, pinned to that tile, so relocating the flag moves nothing
 * already dropped. Any other store takes the load into its own {@link Stockpile} up to the building type's
 * per-good capacity, overflow staying on the back. Returns the units taken into a stockpile; a flag drop
 * returns 0, since a ground heap is not a delivery.
 */
export function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): number {
  if (world.has(store, DeliveryFlag)) {
    dropCarryAtOwnTile(world, settler);
    return 0;
  }
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return 0;
  const qualityMoved = depositHomeQuality(world, ctx, store, load.goodType, load.amount);
  if (qualityMoved > 0) {
    shrinkCarry(world, settler, load, qualityMoved);
    return qualityMoved;
  }
  const stock = world.tryGet(store, Stockpile);
  if (stock === undefined) return 0;

  const slot = bankedSlot(world, ctx, store, load.goodType); // the shelf settles the good's final identity
  const have = stock.amounts.get(slot.goodType) ?? 0;
  const moved = Math.min(load.amount, Math.max(0, slot.capacity - have));
  if (moved <= 0) return 0;

  let deposited = moved;
  // A stocked home with crockery turns each delivered food unit into two before it reaches the larder.
  // Crockery spends one durability use per delivery batch, matching an original routine.
  const cooking = homeQualityUseFor(ctx, 'cooking');
  if (
    moved > 0 &&
    isFood(ctx, slot.goodType) &&
    cooking !== undefined &&
    spendHomeQuality(world, store, 'cooking', cooking.useCost)
  )
    deposited += 1;
  setStockAmount(world, store, slot.goodType, Math.min(slot.capacity, have + deposited));
  shrinkCarry(world, settler, load, moved);
  return moved;
}
