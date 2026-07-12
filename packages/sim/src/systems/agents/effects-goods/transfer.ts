import { Carrying, DeliveryFlag, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { stockCapacity } from '../../stores/index.js';
import { addCarry, dropCarryAtOwnTile, shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

// Store transfer: a settler picking a load up off a store/pile and depositing it into a store (or onto
// its own tile at a delivery flag). Goods are conserved on both sides.

/**
 * Resolve one completed `pickup`: move up to `amount` of `goodType` from a source store's
 * {@link Stockpile} onto the settler's back. Goods are conserved — the carrier gains exactly what
 * the source loses, so a pickup never creates or destroys goods (carriers haul; nothing teleports).
 * When `from` is null (a sourceless pickup) the goods simply appear carried; otherwise the available
 * amount caps the transfer (the source may have shrunk between the planner choosing it and the swing
 * completing — a competing system or another carrier). A source with nothing left to give is a no-op.
 */
export function pickupFromStore(
  world: World,
  settler: Entity,
  from: Entity | null,
  goodType: number,
  amount: number,
): void {
  if (from === null) {
    addCarry(world, settler, goodType, amount);
    return;
  }
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone — nothing to take (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  const moved = Math.min(amount, have);
  if (moved <= 0) return; // source emptied since the planner chose it — nothing to carry
  stock.amounts.set(goodType, have - moved);
  addCarry(world, settler, goodType, moved);
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

  stock.amounts.set(load.goodType, have + moved);
  shrinkCarry(world, settler, load, moved); // fully unloaded ⇒ Carrying removed
}
