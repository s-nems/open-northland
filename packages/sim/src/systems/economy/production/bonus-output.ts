import type { Recipe } from '@open-northland/data';
import {
  Production,
  ProductionBonus,
  type ProductionCycle,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCraftingOperator, toolProductionBonus, wearWornTool } from '../../equipment/index.js';
import { operatorProductionBonus } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { recipesByProductOf, stockCapacity, type WorkplaceOperators } from '../../stores/index.js';

/**
 * The bonus-output half of a completed batch: each done cycle credits its operator's experience bonus plus
 * its worn tool's credit - a sum, never a product - times its recipe outputs into the workplace's
 * {@link ProductionBonus} remainders, pairing cycles to operators index for index. A crafting operator's
 * tool wears one step per completed cycle, whether or not it rates a credit. The flush runs on every
 * completion regardless of the crediting operator's bonus, so a unit banked earlier is never stranded
 * behind a fresh worker.
 */
export function accrueBonusOutput(
  world: World,
  ctx: SystemContext,
  building: Entity,
  done: readonly ProductionCycle[],
  operators: WorkplaceOperators,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  if (operators.kind === 'staffed') {
    done.forEach((cycle, i) => {
      const op = operators.operators[i];
      if (op === undefined) return;
      // Credit before wearing: the cycle that breaks the tool is still a cycle the tool worked, so a tool
      // rated `uses: N` credits N cycles, not N - 1.
      const bonus = fx.add(
        operatorProductionBonus(world, ctx, op, cycle.goodType),
        toolProductionBonus(world, ctx, op),
      );
      if (isCraftingOperator(world, ctx, op)) wearWornTool(world, ctx, op);
      if (bonus <= ZERO) return;
      const outputs = recipes?.get(cycle.goodType)?.outputs ?? [{ goodType: cycle.goodType, amount: 1 }];
      for (const output of outputs) {
        // A species good is not a ware on a shelf but the calf the herd bears, so there is no fraction
        // of one to bank; the wares its slaughter yields carry the bonus instead.
        if (livestockTribeOfGood(ctx.content, output.goodType) !== null) continue;
        creditBonus(world, building, output.goodType, fx.mul(bonus, fx.fromInt(output.amount)));
      }
    });
  }
  flushWholeUnits(world, ctx, building, recipes);
}

/**
 * Bank the worker's share of a ware banked outside a production cycle: the frames of the slaughter clip,
 * which put their goods straight on the shelf. The original pays these the same job efficiency a produced
 * good earns - experience plus tool, summed, and the tenths past a whole unit kept as a decimal remainder,
 * which is what the workplace's remainders are. Only the deposit is paid: the calf a breeding yields is one
 * animal at any skill.
 */
export function accrueDepositBonus(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  goodType: number,
): void {
  const bonus = fx.add(
    operatorProductionBonus(world, ctx, operator, goodType),
    toolProductionBonus(world, ctx, operator),
  );
  if (bonus <= ZERO) return;
  creditBonus(world, building, goodType, bonus);
  flushBankedBonus(world, ctx, building);
}

/** Accumulate `extra` bonus output of `goodType` on the workplace's remainder map. */
function creditBonus(world: World, building: Entity, goodType: number, extra: Fixed): void {
  const bonus =
    world.tryMut(building, ProductionBonus) ??
    world.add(building, ProductionBonus, { remainders: new Map() });
  bonus.remainders.set(goodType, fx.add(bonus.remainders.get(goodType) ?? ZERO, extra));
}

/**
 * Flush a workplace's banked whole bonus units after stock left it: a withdrawal frees the space a
 * capacity-blocked unit was waiting for, and the completion-path flush may never come again.
 */
export function flushBankedBonus(world: World, ctx: SystemContext, building: Entity): void {
  if (!world.has(building, ProductionBonus)) return;
  flushWholeUnits(world, ctx, building, recipesByProductOf(world, ctx, building));
}

/**
 * Move each whole remainder unit into real stock, emitting `goodProduced` like a deposited batch. The room
 * in-flight same-product batches reserved is left alone, since their own deposits are unconditional, so a
 * blocked bonus unit holds until space frees.
 */
function flushWholeUnits(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  const bonus = world.tryMut(building, ProductionBonus);
  if (bonus === undefined) return;
  const stock = world.get(building, Stockpile).amounts;
  for (const [goodType, held] of bonus.remainders) {
    let remainder = held;
    while (remainder >= ONE) {
      const have = stock.get(goodType) ?? 0;
      const free =
        stockCapacity(world, ctx, building, goodType) -
        have -
        reservedFor(world, building, goodType, recipes);
      if (free <= 0) break;
      setStockAmount(world, building, goodType, have + 1);
      remainder = fx.sub(remainder, ONE);
      ctx.events.emit({ kind: 'goodProduced', building, goodType, amount: 1 });
    }
    if (remainder > ZERO) bonus.remainders.set(goodType, remainder);
    else bonus.remainders.delete(goodType);
  }
  if (bonus.remainders.size === 0) world.remove(building, ProductionBonus);
}

/** Units of `goodType` the in-flight cycles will deposit on completion - the reserved slots a bonus
 *  unit must leave free. Mirrors the per-batch reservation `outputRoomForCycles` admits cycles under. */
function reservedFor(
  world: World,
  building: Entity,
  goodType: number,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): number {
  const cycles = world.tryGet(building, Production)?.cycles;
  if (cycles === undefined) return 0;
  let reserved = 0;
  for (const c of cycles) {
    const outputs = recipes?.get(c.goodType)?.outputs ?? [{ goodType: c.goodType, amount: 1 }];
    for (const output of outputs) if (output.goodType === goodType) reserved += output.amount;
  }
  return reserved;
}
