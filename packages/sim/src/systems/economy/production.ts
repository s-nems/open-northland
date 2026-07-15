import type { Recipe } from '@open-northland/data';
import {
  Building,
  consumeGoods,
  Position,
  Production,
  type ProductionCycle,
  Settler,
  Stockpile,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { goodEnabled } from '../progression/index.js';
import { NodeBuckets } from '../spatial.js';
import { presentOperatorCount, recipeOf, stockCapacity } from '../stores/index.js';

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (inputs → outputs over `recipe.ticks`). Each tick, for every such building:
 *
 *  - Running cycles ({@link Production} present — a list of independent batches): advance as many cycles as
 *    there are operators on station ({@link presentOperatorCount}), oldest first (FIFO) — two millers each
 *    work their own batch, so a twin-staffed mill turns out two flours per cycle length (the parallel-batch
 *    model; observed original behaviour). A completed cycle deposits its recipe outputs into the building's
 *    own stockpile (the room was reserved at start) and emits a `goodProduced` event; the {@link Production}
 *    component is removed when the last cycle completes. With every operator away all cycles pause —
 *    `elapsed` is held, not lost — and with fewer operators than batches the youngest wait their turn.
 *  - Starting (fewer cycles than present operators): start another cycle iff (a) the workplace is built
 *    (`built >= ONE` — an under-construction site never produces), (b) the stockpile holds every input in
 *    full, and (c) every output has free room up to the building type's per-good capacity after the
 *    already-running cycles deposit theirs ({@link canStartCycle} counts the in-flight batches). Starting
 *    consumes the inputs immediately (reserving them) and snapshots `recipe.ticks` as the cycle `duration`.
 *
 * Worker-presence gate: a workplace produces only while an operator is present — a settler whose `jobType`
 * matches one of the building type's operator slots (its `workers` minus the carrier transport slots) is
 * standing on its tile ({@link presentOperatorCount}). This is the original's "a workshop runs only while
 * staffed" rule; a carrier at the door neither runs nor speeds the craft (it only ferries goods). A
 * building type that declares no worker slots is unstaffed-by-design and produces freely.
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so goods are conserved. Per-good
 * capacity is enforced on the output side: a cycle never begins unless its outputs will fit.
 *
 * Timing is the exact integer compare `elapsed >= duration`, not an accumulated fixed-point step (which
 * would truncate and hang).
 */
export const productionSystem: System = (world, ctx) => {
  // Settlers bucketed by their node once per tick, so each workplace's operator count is an O(1) door-node
  // lookup instead of a full settler scan (jobSystem builds the mirror index over buildings for staffing).
  const operatorsByNode = new NodeBuckets(world, world.query(Settler, Position));
  // Advance running cycles first, then start new ones — so a cycle started this tick doesn't also
  // get advanced in the same tick (it begins counting next tick, like CurrentAtomic).
  for (const e of world.query(Production, Stockpile)) {
    // An in-flight cycle is not re-gated on the tech-graph (`jobEnablesGood`) — the unlock is a start-only
    // gate (see canStartCycle), so a committed cycle finishes even if the enabling settler later dies. The
    // worker-presence gate does pause mid-cycle (operators physically away, not a tech unlock).
    const operators = presentOperatorCount(world, ctx, e, operatorsByNode);
    if (operators <= 0) continue; // every operator left — all cycles pause (elapsed held)
    const prod = world.get(e, Production);
    // Each present operator works one batch this tick, oldest first (FIFO) — a lone miller at a two-batch
    // mill advances only the first.
    const advanced = Math.min(operators, prod.cycles.length);
    for (const cycle of prod.cycles.slice(0, advanced)) cycle.elapsed += 1;

    // Completed batches: deposit each one's outputs (room reserved at start), drop them from the list, and
    // retire the component when the last is done. `completed` is derived from the same filter that removes
    // them, so the deposit count and the removal can't diverge.
    const before = prod.cycles.length;
    prod.cycles = prod.cycles.filter((c) => c.elapsed < Math.max(1, c.duration));
    const completed = before - prod.cycles.length;
    if (completed === 0) continue; // all advanced batches still mid-grind
    const recipe = recipeOf(world, ctx, e);
    if (recipe !== undefined) {
      for (let i = 0; i < completed; i++) depositOutputs(world, ctx, e, recipe);
    }
    if (prod.cycles.length === 0) world.remove(e, Production);
  }

  // Start cycles on workplaces with spare present operators: one independent batch per operator, so a
  // fully-staffed twin mill runs two at once. Each start re-checks canStartCycle (inputs shrink and
  // pending outputs grow with every batch started).
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).built < ONE) continue; // under construction — a site doesn't produce
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a producing workplace
    // Dormancy gate before the operator lookup: `canStartCycle` is O(recipe goods) and doesn't depend on
    // operators, so a starved/output-blocked workshop skips the operator-count work entirely (RTS budget:
    // cost scales with active work). It elides only a provably-empty start loop.
    if (!canStartCycle(world, ctx, e, recipe)) continue;
    const operators = presentOperatorCount(world, ctx, e, operatorsByNode);
    let running = world.tryGet(e, Production)?.cycles.length ?? 0;
    while (running < operators && canStartCycle(world, ctx, e, recipe)) {
      consumeInputs(world, e, recipe);
      const prod = world.tryGet(e, Production);
      const cycle: ProductionCycle = { elapsed: 0, duration: recipe.ticks };
      if (prod === undefined) world.add(e, Production, { cycles: [cycle] });
      else prod.cycles.push(cycle);
      running++;
    }
  }
};

