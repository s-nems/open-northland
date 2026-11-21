import type { AtomicAnimation } from '@open-northland/data';
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
  startWorkClock,
  stopWorkClock,
  workClockTicks,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { grantProductionExperience } from '../progression/index.js';
import { atomicClip, clipEventFactsOf } from '../readviews/animations.js';
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
import { type ClaimProbe, FREE_SEAT, productionAssignmentsInto } from './production/assignments.js';
import { accrueBonusOutput } from './production/bonus-output.js';
import { depositCycleOutput, startFirstStartable } from './production/cycles.js';
import { crewOffRoute, NEVER_DUE, type ProductionDormancy, watchProduction } from './production/dormancy.js';
import { incomingRecipeReservations, recipeInputUnits } from './production/reservations.js';
import { type CycleChoice, lastStartOf, nextCycleFor, startCycleChoice } from './production/rotation.js';
import { cycleStartable, tribesTabled } from './production/start-gate.js';

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
 * each advancing its own oldest batch it can perform, else one left open to it. Observed: a multi-worker
 * workshop out-produces a single-worker one. With every operator away all cycles pause and their worked
 * ticks are held rather than lost. A batch's clock is anchored while an operator works it, so a running
 * batch writes nothing until it completes or stops, and its workshop is visited only on the ticks
 * {@link ProductionDormancy} files it under.
 *
 * A workplace produces only while an assigned operator is present, the original's staffed-workshop rule; a carrier at
 * the door neither runs nor speeds the craft. A building type declaring no worker slots is
 * unstaffed-by-design and produces one anonymous batch freely.
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so goods are conserved, and timing
 * is the exact integer compare of worked ticks against `duration` rather than an accumulated fixed-point
 * step.
 */
export const productionSystem: System = (world, ctx) => {
  const dormancy = dormancyOf(world, ctx);
  const tick = ctx.tick;
  dormancy.begin(tick, ctx.content);
  // Advance running cycles before starting new ones, so a cycle started this tick begins counting next
  // tick rather than being advanced twice.
  for (const e of world.query(Production, Stockpile)) {
    dormancy.catchUp();
    if (!dormancy.advanceDue(e, tick)) continue;
    const due = advanceBatches(world, ctx, e, tick, false);
    dormancy.fileAdvance(e, crewOffRoute(world, e) ? due : tick + 1);
  }

  // Start cycles on workplaces with spare present operators.
  startPass.workforce = undefined;
  dormancy.catchUpUnlocks();
  for (const e of world.query(Building, Stockpile)) {
    dormancy.catchUp();
    if (!dormancy.startDue(e)) continue;
    const asleep = startBatches(world, ctx, e, tick, false) && crewOffRoute(world, e);
    dormancy.fileStart(e, asleep);
    if (!asleep) dormancy.catchUpUnlocks();
  }
  startPass.workforce = undefined;
};

/** A world's dormancy and the context of its last pass, which the tripwire asks its dry visits under. */
interface HeldDormancy {
  readonly dormancy: ProductionDormancy;
  ctx: SystemContext;
}

const dormancies = new WeakMap<World, HeldDormancy>();

function dormancyOf(world: World, ctx: SystemContext): ProductionDormancy {
  let held = dormancies.get(world);
  if (held === undefined) {
    const created: HeldDormancy = { dormancy: watchProduction(world), ctx };
    dormancies.set(world, created);
    world.registerCacheVerifier('productionDormancy', () =>
      created.dormancy.verify(
        (e, tick) => (crewOffRoute(world, e) ? advanceBatches(world, created.ctx, e, tick, true) : tick),
        (e, tick) => startBatches(world, created.ctx, e, tick, true) && crewOffRoute(world, e),
      ),
    );
    held = created;
  }
  held.ctx = ctx;
  return held.dormancy;
}

/**
 * Advance `e`'s batches on `tick` and answer the next tick they need a visit while the workshop and its
 * crew stay as they are: the next one after a visit that acted, else the first a batch completes or pays
 * a need event on, {@link NEVER_DUE} with none worked. `dry` writes nothing and answers `tick` itself
 * where the visit would act.
 */
