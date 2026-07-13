import type { Recipe } from '@vinland/data';
import { Building, Production, type ProductionCycle, Stockpile } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { goodEnabled } from '../progression/index.js';
import { presentOperatorCount, recipeOf, stockCapacity } from '../stores/index.js';

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (inputs → outputs over `recipe.ticks`). Each tick, for every such building:
 *
 *  - **Running cycles** (`{@link Production}` present — a LIST of independent batches): advance as
 *    many cycles as there are OPERATORS on station ({@link presentOperatorCount}), oldest first
 *    (FIFO) — two millers each work their own batch, so a twin-staffed mill turns out two flours per
 *    cycle length (the parallel-batch model; observed original behaviour). A completed cycle deposits
 *    its recipe outputs into the building's own stockpile (the room was reserved when it started, so
 *    they fit) and emits a `goodProduced` event; the {@link Production} component is removed when the
 *    last cycle completes. With every operator away ALL cycles **pause** — `elapsed` is held, not
 *    lost — and with fewer operators than batches the youngest batches wait their turn.
 *  - **Starting** (fewer cycles than present operators): start another cycle iff (a) the workplace is
 *    **built** (`built >= ONE` — an under-construction site never produces, even if its delivered
 *    build materials happen to satisfy a recipe input), (b) the stockpile holds every input in full,
 *    and (c) every output has free room up to the building type's per-good capacity AFTER the
 *    already-running cycles deposit theirs ({@link canStartCycle} counts the in-flight batches).
 *    Starting consumes the inputs immediately (reserving them) and snapshots `recipe.ticks` as the
 *    cycle `duration`.
 *
 * **Worker-presence gate:** a workplace only produces while an OPERATOR is present — a settler whose
 * `jobType` matches one of the building type's operator slots (its `workers` minus the carrier
 * transport slots) is standing on its tile ({@link presentOperatorCount}). This is the original's "a
 * workshop runs only while staffed" rule (a sawmill with no operator makes no planks) — and a carrier
 * at the door neither runs nor speeds the craft (it only ferries goods). A building type that
 * declares no worker slots is unstaffed-by-design and produces freely (passive stores / worker-less
 * fixtures are unaffected).
 *
 * Inputs are consumed at cycle start and outputs deposited at completion, so a cycle is the net
 * transformation inputs→outputs — goods are conserved (nothing teleports; consumption and production
 * are explicit stockpile writes). Per-good capacity is enforced on the output side: a cycle never
 * begins unless its outputs will fit, so the stockpile never overflows.
 *
 * Determinism: no RNG, no wall-clock; buildings are visited in the Production/Building stores'
 * deterministic insertion order, the recipe is read from CONTENT, and every stockpile write goes
 * through the canonical Map (never iterated for a decision). Timing is the exact integer compare
 * `elapsed >= duration` — not an accumulated fixed-point step (which truncates and would hang).
 */
export const productionSystem: System = (world, ctx) => {
  // Advance running cycles first, then start new ones — so a cycle started this tick doesn't also
  // get advanced in the same tick (it begins counting next tick, like CurrentAtomic).
  for (const e of world.query(Production, Stockpile)) {
    // Note: an in-flight cycle is NOT re-gated on the tech-graph (`jobEnablesGood`) — the unlock is a
    // start-only "can this tribe make this at all" gate (see canStartCycle), so a cycle that began is
    // committed even if the enabling settler later dies. The worker-presence gate, by contrast, DOES
    // pause mid-cycle (it models the operators physically being away, not a tech unlock).
    const operators = presentOperatorCount(world, ctx, e);
    if (operators <= 0) continue; // every operator left — all cycles pause (elapsed held)
    const prod = world.get(e, Production);
    // Each present operator works ONE batch this tick, oldest first (FIFO) — a lone miller at a
    // two-batch mill advances only the first; the second waits for its worker.
    const advanced = Math.min(operators, prod.cycles.length);
    for (const cycle of prod.cycles.slice(0, advanced)) cycle.elapsed += 1;

    // Completed batches: deposit each one's outputs (room was reserved at start), drop them from the
    // list, and retire the component when the last batch is done (the workplace reads idle again).
    // `completed` is DERIVED from the same filter that removes the crossers, so the deposit count and
    // the removal can never diverge (a cycle somehow persisted at `elapsed >= duration` — a load path,
    // a debug mutation — deposits exactly once as it leaves, never silently vanishing).
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
    // Dormancy gate BEFORE the operator scan: `canStartCycle` is O(recipe goods) while
    // `presentOperatorCount` walks every settler — a starved/output-blocked workshop must not pay
    // the settler scan every tick (RTS budget: cost scales with active work). canStartCycle doesn't
    // depend on operators, so skipping here elides only a provably-empty start loop.
    if (!canStartCycle(world, ctx, e, recipe)) continue;
    const operators = presentOperatorCount(world, ctx, e);
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
 * Whether a workplace may begin ANOTHER production cycle now — the start gate the ProductionSystem
 * applies (see {@link startableCycleCount} for the checks; this is its `> 0` view).
 */
export function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  return startableCycleCount(world, ctx, building, recipe) > 0;
}

/**
 * How many MORE production cycles the workplace could start right now, beyond the batches already in
 * flight. A cycle is startable while: every output good is **tech-unlocked** for its tribe (the
 * `jobEnablesGood` gate — mirrors the `placeBuilding` house gate: a tannery makes no leather without
 * the tanner; any locked output means zero), the stockpile covers every input in full once per batch,
 * AND every output has free room up to its per-good stock capacity AFTER the in-flight batches
 * deposit theirs (each running cycle reserved its room when it started, so a further batch only
 * starts if the slot fits them all). The output room check is the capacity enforcement — a cycle that
 * couldn't deposit its outputs is never started, so the stockpile never overflows. The in-flight
 * reservation assumes every running batch runs THIS recipe — true today (one recipe per building
 * type); a future per-cycle recipe carries its own outputs and this accounting moves onto the cycle.
 *
 * Exported so the AI planner can size the workplace's WORK SEATS (running + startable batches — the
 * producer stay-or-fetch decision, {@link workSeatCount}) with the exact same gate the
 * ProductionSystem applies, rather than a drifting re-implementation. Does NOT check `built >= ONE`
 * (the start loop checks that separately) or worker-presence (the caller decides whether the worker
 * is there), so the planner combines those itself. An input-less, output-less recipe reads as
 * unbounded (`Infinity`) — the degenerate always-startable case the `> 0` gate preserved.
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
  const stock = world.get(building, Stockpile).amounts;
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    stock.set(input.goodType, have - input.amount);
  }
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
