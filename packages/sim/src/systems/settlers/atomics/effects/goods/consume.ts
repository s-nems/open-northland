import { BerryBush, Carrying, Position, Stockpile, setStockAmount } from '../../../../../components/index.js';
import { eventAt } from '../../../../../core/events.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { BERRY_STAGE_TICKS } from '../../../../economy/berries.js';
import { shrinkCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

// The consume effects: eat a unit of food (from a store or the carried load) and forage a ripe berry
// bush. A raced-empty source is a no-op — nothing conjured — while the atomic still feeds the eater.

/**
 * Consume one unit of `goodType` food for an `eat` atomic: from the store `from` (a stockpile the
 * eater stands on) when given, else from the settler's own carried load. Goods are conserved — a unit
 * is removed only if one is actually present (the source may have emptied since the planner chose it,
 * or the carried load was deposited mid-swing); a missing source/empty slot is a no-op (no negative
 * stock, nothing conjured). The carried good fully consumed has its {@link Carrying} removed.
 */
export function consumeFood(world: World, settler: Entity, from: Entity | null, goodType: number): void {
  if (from !== null) {
    const stock = world.tryGet(from, Stockpile);
    if (stock === undefined) return; // source gone — nothing to consume
    const have = stock.amounts.get(goodType) ?? 0;
    if (have <= 0) return; // emptied since the planner chose it — eat anyway, but take nothing
    setStockAmount(world, from, goodType, have - 1);
    reapEmptyLoosePile(world, from); // the last bite of a ground heap reaps it (a warehouse/hull stays)
    return;
  }
  // No store: consume from the settler's own carried load.
  const load = world.tryGet(settler, Carrying);
  if (load === undefined || load.goodType !== goodType || load.amount <= 0) return;
  shrinkCarry(world, settler, load, 1); // last unit eaten ⇒ no longer carrying anything
}

/**
 * Forage a RIPE {@link BerryBush} for a completed `forage` atomic: the bush's one serving is eaten, so it
 * flips ripe→bare and schedules its first regrow step ({@link BERRY_STAGE_TICKS} ticks to bloom, the
 * exact-integer `nextStageAtTick` the BerryGrowthSystem compares against), and a `berryForaged` event fires
 * (the render static→live handover cue). A bush that is already bare (another forager beat this one to it since the
 * planner chose it) or gone is a no-op — nothing to give — but the AtomicSystem still credits the meal
 * (the bite was taken), the same raced-source stance as {@link consumeFood}'s emptied store. The bush entity
 * persists (it regrows in place, unlike a depleted {@link Resource} node that is destroyed). Pure over
 * entity state + the tick counter; no RNG/wall-clock.
 */
export function forageBerry(world: World, ctx: SystemContext, bush: Entity): void {
  const b = world.tryGet(bush, BerryBush);
  if (b === undefined || b.stage !== 'ripe') return; // bare/blooming/gone since the planner chose it — nothing to eat
  world.write(bush, BerryBush, (v) => {
    v.stage = 'bare';
    v.nextStageAtTick = ctx.tick + BERRY_STAGE_TICKS;
  });
  const pos = world.get(bush, Position);
  ctx.events.emit({ kind: 'berryForaged', bush, at: eventAt(pos.x, pos.y) });
}
