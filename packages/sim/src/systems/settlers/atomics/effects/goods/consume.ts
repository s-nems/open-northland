import { BerryBush, Carrying, Position } from '../../../../../components/index.js';
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
 * Take the unit of `goodType` a meal about to start eats: off the store or pile `from` when given, else
 * off the settler's own carried load. False, taking nothing, when the source no longer gives it up: it
 * emptied, or its owner's storage minimum holds the unit back. The check and the take are one step, so
 * a unit feeds one eater.
 */
export function takeMealUnit(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity | null,
  goodType: number,
): boolean {
  if (from === null) {
    const load = world.tryGet(settler, Carrying);
    if (load === undefined || load.goodType !== goodType || load.amount < MEAL_UNITS) return false;
    shrinkCarry(world, settler, load, MEAL_UNITS);
    return true;
  }
  const have = accessibleStockAmounts(world, from)?.get(goodType) ?? 0;
  if (cappedByStorageMinimum(world, ctx, from, goodType, Math.min(MEAL_UNITS, have)) < MEAL_UNITS)
    return false;
  setAccessibleStockAmount(world, from, goodType, have - MEAL_UNITS);
  reapEmptyLoosePile(world, from);
  return true;
}

/**
 * Pick the one serving off a ripe {@link BerryBush} for a meal about to start: the bush flips to bare and
 * regrows on the landscape growth trigger. False, picking nothing, when the bush is gone or holds no
 * fruit. The entity persists and regrows in place, unlike a depleted `Resource` node, which is destroyed.
 */
export function pickBerry(world: World, ctx: SystemContext, bush: Entity): boolean {
  if (world.tryGet(bush, BerryBush)?.stage !== 'ripe') return false;
  world.mut(bush, BerryBush).stage = 'bare';
  const pos = world.get(bush, Position);
  ctx.events.emit({ kind: 'berryForaged', bush, at: eventAt(pos.x, pos.y) });
  return true;
}
