import type { Recipe } from '@open-northland/data';
import {
  ProductionBonus,
  type ProductionCycle,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { operatorProductionBonus } from '../../progression/index.js';
import { stockCapacity, type WorkplaceOperators } from '../../stores/index.js';

/**
 * The experience-bonus half of a completed batch: an experienced operator's cycle yields a fraction of
 * extra output ("baker 5" bakes ~1.5 bread per cycle). Each done cycle credits its operator's current
 * bonus ({@link operatorProductionBonus}) times each output's amount into the workplace's
 * {@link ProductionBonus} remainders; whole units move into the stockpile the moment a remainder
 * crosses 1.0 and the good has room (a full store holds the remainder until space frees), so
 * withdrawal only ever sees whole units (design rule, user-specified). Cycle→operator pairing is the
 * same canonical slice the XP grant and piety charge use.
 */
export function accrueBonusOutput(
  world: World,
  ctx: SystemContext,
  building: Entity,
  done: readonly ProductionCycle[],
  operators: WorkplaceOperators,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  if (operators.kind === 'unstaffed') return; // an anonymous batch has no operator to be good at it
  done.forEach((cycle, i) => {
    const op = operators.operators[i];
    if (op === undefined) return;
    const bonus = operatorProductionBonus(world, ctx, op);
    if (bonus <= ZERO) return;
    const outputs = recipes?.get(cycle.goodType)?.outputs ?? [{ goodType: cycle.goodType, amount: 1 }];
    for (const output of outputs) {
      addBonusRemainder(world, ctx, building, output.goodType, fx.mul(bonus, fx.fromInt(output.amount)));
    }
  });
  reapEmptyBonus(world, building);
}

/** Accumulate `extra` bonus output of `goodType`, converting each whole unit into real stock while the
 *  good has room (emitting `goodProduced` per unit, like a deposited batch). */
function addBonusRemainder(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
  extra: Fixed,
): void {
  const bonus =
    world.tryGet(building, ProductionBonus) ??
    world.add(building, ProductionBonus, { remainders: new Map() });
  let remainder = fx.add(bonus.remainders.get(goodType) ?? ZERO, extra);
  const stock = world.get(building, Stockpile).amounts;
  while (remainder >= ONE) {
    const have = stock.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, building, goodType)) break; // full — hold until space frees
    setStockAmount(world, stock, goodType, have + 1);
    remainder = fx.sub(remainder, ONE);
    ctx.events.emit({ kind: 'goodProduced', building, goodType, amount: 1 });
  }
  if (remainder > ZERO) bonus.remainders.set(goodType, remainder);
  else bonus.remainders.delete(goodType);
}

/** Drop the component once every remainder is zero — its absence means "no pending bonus fraction". */
function reapEmptyBonus(world: World, building: Entity): void {
  const bonus = world.tryGet(building, ProductionBonus);
  if (bonus !== undefined && bonus.remainders.size === 0) world.remove(building, ProductionBonus);
}