function advanceBatches(world: World, ctx: SystemContext, e: Entity, tick: number, dry: boolean): number {
  // The tech unlock is a start-only gate, so a committed cycle finishes even if the enabling settler
  // later dies. The worker-presence gate does pause mid-cycle.
  const staffing = presentOperatorsInto(world, ctx, e, advancingCrew);
  const operators = operatorCountOf(staffing);
  const cycles = world.get(e, Production).cycles;
  if (operators <= 0) {
    if (!stopUnworkedCycles(world, tick, e, cycles, NO_BATCHES, dry)) return NEVER_DUE;
    return dry ? tick : tick + 1;
  }
  claimProbe.emptyReserve = false;
  // Ahead of this tick's advance, a running batch's clock reads as the previous tick left it.
  const batches =
    staffing.kind === 'unstaffed'
      ? UNSTAFFED_ASSIGNMENT
      : productionAssignmentsInto(world, ctx, e, staffing.operators, assignmentScratch, tick - 1, claimProbe);
  // A claim that met an empty religion reserve is asked again every tick.
  let due = claimProbe.emptyReserve ? tick + 1 : NEVER_DUE;
  // `duration` was clamped at cycle start, so the two complementary compares below are plain.
  let done: DeepReadonly<ProductionCycle>[] | undefined;
  let completedOperators: Entity[] | undefined;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? -1;
    const cycle = cycles[batch];
    const operator = staffing.kind === 'unstaffed' ? undefined : staffing.operators[i];
    if (cycle === undefined) {
      const display = operator === undefined ? undefined : world.tryGet(operator, CurrentAtomic);
      if (operator !== undefined && display?.effect.kind === 'produce' && display.targetEntity === e) {
        if (dry) return tick;
        removeCurrentAtomic(world, operator);
        due = tick + 1;
      }
      continue;
    }
    // A batch left open passes to the operator now working it, so its old owner does not take it back
    // half done.
    if (operator !== undefined && cycle.operator !== operator) {
      if (dry) return tick;
      writableCycle(world, e, batch).operator = operator;
      due = tick + 1;
    }
    // The batch clock owns need events, including pauses and replacement operators. The indoor
    // display atomic must not pay them again or replay an earlier frame after a re-plan.
    const settler = operator === undefined ? undefined : world.tryGet(operator, Settler);
    const atomicId =
      settler === undefined ? undefined : productionAtomic(ctx.content, settler, cycle.goodType);
    if (cycle.startedAt === undefined) {
      if (dry) return tick;
      startWorkClock(writableCycle(world, e, batch), tick);
      due = tick + 1;
    }
    const elapsed = workClockTicks(cycle, tick);
    const clip =
      settler === undefined || atomicId === undefined
        ? undefined
        : atomicClip(ctx.content, settler, atomicId);
    if (operator !== undefined && atomicId !== undefined) {
      if (dry) {
        if (clip !== undefined && clipEventFactsOf(clip).needFrames.has(elapsed - 1)) return tick;
      } else {
        produceEffect.recipeOutput = cycle.goodType;
        produceAtomic.atomicId = atomicId;
        applyAtomicNeedEvents(world, ctx, operator, produceAtomic, elapsed, false);
      }
    }
    if (
      operator !== undefined &&
      atomicId !== undefined &&
      elapsed < cycle.duration &&
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
        atomicElapsed(clock, tick) !== elapsed
      ) {
        if (dry) return tick;
        wakeCrewInside(world, e);
        due = tick + 1;
      } else if (!('startedAt' in clock)) {
        // A display clock not yet anchored falls behind the batch on the next tick.
        due = tick + 1;
      }
    }
    if (elapsed >= cycle.duration) {
      if (dry) return tick;
      done ??= [];
      completedOperators ??= [];
      done.push(cycle);
      if (operator !== undefined) completedOperators.push(operator);
    } else {
      due = Math.min(due, tick + nextBatchEvent(cycle.duration, clip, elapsed) - elapsed);
    }
  }
  if (stopUnworkedCycles(world, tick, e, cycles, batches, dry)) {
    if (dry) return tick;
    due = tick + 1;
  }
  if (done === undefined || completedOperators === undefined) return due;
  wakeCrewInside(world, e);
  const finished = done;
  const prod = world.mut(e, Production);
  prod.cycles = prod.cycles.filter((c) => !finished.includes(c));
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
  return tick + 1;
}

/** The worked ticks, past `elapsed`, at which a batch `duration` ticks long next completes or pays a need
 *  event of `clip`, which it plays once: frame `at` on worked tick `at + 1`. */
function nextBatchEvent(duration: number, clip: AtomicAnimation | undefined, elapsed: number): number {
  let next = duration;
  if (clip === undefined) return next;
  for (const frame of clipEventFactsOf(clip).needFrames) {
    const at = frame + 1;
    if (at > elapsed && at < next) next = at;
  }
  return next;
}

/**
 * Start what batches `e`'s spare present operators may on `tick`, and answer whether the workshop then
 * sleeps: nothing can start there until it, its crew or the technology unlocks change. Each start
 * re-checks the gate, since inputs shrink and same-product pending outputs grow with every batch started.
 * `dry` starts nothing and answers for the workshop as it stands.
 */
