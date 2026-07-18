import { Building, Position, Production, Settler, Stockpile } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { System } from '../context.js';
import { canonicalById, NodeBuckets } from '../spatial.js';
import { operatorCountOf, presentOperators, recipesByProductOf } from '../stores/index.js';
import { anyCycleStartable, depositCycleOutput, startFirstStartable } from './production/cycles.js';
import { chargeMilitaryPietyCost } from './production/piety.js';
import { startCycleFor } from './production/rotation.js';

export { startableCycleCount } from './production/cycles.js';

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries `recipes`
 * (one per producible good, inputs → that product over `recipe.ticks`). Each tick, for every such
 * building:
 *
 *  - Running cycles ({@link Production} present — a list of independent batches, each pinned to the
 *    product it crafts): advance as many cycles as there are operators on station
 *    ({@link operatorCountOf}), oldest first (FIFO) — two millers each work their own batch, so a
 *    twin-staffed mill turns out two flours per cycle length (the parallel-batch model; observed
 *    original behaviour). A completed cycle deposits its own recipe's outputs into the building's own
 *    stockpile (the room was reserved at start) and emits a `goodProduced` event; the
 *    {@link Production} component is removed when the last cycle completes. With every operator away
 *    all cycles pause — `elapsed` is held, not lost — and with fewer operators than batches the
 *    youngest wait their turn.
 *  - Starting (fewer cycles than present operators): each spare operator ({@link presentOperators},
 *    ascending id; the first `running` ones are deemed to be working the running batches) may start
 *    one cycle of a product of ITS choice — its {@link CraftSelection} rotation, or every product the
 *    type offers when it has none — iff (a) the workplace is built (`built >= ONE` — an
 *    under-construction site never produces), (b) the stockpile holds that product's inputs in full,
 *    and (c) the product has free room up to the type's per-good capacity after the same-product
 *    batches in flight deposit theirs ({@link startableCycleCount}). Starting consumes the inputs
 *    immediately (reserving them) and snapshots the recipe's `ticks`/product as the cycle
 *    `duration`/`goodType`. An operator whose selection can't start anything simply starts nothing
 *    this tick (its colleagues still may).
 *
 * Worker-presence gate: a workplace produces only while an operator is present — a settler whose
 * `jobType` matches one of the building type's operator slots (its `workers` minus the carrier
 * transport slots) is standing on its tile ({@link presentOperators}). This is the original's "a
 * workshop runs only while staffed" rule; a carrier at the door neither runs nor speeds the craft (it
 * only ferries goods). A building type that declares no worker slots is unstaffed-by-design and
 * produces freely (one anonymous batch, products in content order).
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so goods are conserved.
 * Per-good capacity is enforced on the output side: a cycle never begins unless its outputs will fit.
 *
 * Timing is the exact integer compare `elapsed >= duration`, not an accumulated fixed-point step
 * (which would truncate and hang).
 */
export const productionSystem: System = (world, ctx) => {
  // Settlers bucketed by their node once per tick, so each workplace's operator lookup is an O(1) door-node
  // probe instead of a full settler scan (jobSystem builds the mirror index over buildings for staffing).
  // Built lazily by the first operator lookup, so a tick with no workshop needing one — no workshop at
  // all, or every one starved/blocked (anyCycleStartable gates before the lookup) — pays no settler scan
  // or sort; deferring moves nothing, since the constructor reads only the Settler+Position query and
  // each Position, neither of which the loops below mutate. Canonical input order per the NodeBuckets
  // contract — buckets must hold ascending ids.
  let operatorsByNode: NodeBuckets | undefined;
  const operatorIndex = (): NodeBuckets => {
    operatorsByNode ??= new NodeBuckets(world, canonicalById(world.query(Settler, Position)));
    return operatorsByNode;
  };
  // Advance running cycles first, then start new ones — so a cycle started this tick doesn't also
  // get advanced in the same tick (it begins counting next tick, like CurrentAtomic).
  for (const e of world.query(Production, Stockpile)) {
    // An in-flight cycle is not re-gated on the tech-graph (`jobEnablesGood`) — the unlock is a start-only
    // gate (see startableCycleCount), so a committed cycle finishes even if the enabling settler later dies.
    // The worker-presence gate does pause mid-cycle (operators physically away, not a tech unlock).
    const staffing = presentOperators(world, ctx, e, operatorIndex());
    const operators = operatorCountOf(staffing);
    if (operators <= 0) continue; // every operator left — all cycles pause (elapsed held)
    const prod = world.get(e, Production);
    // Each present operator works one batch this tick, oldest first (FIFO) — a lone miller at a two-batch
    // mill advances only the first.
    const advanced = Math.min(operators, prod.cycles.length);
    for (const cycle of prod.cycles.slice(0, advanced)) cycle.elapsed += 1;

    // Completed batches: deposit each one's own product (room reserved at start), drop them from the list,
    // and retire the component when the last is done. `duration` was clamped at cycle start, so the two
    // complementary compares below are plain.
    const done = prod.cycles.filter((c) => c.elapsed >= c.duration);
    if (done.length === 0) continue; // all advanced batches still mid-grind
    prod.cycles = prod.cycles.filter((c) => c.elapsed < c.duration);
    const recipes = recipesByProductOf(world, ctx, e);
    for (const cycle of done) depositCycleOutput(world, ctx, e, cycle, recipes);
    chargeMilitaryPietyCost(world, ctx, done, staffing);
    if (prod.cycles.length === 0) world.remove(e, Production);
  }

  // Start cycles on workplaces with spare present operators: one independent batch per operator, each
  // crafting the product that operator's rotation picks. Each start re-checks the start gate (inputs
  // shrink and same-product pending outputs grow with every batch started).
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).built < ONE) continue; // under construction — a site doesn't produce
    const recipes = recipesByProductOf(world, ctx, e);
    if (recipes === undefined) continue; // not a producing workplace
    // Dormancy gate before the operator lookup: the per-recipe gates are O(recipe goods) and don't depend
    // on operators, so a starved/output-blocked workshop skips the per-building operator work (the
    // door-node lookup + content reads) entirely. It elides only a provably-empty start loop.
    if (!anyCycleStartable(world, ctx, e, recipes)) continue;
    const running = world.tryGet(e, Production)?.cycles.length ?? 0;
    const staffing = presentOperators(world, ctx, e, operatorIndex());
    if (staffing.kind === 'unstaffed') {
      // No worker slots: one anonymous batch, first startable product in content order.
      if (running < operatorCountOf(staffing)) startFirstStartable(world, ctx, e, recipes);
      continue;
    }
    // The spare operators (indices past the running batches) each try their own product choice; a
    // failed choice skips just that operator. A deserted workplace has none, so it starts nothing.
    for (const operator of staffing.operators.slice(running)) {
      startCycleFor(world, ctx, e, operator, recipes);
    }
  }
};
