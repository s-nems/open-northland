import { BerryBush, Carrying, Position } from '../../../../../components/index.js';
import { eventAt } from '../../../../../core/events.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { BERRY_STAGE_TICKS } from '../../../../economy/berries.js';
import { accessibleStockAmounts, setAccessibleStockAmount } from '../../../../stores/index.js';
import { shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

/**
 * Consume one unit of `goodType` for an `eat` atomic: from the store `from` when given, else from the
 * settler's own carried load. A source that emptied since the planner chose it takes nothing rather than
 * going negative, and the atomic still credits the meal.
 */
export function consumeFood(world: World, settler: Entity, from: Entity | null, goodType: number): void {
  if (from !== null) {
    const stock = accessibleStockAmounts(world, from);
    if (stock === undefined) return;
    const have = stock.get(goodType) ?? 0;
    if (have <= 0) return;
    setAccessibleStockAmount(world, from, goodType, have - 1);
    reapEmptyLoosePile(world, from);
    return;
  }
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.goodType !== goodType || load.amount <= 0) return;
  shrinkCarry(world, settler, load, 1);
}

/**
 * Forage a ripe {@link BerryBush} for a completed `forage` atomic: its one serving is eaten, so the bush
 * flips to bare and schedules its first regrow step. A bush already bare or gone is a no-op, the same
 * raced-source stance as {@link consumeFood}. The entity persists and regrows in place, unlike a depleted
 * `Resource` node, which is destroyed.
 */
export function forageBerry(world: World, ctx: SystemContext, bush: Entity): void {
  const b = world.tryGet(bush, BerryBush);
  if (b === undefined || b.stage !== 'ripe') return;
  const v = world.mut(bush, BerryBush);
  v.stage = 'bare';
  v.nextStageAtTick = ctx.tick + BERRY_STAGE_TICKS;
  const pos = world.get(bush, Position);
  ctx.events.emit({ kind: 'berryForaged', bush, at: eventAt(pos.x, pos.y) });
}
