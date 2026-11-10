import { BerryBush, Carrying, PickupClaim, Position } from '../../../../../components/index.js';
import { eventAt } from '../../../../../core/events.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { accessibleStockAmounts, setAccessibleStockAmount } from '../../../../stores/index.js';
import { cappedByStorageMinimum } from '../../../targets/stores/storage-reserve.js';
import { shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

/** The units one meal takes off a shelf, the amount an eater walking to a store claims there. */
export const MEAL_UNITS = 1;

/**
 * Consume one unit of `goodType` for an `eat` atomic: from the store `from` when given, else from the
 * settler's own carried load. A source that emptied since the planner chose it takes nothing rather than
 * going negative or below its owner's storage minimum, and the atomic still credits the meal. The settler's pickup claim on the store ends here.
 */
export function consumeFood(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity | null,
  goodType: number,
): void {
  if (from !== null) {
    world.remove(settler, PickupClaim);
    const stock = accessibleStockAmounts(world, from);
    if (stock === undefined) return;
    const have = stock.get(goodType) ?? 0;
    if (cappedByStorageMinimum(world, ctx, from, goodType, Math.min(MEAL_UNITS, have)) < MEAL_UNITS) return;
    setAccessibleStockAmount(world, from, goodType, have - MEAL_UNITS);
    reapEmptyLoosePile(world, from);
    return;
  }
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.goodType !== goodType || load.amount <= 0) return;
  shrinkCarry(world, settler, load, MEAL_UNITS);
}

/**
 * Forage a ripe {@link BerryBush} for a completed `forage` atomic: its one serving is eaten, so the bush
 * flips to bare and regrows on the landscape growth trigger. A bush already bare or gone is a no-op, the same
 * raced-source stance as {@link consumeFood}. The entity persists and regrows in place, unlike a depleted
 * `Resource` node, which is destroyed.
 */
export function forageBerry(world: World, ctx: SystemContext, bush: Entity): void {
  const b = world.tryGet(bush, BerryBush);
  if (b === undefined || b.stage !== 'ripe') return;
  world.mut(bush, BerryBush).stage = 'bare';
  const pos = world.get(bush, Position);
  ctx.events.emit({ kind: 'berryForaged', bush, at: eventAt(pos.x, pos.y) });
}
