import type { Recipe } from '@open-northland/data';
import {
  Production,
  ProductionBonus,
  type ProductionCycle,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCraftingOperator, toolProductionBonusPct, wearWornTool } from '../../equipment/index.js';
import { jobExperiencePercent } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { recipesByProductOf, stockCapacity, type WorkplaceOperators } from '../../stores/index.js';

/**
 * A completed cycle's extra output on top of its recipe outputs, in tenths of a unit: the operator's
 * experience percent buys up to {@link MASTERY_BONUS_TENTHS}, its worn tool adds its own tenths, and the
 * two are summed, never multiplied. The workplace banks the tenths per good and shelves each whole unit
 * they add up to. Original behavior: a master with an iron tool makes 3.2 units per cycle.
 */

/** Tenths of a unit in one whole unit, the granularity the bonus is banked in. */
export const OUTPUT_TENTHS_PER_UNIT = 10;

/** Tenths a fully experienced operator adds per cycle: one and a half units on top of the base unit. */
export const MASTERY_BONUS_TENTHS = 15;

const PERCENT = 100;

/** The tenths `experiencePct` buys per cycle, truncated. */
export function experienceBonusTenths(experiencePct: number): number {
  return Math.trunc((experiencePct * MASTERY_BONUS_TENTHS) / PERCENT);
}

/** The tenths a tool's whole-percent credit adds per cycle, truncated. */
export function toolBonusTenths(toolPct: number): number {
  return Math.trunc((toolPct * OUTPUT_TENTHS_PER_UNIT) / PERCENT);
}

/** One operator's bonus tenths per cycle of `goodType`: experience plus tool. */
function operatorBonusTenths(world: World, ctx: SystemContext, operator: Entity, goodType: number): number {
  return (
    experienceBonusTenths(jobExperiencePercent(world, ctx, operator, goodType)) +
    toolBonusTenths(toolProductionBonusPct(world, ctx, operator))
  );
}

/**
 * The bonus-output half of a completed batch: each done cycle banks its operator's bonus tenths times its
 * recipe outputs into the workplace's {@link ProductionBonus} remainders, pairing cycles to operators index
 * for index. A crafting operator's tool wears one step per completed cycle, whether or not it rates a
 * credit. The flush runs on every completion regardless of the crediting operator's bonus, so a unit
 * banked earlier is never stranded behind a fresh worker.
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
      const tenths = operatorBonusTenths(world, ctx, op, cycle.goodType);
      if (isCraftingOperator(world, ctx, op)) wearWornTool(world, ctx, op);
      if (tenths <= 0) return;
      const outputs = recipes?.get(cycle.goodType)?.outputs ?? [{ goodType: cycle.goodType, amount: 1 }];
      for (const output of outputs) {
        // A species good is not a ware on a shelf but the calf the herd bears, so there is no fraction
        // of one to bank; the wares its slaughter yields carry the bonus instead.
        if (livestockTribeOfGood(ctx.content, output.goodType) !== null) continue;
        creditBonus(world, building, output.goodType, tenths * output.amount);
      }
    });
  }
  flushWholeUnits(world, ctx, building, recipes);
}

/**
 * Bank the worker's share of a ware banked outside a production cycle: the frames of the slaughter clip,
 * which put their goods straight on the shelf. The original pays these the same job efficiency a produced
 * good earns, with the tenths past a whole unit kept as the workplace's remainder. Only the deposit is
 * paid: the calf a breeding yields is one animal at any skill.
 */
export function accrueDepositBonus(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  goodType: number,
): void {
  const tenths = operatorBonusTenths(world, ctx, operator, goodType);
  if (tenths <= 0) return;
  creditBonus(world, building, goodType, tenths);
  flushBankedBonus(world, ctx, building);
}

/** Accumulate `tenths` of bonus output of `goodType` on the workplace's remainder map. */
function creditBonus(world: World, building: Entity, goodType: number, tenths: number): void {
  const bonus =
    world.tryMut(building, ProductionBonus) ??
    world.add(building, ProductionBonus, { remainders: new Map() });
  bonus.remainders.set(goodType, (bonus.remainders.get(goodType) ?? 0) + tenths);
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
    while (remainder >= OUTPUT_TENTHS_PER_UNIT) {
      const have = stock.get(goodType) ?? 0;
      const free =
        stockCapacity(world, ctx, building, goodType) -
        have -
        reservedFor(world, building, goodType, recipes);
      if (free <= 0) break;
      setStockAmount(world, building, goodType, have + 1);
      remainder -= OUTPUT_TENTHS_PER_UNIT;
      ctx.events.emit({ kind: 'goodProduced', building, goodType, amount: 1 });
    }
    if (remainder > 0) bonus.remainders.set(goodType, remainder);
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
