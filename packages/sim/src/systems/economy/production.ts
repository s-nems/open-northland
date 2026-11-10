import {
  AtomicClock,
  atomicElapsed,
  Building,
  CompletedCycles,
  CurrentAtomic,
  Production,
  type ProductionCycle,
  Resting,
  removeCurrentAtomic,
  Settler,
  Stockpile,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { grantProductionExperience } from '../progression/index.js';
import { productionAtomic } from '../readviews/production-atomic.js';
import { applyAtomicNeedEvents } from '../settlers/atomics/effects/need-events.js';
import { wakeCrewInside } from '../settlers/planner/idle-replan.js';
import {
  operatorCountOf,
  presentOperatorsInto,
  recipesByProductOf,
  type StaffedScratch,
} from '../stores/index.js';
import { type WorkshopWorkforce, workshopWorkforce } from '../stores/workshop-workforce.js';
import { FREE_SEAT, productionAssignmentsInto } from './production/assignments.js';
import { accrueBonusOutput } from './production/bonus-output.js';
import { depositCycleOutput, startFirstStartable } from './production/cycles.js';
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
  shelfBlockedOutputs,
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
 * advancing the oldest batch each operator can perform. Observed: a multi-worker workshop out-produces a single-worker one. With every
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
    const staffing = presentOperatorsInto(world, ctx, e, advancingCrew);
    const operators = operatorCountOf(staffing);
    if (operators <= 0) continue;
    const prod = world.mut(e, Production);
    const batches =
      staffing.kind === 'unstaffed'
        ? UNSTAFFED_ASSIGNMENT
        : productionAssignmentsInto(world, ctx, e, staffing.operators, assignmentScratch);
    // `duration` was clamped at cycle start, so the two complementary compares below are plain.
    let done: ProductionCycle[] | undefined;
    let completedOperators: Entity[] | undefined;
    for (let i = 0; i < batches.length; i++) {
      const cycle = prod.cycles[batches[i] ?? -1];
      const operator = staffing.kind === 'unstaffed' ? undefined : staffing.operators[i];
      if (cycle === undefined) {
        const display = operator === undefined ? undefined : world.tryGet(operator, CurrentAtomic);
        if (operator !== undefined && display?.effect.kind === 'produce' && display.targetEntity === e)
          removeCurrentAtomic(world, operator);
        continue;
      }
      // The batch clock owns need events, including pauses and replacement operators. The indoor
      // display atomic must not pay them again or replay an earlier frame after a re-plan.
      const settler = operator === undefined ? undefined : world.tryGet(operator, Settler);
      const atomicId =
        settler === undefined ? undefined : productionAtomic(ctx.content, settler, cycle.goodType);
      cycle.elapsed += 1;
      if (operator !== undefined && atomicId !== undefined) {
        produceEffect.recipeOutput = cycle.goodType;
        produceAtomic.atomicId = atomicId;
        applyAtomicNeedEvents(world, ctx, operator, produceAtomic, cycle.elapsed, false);
      }
      if (
        operator !== undefined &&
        atomicId !== undefined &&
        cycle.elapsed < cycle.duration &&
        world.tryGet(operator, Resting)?.at === e
      ) {
        const display = world.tryGet(operator, CurrentAtomic);
        const clock = world.tryGet(operator, AtomicClock);
        // Religion can restore an earlier batch without an arrival or completion. Re-pair the crew on
        // the next planner pass rather than leaving its old clip until the workplace's idle beat.
        if (
          display?.effect.kind !== 'produce' ||
          display.effect.recipeOutput !== cycle.goodType ||
          clock === undefined ||
          atomicElapsed(clock, ctx.tick) !== cycle.elapsed
        )
          wakeCrewInside(world, e);
      }
      if (cycle.elapsed >= cycle.duration) {
        done ??= [];
        completedOperators ??= [];
        done.push(cycle);
        if (operator !== undefined) completedOperators.push(operator);
      }
    }
    if (done === undefined || completedOperators === undefined) continue;
    wakeCrewInside(world, e);
    prod.cycles = prod.cycles.filter((c) => c.elapsed < c.duration);
    const recipes = recipesByProductOf(world, ctx, e);
    for (const cycle of done) depositCycleOutput(world, ctx, e, cycle, recipes);
    countCompletedCycles(world, e, done);
    grantProductionExperience(
      world,
      ctx,
      done.length,
      staffing.kind === 'unstaffed' ? staffing : { kind: 'staffed', operators: completedOperators },
      done.map((cycle) => cycle.goodType),
    );
    // After the grant, so the batch that just finished already counts toward its own bonus tenths.
    accrueBonusOutput(
      world,
      ctx,
      e,
      done,
      staffing.kind === 'unstaffed' ? staffing : { kind: 'staffed', operators: completedOperators },
      recipes,
    );
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
    const staffing = presentOperatorsInto(world, ctx, e, startingCrew);
    if (staffing.kind === 'unstaffed') {
      // No worker slots: one anonymous batch, first startable product in content order.
      if (running < operatorCountOf(staffing)) startFirstStartable(world, ctx, e, recipes);
      continue;
    }
    // Authored arbitration: give the actual next recipe needing more input units first access to
    // shared stock. Re-evaluate after each start; another operator may have consumed its ingredients.
    if (recipes.size > 1) workforce ??= workshopWorkforce(world, ctx);
    // Nobody on the door: no spare operator, so nothing starts.
    if (staffing.operators.length === 0) continue;
    // Operators without an executable batch may start another product; suspended work retains its inputs.
    const assigned = productionAssignmentsInto(world, ctx, e, staffing.operators, assignmentScratch);
    // The head `spare` entries; the list is reused rather than emptied, which would drop its storage.
    const next = spareOperators;
    let spare = 0;
    for (let i = 0; i < assigned.length; i++) {
      if (assigned[i] === FREE_SEAT) next[spare++] = staffing.operators[i] as Entity;
    }
    // Never resized: entries past `spare` are held undefined instead, so the list keeps one elements kind.
    const choices = choiceScratch;
    const listed = spare;
    while (spare > 0) {
      for (let i = 0; i < spare; i++) choices[i] = nextCycleFor(world, ctx, e, next[i] as Entity, recipes);
      const reserved =
        workforce !== undefined && recipes.size > 1
          ? incomingRecipeReservations(world, ctx, e, recipes, workforce, staffing.operators, choices)
          : undefined;
      const stock = world.get(e, Stockpile).amounts;
      let winner = -1;
      let mostInputs = -1;
      for (let i = 0; i < spare; i++) {
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
      for (let i = winner + 1; i < spare; i++) next[i - 1] = next[i] as Entity;
      spare--;
      choices[spare] = undefined;
    }
    // Keeps no recipe of this workshop alive past the pass.
    for (let i = 0; i < listed; i++) choices[i] = undefined;
    if ((world.tryGet(e, Production)?.cycles.length ?? 0) !== running) wakeCrewInside(world, e);
  }
};

/** The one anonymous batch an unstaffed-by-design workplace advances: its oldest. */
const UNSTAFFED_ASSIGNMENT: readonly number[] = [0];

// Per-workshop lists reused across the pass, which runs synchronously and hands none of them on.
const advancingCrew: StaffedScratch = { kind: 'staffed', operators: [] };
const startingCrew: StaffedScratch = { kind: 'staffed', operators: [] };
const assignmentScratch: number[] = [];
const spareOperators: Entity[] = [];
const choiceScratch: (CycleChoice | undefined)[] = [];

// The indoor display atomic each batch tick pays need events for, rewritten per call: the need pass
// reads it and keeps nothing.
const produceEffect: { readonly kind: 'produce'; recipeOutput: number } = {
  kind: 'produce',
  recipeOutput: 0,
};
const produceAtomic: { atomicId: number; readonly effect: typeof produceEffect } = {
  atomicId: 0,
  effect: produceEffect,
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
