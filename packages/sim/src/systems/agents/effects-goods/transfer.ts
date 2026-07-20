import {
  CARRY_CAPACITY,
  Carrying,
  DeliveryFlag,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { stockCapacity } from '../../stores/index.js';
import { carriedGoodForm } from '../economy/routing.js';
import { addCarry, dropCarryAtOwnTile, shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

// Store transfer: a settler picking a load up off a store/pile and depositing it into a store (or onto
// its own tile at a delivery flag). Goods are conserved on both sides.

/**
 * Resolve one completed `draw`: mint one unit of `goodType` onto the drawing worker's back (the `draw`
 * effect's conservation note covers why an input-less utility creates the unit). The worker reached here
 * empty — the delivery rung runs first on a loaded settler — so {@link addCarry} never merges a foreign good.
 */
export function drawUtilityGood(world: World, settler: Entity, goodType: number): void {
  addCarry(world, settler, goodType, CARRY_CAPACITY); // one unit per trip — more water/honey takes more trips
}

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. The amount is conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * The good's identity is not: a dish lifted out of the house that produces it lands on the back as the
 * edible it becomes ({@link carriedGoodForm}) — the bakery loses one bread, the carrier holds one
 * `food_simple`. Lifting the same good from anywhere else (a ground heap, a store merely holding it)
 * keeps it raw. The planner probed routing through the same helper before ordering the lift, so the
 * delivery rung already agrees on what is being carried.
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
export function pickupFromStore(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  const carried = carriedGoodForm(world, ctx, from, goodType);
  if (from === null) {
    addCarry(world, settler, carried, amount);
    return;
  }
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone — nothing to take (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  const moved = Math.min(amount, have);
  if (moved <= 0) return; // source emptied since the planner chose it — nothing to carry
  setStockAmount(world, stock.amounts, goodType, have - moved);
  addCarry(world, settler, carried, moved);
  reapEmptyLoosePile(world, from); // a fully-collected trunk / yard heap vanishes (a warehouse/hull stays)
}

/**
 * Deposit a settler's carried load. A **delivery flag** ({@link DeliveryFlag}) is a MARKER, not a store:
 * the load drops onto a loose ground heap on the tile the gatherer STANDS on ({@link dropCarryAtOwnTile}),
 * capped per tile — the planner walked it to a free yard tile first (`nearestFreeYardNode`), so the goods
 * land where its feet are and never teleport, and each heap is pinned to its own tile so relocating the
 * flag moves nothing already dropped. Any other store takes the load into its own {@link Stockpile}, capped
 * at the building type's per-good capacity, overflow staying on the settler's back (goods conserved). No-op
 * if the settler carries nothing or the (non-flag) store has no stockpile.
 */
export function pileupIntoStore(world: World, ctx: SystemContext, settler: Entity, store: Entity): void {
  if (world.has(store, DeliveryFlag)) {
    dropCarryAtOwnTile(world, settler);
    return;
  }
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.amount <= 0) return;
  const stock = world.tryGet(store, Stockpile);
  if (stock === undefined) return;

  const have = stock.amounts.get(load.goodType) ?? 0;
  const capacity = stockCapacity(world, ctx, store, load.goodType);
  const space = Math.max(0, capacity - have);
  const moved = Math.min(load.amount, space);
  if (moved <= 0) return; // store full for this good — keep carrying

  setStockAmount(world, stock.amounts, load.goodType, have + moved);
  shrinkCarry(world, settler, load, moved); // fully unloaded ⇒ Carrying removed
}
