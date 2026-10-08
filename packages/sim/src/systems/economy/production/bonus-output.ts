import type { Recipe } from '@open-northland/data';
import {
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
import type { WorkplaceOperators } from '../../stores/index.js';

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
 * credit.
 */
export function accrueBonusOutput(
  world: World,
  ctx: SystemContext,
  building: Entity,
  done: readonly ProductionCycle[],
  operators: WorkplaceOperators,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  if (operators.kind !== 'staffed') return;
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
      creditBonus(world, ctx, building, output.goodType, tenths * output.amount);
    }
  });
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
  if (tenths > 0) creditBonus(world, ctx, building, goodType, tenths);
}

/**
 * Add `tenths` of bonus output of `goodType` to the workplace's remainder and shelve every whole unit it
 * makes, past the stock capacity if need be: the cycles that earned it were admitted under the capacity,
 * so the overflow is at most their bonus. Original behavior: the produced amount lands in the house's
 * stock whole, with no capacity check.
 */
function creditBonus(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
  tenths: number,
): void {
  const banked = (world.tryGet(building, ProductionBonus)?.remainders.get(goodType) ?? 0) + tenths;
  const whole = Math.floor(banked / OUTPUT_TENTHS_PER_UNIT);
  const remainder = banked % OUTPUT_TENTHS_PER_UNIT;
  if (whole > 0) {
    const have = world.get(building, Stockpile).amounts.get(goodType) ?? 0;
    setStockAmount(world, building, goodType, have + whole);
    ctx.events.emit({ kind: 'goodProduced', building, goodType, amount: whole });
  }
  const bonus = world.tryMut(building, ProductionBonus);
  if (remainder > 0) {
    if (bonus === undefined)
      world.add(building, ProductionBonus, { remainders: new Map([[goodType, remainder]]) });
    else bonus.remainders.set(goodType, remainder);
  } else if (bonus !== undefined) {
    bonus.remainders.delete(goodType);
    if (bonus.remainders.size === 0) world.remove(building, ProductionBonus);
  }
}
