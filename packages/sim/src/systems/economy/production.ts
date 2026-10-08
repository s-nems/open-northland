import {
  Building,
  CompletedCycles,
  Production,
  type ProductionCycle,
  Stockpile,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { grantProductionExperience } from '../progression/index.js';
import { wakeCrewInside } from '../settlers/planner/idle-replan.js';
import {
  operatorCountOf,
  presentOperatorCount,
  presentOperators,
  recipesByProductOf,
} from '../stores/index.js';
import { type WorkshopWorkforce, workshopWorkforce } from '../stores/workshop-workforce.js';
import { accrueBonusOutput } from './production/bonus-output.js';
import { depositCycleOutput, startFirstStartable } from './production/cycles.js';
import { chargeMilitaryPietyCost } from './production/piety.js';
import { incomingRecipeReservations, recipeInputUnits } from './production/reservations.js';
import { type CycleChoice, nextCycleFor, startCycleChoice } from './production/rotation.js';
import { cycleStartable } from './production/start-gate.js';

export {
  accrueDepositBonus,
  experienceBonusTenths,
  MASTERY_BONUS_TENTHS,
  OUTPUT_TENTHS_PER_UNIT,
  toolBonusTenths,
} from './production/bonus-output.js';
export {
  BREEDING_PAIR,
  isYardBuilt,
  outputRoomForCycles,
  shelfBlockedOutput,
  startableCycleCount,
} from './production/cycles.js';
export {
  advanceRotation,
  craftablePool,
  nextRotationPick,
  type RotationPick,
  skipUnfundedRecipe,
  spendRotationPick,
} from './production/rotation.js';

/**
 * One workplace turns input goods into output goods over time, one independent batch per present operator,
 * advanced oldest first. Observed: a multi-worker workshop out-produces a single-worker one. With every
 * operator away all cycles pause and `elapsed` is held rather than lost.
 *
 * A workplace produces only while an assigned operator is present, the original's staffed-workshop rule; a carrier at
 * the door neither runs nor speeds the craft. A building type declaring no worker slots is
 * unstaffed-by-design and produces one anonymous batch freely.
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so goods are conserved, and timing
 * is the exact integer compare `elapsed >= duration` rather than an accumulated fixed-point step.
 */
export const productionSystem: System = (world, ctx) => {
  let workforce: WorkshopWorkforce | undefined;
  // Advance running cycles before starting new ones, so a cycle started this tick begins counting next
  // tick rather than being advanced twice.
  for (const e of world.query(Production, Stockpile)) {
    // The tech unlock is a start-only gate, so a committed cycle finishes even if the enabling settler
    // later dies. The worker-presence gate does pause mid-cycle.
    const operators = presentOperatorCount(world, ctx, e);
    if (operators <= 0) continue;
    const prod = world.mut(e, Production);
    const advanced = Math.min(operators, prod.cycles.length);
    // `duration` was clamped at cycle start, so the two complementary compares below are plain.
    let finished = 0;
    for (let i = 0; i < advanced; i++) {
      const cycle = prod.cycles[i];
      if (cycle === undefined) break;
      cycle.elapsed += 1;
      if (cycle.elapsed >= cycle.duration) finished++;
    }
    if (finished === 0) continue; // the usual tick: batches grind on with nothing to deposit
    // The crew the count above saw: only the batch timers were written since.
    const staffing = presentOperators(world, ctx, e);
    wakeCrewInside(world, e);
    const done = prod.cycles.filter((c) => c.elapsed >= c.duration);
    prod.cycles = prod.cycles.filter((c) => c.elapsed < c.duration);
    const recipes = recipesByProductOf(world, ctx, e);
    for (const cycle of done) depositCycleOutput(world, ctx, e, cycle, recipes);
    countCompletedCycles(world, e, done);
    chargeMilitaryPietyCost(world, ctx, done, staffing);
    grantProductionExperience(
      world,
      ctx,
      done.length,
      staffing,
      done.map((cycle) => cycle.goodType),
    );
    // After the grant, so the batch that just finished already counts toward its own bonus tenths.
    accrueBonusOutput(world, ctx, e, done, staffing, recipes);
    if (prod.cycles.length === 0) world.remove(e, Production);
  }

  // Start cycles on workplaces with spare present operators. Each start re-checks the gate, since inputs
  // shrink and same-product pending outputs grow with every batch started.
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).built < ONE) continue;
    const recipes = recipesByProductOf(world, ctx, e);
    if (recipes === undefined) continue;
    // Dormancy gate before the operator lookup: the per-recipe gates are operator-independent, so a starved
    // or output-blocked workshop skips the lookup. It elides only a provably-empty loop.
    if (!cycleStartable(world, ctx, e, recipes)) continue;
    const running = world.tryGet(e, Production)?.cycles.length ?? 0;
    const staffing = presentOperators(world, ctx, e);
    if (staffing.kind === 'unstaffed') {
      // No worker slots: one anonymous batch, first startable product in content order.
      if (running < operatorCountOf(staffing)) startFirstStartable(world, ctx, e, recipes);
      continue;
    }
    // Authored arbitration: give the actual next recipe needing more input units first access to
    // shared stock. Re-evaluate after each start; another operator may have consumed its ingredients.
    if (recipes.size > 1) workforce ??= workshopWorkforce(world, ctx);
    if (staffing.operators.length <= running) continue; // every present operator runs a batch
    // The seats past the running batches, each taking its own product choice; a failed choice skips just
    // that operator.
    const next = staffing.operators.slice(running);
    const choices: (CycleChoice | undefined)[] = [];
    while (next.length > 0) {
      choices.length = next.length;
      for (let i = 0; i < next.length; i++)
        choices[i] = nextCycleFor(world, ctx, e, next[i] as Entity, recipes);
      const reserved =
        workforce !== undefined && recipes.size > 1
          ? incomingRecipeReservations(world, ctx, e, recipes, workforce, staffing.operators, choices)
          : undefined;
      const stock = world.get(e, Stockpile).amounts;
      let winner = -1;
      let mostInputs = -1;
      for (let i = 0; i < next.length; i++) {
        const choice = choices[i];
        if (choice === undefined || dipsIntoReserve(stock, choice, reserved)) continue;
        const units = recipeInputUnits(choice.recipe);
        if (units > mostInputs) {
          winner = i;
          mostInputs = units;
        }
      }
      const choice = winner < 0 ? undefined : choices[winner];
      if (choice === undefined) break;
      startCycleChoice(world, ctx, e, next[winner] as Entity, choice);
      next.splice(winner, 1);
    }
    if ((world.tryGet(e, Production)?.cycles.length ?? 0) !== running) wakeCrewInside(world, e);
  }
};

/** Whether starting `choice` would take stock below zero or below what the reservations hold back. */
function dipsIntoReserve(
  stock: ReadonlyMap<number, number>,
  choice: CycleChoice,
  reserved: ReadonlyMap<number, number> | undefined,
): boolean {
  for (let i = 0; i < choice.recipe.inputs.length; i++) {
    const input = choice.recipe.inputs[i];
    if (
      input !== undefined &&
      (stock.get(input.goodType) ?? 0) - input.amount < (reserved?.get(input.goodType) ?? 0)
    ) {
      return true;
    }
  }
  return false;
}

function countCompletedCycles(world: World, building: Entity, done: readonly ProductionCycle[]): void {
  const tally = world.tryMut(building, CompletedCycles);
  if (tally === undefined) return;
  for (const cycle of done) tally.byGood.set(cycle.goodType, (tally.byGood.get(cycle.goodType) ?? 0) + 1);
}
