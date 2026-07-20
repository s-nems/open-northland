import type { Recipe } from '@open-northland/data';
import {
  Building,
  consumeGoods,
  Production,
  type ProductionCycle,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled } from '../../progression/index.js';
import { stockCapacity } from '../../stores/index.js';

// The production CYCLE model: the start gate (may another batch of this product begin?), the batch's birth,
// and its output deposit at completion. The ProductionSystem loop (../production.ts) drives these; the
// per-operator product choice that picks WHICH recipe to start is ./rotation.ts.

/**
 * How many more cycles of `recipe`'s product the workplace could start right now, beyond the
 * same-product batches already in flight. A cycle is startable while every output good is
 * tech-unlocked for its tribe (the `jobEnablesGood` gate — mirrors the `placeBuilding` house gate; any
 * locked output means zero), the stockpile covers every input in full once per batch, and every output
 * has free room up to its per-good stock capacity after the in-flight same-product batches deposit
 * theirs (each running cycle reserved its room at start). The output-room check is the capacity
 * enforcement — a cycle that couldn't deposit is never started, so the stockpile never overflows. The
 * in-flight reservation counts cycles by their product key (`cycle.goodType`), so parallel batches of
 * OTHER products never eat this product's room (and an authored multi-output recipe reserves only
 * under its product key — a named simplification; pipeline recipes are single-output).
 *
 * Exported so the AI planner can size the workplace's work seats ({@link workSeatCount}) with the exact
 * gate the ProductionSystem applies. Does not check `built >= ONE` or worker-presence (the caller
 * handles those). An input-less, output-less recipe reads as unbounded (`Infinity`).
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
  let startable = Number.POSITIVE_INFINITY;
  for (const input of recipe.inputs) {
    startable = Math.min(startable, Math.floor((stock.get(input.goodType) ?? 0) / input.amount));
  }
  return Math.max(0, Math.min(startable, outputRoomForCycles(world, ctx, building, recipe)));
}

/**
 * How many more cycles of `recipe`'s product the workplace has SHELF ROOM for — the output-capacity half
 * of {@link startableCycleCount}, read without the input-stock and tech gates. Zero means the workshop is
 * blocked on its own full output rather than starved of inputs, which is what lets the planner send the
 * craftsman out with one unit instead of on another input trip ({@link outputSlotsFull}).
 */
export function outputRoomForCycles(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  const stock = world.get(building, Stockpile).amounts;
  const product = recipe.outputs[0]?.goodType;
  const cycles = world.tryGet(building, Production)?.cycles;
  let inFlight = 0;
  if (cycles !== undefined && product !== undefined) {
    for (const c of cycles) if (c.goodType === product) inFlight++;
  }
  let room = Number.POSITIVE_INFINITY;
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    const capacity = stockCapacity(world, ctx, building, output.goodType);
    // Room for each further batch AND every same-product batch already grinding (each deposits `amount`).
    room = Math.min(room, Math.floor((capacity - have) / output.amount) - inFlight);
  }
  return Math.max(0, room);
}

/**
 * Whether a workplace may begin another cycle of `recipe`'s product now — the start gate the
 * ProductionSystem applies (see {@link startableCycleCount} for the checks; this is its `> 0` view).
 */
export function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  return startableCycleCount(world, ctx, building, recipe) > 0;
}

/** Whether any product of `recipes` could start a cycle now (the ProductionSystem's dormancy gate). */
export function anyCycleStartable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  for (const recipe of recipes.values()) {
    if (canStartCycle(world, ctx, building, recipe)) return true;
  }
  return false;
}

/** Consume `recipe`'s inputs (reserving them) and append the new batch — the caller has verified
 *  {@link canStartCycle}. `duration` is clamped to the `>= 1` the {@link ProductionCycle} documents, so the
 *  completion compare can read it plainly (validated content is already `ticks >= 1`). */
export function beginCycle(world: World, building: Entity, recipe: Recipe, goodType: number): void {
  consumeGoods(world, world.get(building, Stockpile).amounts, recipe.inputs);
  const cycle: ProductionCycle = { elapsed: 0, duration: Math.max(1, recipe.ticks), goodType };
  const prod = world.tryGet(building, Production);
  if (prod === undefined) world.add(building, Production, { cycles: [cycle] });
  else prod.cycles.push(cycle);
}

/** Start one cycle of the first startable product in content order — the unstaffed-by-design path
 *  (no operator, so no per-worker rotation to consult). */
export function startFirstStartable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  for (const [good, recipe] of recipes) {
    if (!canStartCycle(world, ctx, building, recipe)) continue;
    beginCycle(world, building, recipe, good);
    return;
  }
}

/**
 * Deposit a completed cycle's product into the workplace's stockpile and emit a `goodProduced` event
 * per output (render/audio cue). The outputs are the cycle's own recipe's (looked up by its product
 * key; a recipe removed by a content rebase mid-cycle degrades to one unit of the product). The room
 * was reserved by {@link canStartCycle} at cycle start (no input consumption or competing producer can
 * have removed capacity since — production is the only writer of a workplace's own outputs), so the
 * outputs always fit; the per-good capacity is not re-checked here.
 */
export function depositCycleOutput(
  world: World,
  ctx: SystemContext,
  building: Entity,
  cycle: ProductionCycle,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  const stock = world.get(building, Stockpile).amounts;
  const outputs = recipes?.get(cycle.goodType)?.outputs ?? [{ goodType: cycle.goodType, amount: 1 }];
  for (const output of outputs) {
    const have = stock.get(output.goodType) ?? 0;
    setStockAmount(world, stock, output.goodType, have + output.amount);
    ctx.events.emit({
      kind: 'goodProduced',
      building,
      goodType: output.goodType,
      amount: output.amount,
    });
  }
}
