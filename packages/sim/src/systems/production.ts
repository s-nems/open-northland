import type { Recipe } from '@vinland/data';
import { Building, Production, Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import type { System, SystemContext } from './context.js';
import { recipeOf, stockCapacity } from './shared.js';

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries a `recipe`
 * (inputs → outputs over `recipe.ticks`). Each tick, for every such building:
 *
 *  - **Running a cycle** (`{@link Production}` present): advance the integer `elapsed` counter; on the
 *    `duration`-th tick, deposit the recipe outputs into the building's own stockpile (the room was
 *    reserved when the cycle started, so they fit), emit a `productionCompleted` event, and remove
 *    the {@link Production} component (the workplace is idle again).
 *  - **Idle** (no `Production`): start a cycle iff (a) the stockpile holds every input in full, and
 *    (b) every output has free room up to the building type's per-good capacity. Starting consumes
 *    the inputs immediately (reserving them) and snapshots `recipe.ticks` as the cycle `duration`.
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
    const prod = world.get(e, Production);
    const duration = Math.max(1, prod.duration);
    prod.elapsed += 1;
    if (prod.elapsed < duration) continue; // still producing

    // Completed: deposit the outputs (room was reserved at start), notify, and go idle.
    const recipe = recipeOf(world, ctx, e);
    if (recipe !== undefined) depositOutputs(world, ctx, e, recipe);
    world.remove(e, Production);
  }

  // Start cycles on idle workplaces whose inputs are present and outputs have room.
  for (const e of world.query(Building, Stockpile)) {
    if (world.has(e, Production)) continue; // already producing
    const recipe = recipeOf(world, ctx, e);
    if (recipe === undefined) continue; // not a producing workplace
    if (!canStartCycle(world, ctx, e, recipe)) continue; // missing inputs or no output room

    consumeInputs(world, e, recipe);
    world.add(e, Production, { elapsed: 0, duration: recipe.ticks });
  }
};

/**
 * Whether a workplace may begin a production cycle now: its own stockpile holds every input good in
 * full, AND every output good has free room up to its per-good stock capacity. The output check is
 * the capacity enforcement — a cycle that couldn't deposit its outputs is never started, so the
 * stockpile never overflows (and outputs aren't produced and then dropped).
 */
function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  const stock = world.get(building, Stockpile).amounts;
  for (const input of recipe.inputs) {
    if ((stock.get(input.goodType) ?? 0) < input.amount) return false; // input not available
  }
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    const capacity = stockCapacity(world, ctx, building, output.goodType);
    if (capacity - have < output.amount) return false; // no room for this output — enforce capacity
  }
  return true;
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
