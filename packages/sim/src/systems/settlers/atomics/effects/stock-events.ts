import { Settler, Stockpile, setStockAmount } from '../../../../components/index.js';
import type { AtomicEffect } from '../../../../core/atomic-effect.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { accrueDepositBonus } from '../../../economy/production.js';
import { stockDepositsAt } from '../../../livestock/index.js';
import { stockCapacity } from '../../../stores/index.js';

/**
 * Put the goods the running slaughter clip names at this frame into the work house, the original's
 * `PUT_GOOD_IN_STOCK` event: it is gated on the worker being attached to the house, not on the ware being
 * discovered, so a settlement with no hunter still gets leather off its own cattle.
 *
 * A unit past the shelf's capacity is lost (approximation): the breeder's cycle carries a full ware out
 * before it slaughters, so a full shelf here means something else filled it mid-clip. Each unit that does
 * land earns the slaughterer's experience share on top, as the original scales the deposit by his job
 * efficiency.
 */
export function applyAtomicStockEvents(
  world: World,
  ctx: SystemContext,
  e: Entity,
  atomic: { readonly atomicId: number; readonly effect: AtomicEffect },
  elapsed: number,
): void {
  if (atomic.effect.kind !== 'slay') return;
  const farm = atomic.effect.farm;
  if (!world.has(farm, Stockpile)) return;
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return;
  for (const good of stockDepositsAt(ctx, settler, atomic.atomicId, elapsed)) {
    const stock = world.get(farm, Stockpile).amounts;
    const have = stock.get(good) ?? 0;
    if (have >= stockCapacity(world, ctx, farm, good)) continue;
    setStockAmount(world, farm, good, have + 1);
    ctx.events.emit({ kind: 'goodProduced', building: farm, goodType: good, amount: 1 });
    accrueDepositBonus(world, ctx, farm, e, good);
  }
}