/**
 * Whether a workplace may begin another production cycle now — the start gate the ProductionSystem applies
 * (see {@link startableCycleCount} for the checks; this is its `> 0` view).
 */
export function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  return startableCycleCount(world, ctx, building, recipe) > 0;
}

/**
 * How many more production cycles the workplace could start right now, beyond the batches already in
 * flight. A cycle is startable while every output good is tech-unlocked for its tribe (the `jobEnablesGood`
 * gate — mirrors the `placeBuilding` house gate; any locked output means zero), the stockpile covers every
 * input in full once per batch, and every output has free room up to its per-good stock capacity after the
 * in-flight batches deposit theirs (each running cycle reserved its room at start). The output-room check
 * is the capacity enforcement — a cycle that couldn't deposit is never started, so the stockpile never
 * overflows. The in-flight reservation assumes every running batch runs this recipe (true today: one recipe
 * per building type).
 *
 * Exported so the AI planner can size the workplace's work seats ({@link workSeatCount}) with the exact gate
 * the ProductionSystem applies. Does not check `built >= ONE` or worker-presence (the caller handles those).
 * An input-less, output-less recipe reads as unbounded (`Infinity`).
 */
export function startableCycleCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  const tribe = world.get(building, Building).tribe;
  for (const output of recipe.outputs) {
    if (!goodEnabled(world, ctx, tribe, output.goodType)) return 0; // good not yet tech-unlocked
  }
  const stock = world.get(building, Stockpile).amounts;
  const inFlight = world.tryGet(building, Production)?.cycles.length ?? 0;
  let startable = Number.POSITIVE_INFINITY;
  for (const input of recipe.inputs) {
    startable = Math.min(startable, Math.floor((stock.get(input.goodType) ?? 0) / input.amount));
  }
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    const capacity = stockCapacity(world, ctx, building, output.goodType);
    // Room for each further batch AND every batch already grinding (each deposits `amount`).
    startable = Math.min(startable, Math.floor((capacity - have) / output.amount) - inFlight);
  }
  return Math.max(0, startable);
}

/**
 * Remove the recipe's input goods from the workplace's stockpile (consumed at cycle start). The
 * caller has already verified via {@link canStartCycle} that every input is present in full, so a
 * count can't go negative. A consumed good that hits zero is left as a 0 entry (the canonical Map
 * tolerates it); the stockpile is never iterated for a decision, so a stale 0 is harmless.
 */
function consumeInputs(world: World, building: Entity, recipe: Recipe): void {
  consumeGoods(world.get(building, Stockpile).amounts, recipe.inputs);
}

/**
 * Deposit the recipe's output goods into the workplace's stockpile on cycle completion and emit a
 * `goodProduced` event per output (render/audio cue). The room was reserved by {@link canStartCycle}
 * at cycle start (no input consumption or competing producer can have removed capacity since —
 * production is the only writer of a workplace's own outputs), so the outputs always fit; the
 * per-good capacity is not re-checked here.
 */
function depositOutputs(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): void {
  const stock = world.get(building, Stockpile).amounts;
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    stock.set(output.goodType, have + output.amount);
    ctx.events.emit({
      kind: 'goodProduced',
      building,
      goodType: output.goodType,
      amount: output.amount,
    });
  }
}