function startBatches(world: World, ctx: SystemContext, e: Entity, tick: number, dry: boolean): boolean {
  if (world.get(e, Building).built < ONE) return true;
  const recipes = recipesByProductOf(world, ctx, e);
  if (recipes === undefined) return true;
  // Dormancy gate before the operator lookup: the per-recipe gates are operator-independent, so a starved
  // or output-blocked workshop skips the lookup. It elides only a provably-empty loop. A gate of a tribe
  // without a technology table reads state the dormancy does not watch, so it is asked every tick.
  if (!cycleStartable(world, ctx, e, recipes)) return tribesTabled(world, ctx, e);
  const running = world.tryGet(e, Production)?.cycles.length ?? 0;
  const staffing = presentOperatorsInto(world, ctx, e, startingCrew);
  if (staffing.kind === 'unstaffed') {
    // No worker slots: one anonymous batch, first startable product in content order.
    if (running >= operatorCountOf(staffing)) return true;
    if (!dry) startFirstStartable(world, ctx, e, recipes);
    return false;
  }
  // Nobody on the door: no spare operator, so nothing starts.
  if (staffing.operators.length === 0) return true;
  // Operators without an executable batch may start another product; suspended work retains its inputs.
  claimProbe.emptyReserve = false;
  const assigned = productionAssignmentsInto(
    world,
    ctx,
    e,
    staffing.operators,
    assignmentScratch,
    tick,
    claimProbe,
  );
  // The head `spare` entries; the list is reused rather than emptied, which would drop its storage.
  const next = spareOperators;
  let spare = 0;
  for (let i = 0; i < assigned.length; i++) {
    if (assigned[i] === FREE_SEAT) next[spare++] = staffing.operators[i] as Entity;
  }
  // Every operator holds a batch: one is free again only once the crew or a batch changes, unless a
  // claim met an empty religion reserve.
  if (spare === 0) return !claimProbe.emptyReserve;
  if (dry) return false;
  // Authored arbitration: the spare operator that started its last batch longest ago has first access
  // to shared stock, then the next recipe needing more input units. Re-evaluate after each start;
  // another operator may have consumed its ingredients.
  if (recipes.size > 1) startPass.workforce ??= workshopWorkforce(world, ctx);
  const workforce = recipes.size > 1 ? startPass.workforce : undefined;
  // Never resized: entries past `spare` are held undefined instead, so the list keeps one elements kind.
  const choices = choiceScratch;
  const listed = spare;
  while (spare > 0) {
    for (let i = 0; i < spare; i++) choices[i] = nextCycleFor(world, ctx, e, next[i] as Entity, recipes);
    const stock = world.get(e, Stockpile).amounts;
    let winner = -1;
    let earliestStart = Number.POSITIVE_INFINITY;
    let mostInputs = -1;
    for (let i = 0; i < spare; i++) {
      const choice = choices[i];
      if (choice === undefined) continue;
      const operator = next[i] as Entity;
      const started = lastStartOf(world, operator);
      const units = recipeInputUnits(choice.recipe);
      // Ranked first, so a candidate that could not win never pays for its reservations.
      if (started > earliestStart || (started === earliestStart && units <= mostInputs)) continue;
      const reserved =
        workforce !== undefined
          ? incomingRecipeReservations(
              world,
              ctx,
              e,
              recipes,
              workforce,
              staffing.operators,
              choices,
              operator,
            )
          : undefined;
      if (dipsIntoReserve(stock, choice, reserved)) continue;
      winner = i;
      earliestStart = started;
      mostInputs = units;
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
  return false;
}

/** The workforce view the start pass shares between its workshops, built for the first that asks. */
const startPass: { workforce: WorkshopWorkforce | undefined } = { workforce: undefined };

/** What the last assignment read besides the stores, rewritten per workshop. */
const claimProbe: ClaimProbe = { emptyReserve: false };

/** The one anonymous batch an unstaffed-by-design workplace advances: its oldest. */
const UNSTAFFED_ASSIGNMENT: readonly number[] = [0];
const NO_BATCHES: readonly number[] = [];

/** The live batch at `index` of `building`, its write logged. */
function writableCycle(world: World, building: Entity, index: number): ProductionCycle {
  return world.mut(building, Production).cycles[index] as ProductionCycle;
}

/** Stop the clock of every running batch of `building` that `worked`, the batch indices this tick's
 *  operators advance, leaves out, and answer whether there was one; `dry` only answers. */
function stopUnworkedCycles(
  world: World,
  tick: number,
  building: Entity,
  cycles: readonly DeepReadonly<ProductionCycle>[],
  worked: readonly number[],
  dry: boolean,
): boolean {
  let stopped = false;
  for (let i = 0; i < cycles.length; i++) {
    if (cycles[i]?.startedAt === undefined || worked.includes(i)) continue;
    if (dry) return true;
    stopWorkClock(writableCycle(world, building, i), tick);
    stopped = true;
  }
  return stopped;
}

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
