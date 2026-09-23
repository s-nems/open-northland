import { Building, Person, Position, Production, Stockpile } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { System } from '../context.js';
import { grantProductionExperience } from '../progression/index.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';
import { operatorCountOf, presentOperators, recipesByProductOf } from '../stores/index.js';
import { accrueBonusOutput } from './production/bonus-output.js';
import { anyCycleStartable, depositCycleOutput, startFirstStartable } from './production/cycles.js';
import { chargeMilitaryPietyCost } from './production/piety.js';
import { startCycleFor } from './production/rotation.js';

export { accrueDepositBonus } from './production/bonus-output.js';
export { BREEDING_PAIR, shelfBlockedOutput, startableCycleCount } from './production/cycles.js';
export { craftablePool } from './production/rotation.js';

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
  // Settlers bucketed by their node once per tick, so each workplace's operator lookup is an O(1) door-node
  // probe instead of a full settler scan. Built lazily, so a tick whose workshops are all starved or blocked
  // pays no scan or sort; deferring moves nothing, since the constructor reads only the Settler+Position
  // query, which the loops below never mutate.
  let operatorsByNode: NodeBuckets | undefined;
  const operatorIndex = (): NodeBuckets => {
    operatorsByNode ??= new NodeBuckets(world, canonicalById(world.query(Person, Position)));
    return operatorsByNode;
  };
  // Advance running cycles before starting new ones, so a cycle started this tick begins counting next
  // tick rather than being advanced twice.
  for (const e of world.query(Production, Stockpile)) {
    // The tech unlock is a start-only gate, so a committed cycle finishes even if the enabling settler
    // later dies. The worker-presence gate does pause mid-cycle.
    const staffing = presentOperators(world, ctx, e, operatorIndex());
    const operators = operatorCountOf(staffing);
    if (operators <= 0) continue;
    const prod = world.mut(e, Production);
    const advanced = Math.min(operators, prod.cycles.length);
    for (const cycle of prod.cycles.slice(0, advanced)) cycle.elapsed += 1;

    // `duration` was clamped at cycle start, so the two complementary compares below are plain.
    const done = prod.cycles.filter((c) => c.elapsed >= c.duration);
    if (done.length === 0) continue;
    prod.cycles = prod.cycles.filter((c) => c.elapsed < c.duration);
    const recipes = recipesByProductOf(world, ctx, e);
    for (const cycle of done) depositCycleOutput(world, ctx, e, cycle, recipes);
    chargeMilitaryPietyCost(world, ctx, done, staffing);
    grantProductionExperience(
      world,
      ctx,
      done.length,
      staffing,
      done.map((cycle) => cycle.goodType),
    );
    // After the grant, so the batch that just finished already counts toward its own bonus fraction.
    accrueBonusOutput(world, ctx, e, done, staffing, recipes);
    if (prod.cycles.length === 0) world.remove(e, Production);
  }

  // Start cycles on workplaces with spare present operators. Each start re-checks the gate, since inputs
  // shrink and same-product pending outputs grow with every batch started.
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).built < ONE) continue;
    const recipes = recipesByProductOf(world, ctx, e);
    if (recipes === undefined) continue;
    // Dormancy gate before the operator lookup: the per-recipe gates are cheap and operator-independent, so
    // a starved or output-blocked workshop skips the door-node lookup. It elides only a provably-empty loop.
    if (!anyCycleStartable(world, ctx, e, recipes)) continue;
    const running = world.tryGet(e, Production)?.cycles.length ?? 0;
    const staffing = presentOperators(world, ctx, e, operatorIndex());
    if (staffing.kind === 'unstaffed') {
      // No worker slots: one anonymous batch, first startable product in content order.
      if (running < operatorCountOf(staffing)) startFirstStartable(world, ctx, e, recipes);
      continue;
    }
    // The seats past the running batches, each taking its own product choice; a failed choice skips just
    // that operator.
    for (const operator of staffing.operators.slice(running)) {
      startCycleFor(world, ctx, e, operator, recipes);
    }
  }
};
