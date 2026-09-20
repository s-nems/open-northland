import type { Recipe } from '@open-northland/data';
import {
  Building,
  consumeGoods,
  ownerOf,
  Production,
  type ProductionCycle,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { birthHerdAnimal, herdRoom, speciesHerdOf } from '../../livestock/index.js';
import { recipeOutputsEnabled } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { recipesByProductOf, stockCapacity } from '../../stores/index.js';

/** The herd the original breeds from: exactly two grown animals of the species, no more and no fewer
 *  (the original 0x474bb2). A third adult is slaughtered instead. */
export const BREEDING_PAIR = 2;

/**
 * How many more cycles of `recipe`'s product the workplace could start right now, beyond the same-product
 * batches already in flight. Reserving output room at start is the capacity enforcement: a cycle that could
 * not deposit is never started, so the stockpile never overflows. In-flight batches are counted by product
 * key, so an authored multi-output recipe reserves only under its product - a simplification; pipeline
 * recipes are single-output. Does not check `built >= ONE` or worker presence.
 */
export function startableCycleCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  if (
    !recipeOutputsEnabled(world, ctx, ownerOf(world, building), world.get(building, Building).tribe, recipe)
  ) {
    return 0;
  }
  // Both halves are already >= 0, so the combined count needs no further clamp.
  const cycles = Math.min(
    inputStockForCycles(world, building, recipe),
    outputRoomForCycles(world, ctx, building, recipe),
  );
  if (cycles <= 0) return cycles;
  return Math.min(cycles, breedableCycles(world, ctx, building, recipe));
}

/**
 * How many cycles of `recipe` the herd allows: every one for an ordinary recipe, none unless the farm
 * holds exactly the {@link BREEDING_PAIR} of the species it breeds, and then only as many calves as the
 * whole herd still has room for.
 */
function breedableCycles(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): number {
  const species = recipe.outputs[0]?.goodType;
  if (species === undefined || livestockTribeOfGood(ctx.content, species) === null) {
    return Number.POSITIVE_INFINITY;
  }
  if (speciesHerdOf(world, ctx, building, species).adults !== BREEDING_PAIR) return 0;
  return Math.max(0, herdRoom(world, ctx, building, species));
}

/** How many cycles of `recipe` the stocked INPUTS cover - the input half of {@link startableCycleCount}. */
function inputStockForCycles(world: World, building: Entity, recipe: Recipe): number {
  const stock = world.get(building, Stockpile).amounts;
  let cycles = Number.POSITIVE_INFINITY;
  for (const input of recipe.inputs) {
    cycles = Math.min(cycles, Math.floor((stock.get(input.goodType) ?? 0) / input.amount));
  }
  return cycles;
}

/**
 * How many more cycles of `recipe`'s product the workplace has shelf room for - the output-capacity half
 * of {@link startableCycleCount}, read without the input-stock and tech gates.
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
    // Every same-product batch already grinding still owes a deposit of `amount`.
    room = Math.min(room, Math.floor((capacity - have) / output.amount) - inFlight);
  }
  return Math.max(0, room);
}

/**
 * The stocked output good whose full shelf stopped this workplace, or null when it can still start any
 * cycle. Only a unit physically leaving frees the slot, so the good is named for the unblocking haul to
 * carry. Recipe iteration follows the type's fixed content order, so the pick is canonical.
 */
export function shelfBlockedOutput(world: World, ctx: SystemContext, building: Entity): number | null {
  const b = world.tryGet(building, Building);
  if (b === undefined || b.built < ONE) return null;
  const recipes = recipesByProductOf(world, ctx, building);
  if (recipes === undefined) return null;
  const stock = world.get(building, Stockpile).amounts;
  const owner = ownerOf(world, building);
  let blocked: number | null = null;
  for (const recipe of recipes.values()) {
    if (!recipeOutputsEnabled(world, ctx, owner, b.tribe, recipe)) continue; // locked: shipping a unit would not help
    if (inputStockForCycles(world, building, recipe) < 1) continue; // starved: the fetch rung owns this one
    if (outputRoomForCycles(world, ctx, building, recipe) > 0) return null;
    blocked ??= stockedOutput(stock, recipe);
  }
  return blocked;
}

/** The first output of `recipe` the workplace actually holds a unit of - what a haul could carry out. */
function stockedOutput(stock: ReadonlyMap<number, number>, recipe: Recipe): number | null {
  for (const output of recipe.outputs) {
    if ((stock.get(output.goodType) ?? 0) > 0) return output.goodType;
  }
  return null;
}

/** Whether a workplace may begin another cycle of `recipe`'s product now. */
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

/** Consume `recipe`'s inputs and append the new batch; the caller has verified {@link canStartCycle}.
 *  `duration` is clamped to the `>= 1` {@link ProductionCycle} requires. */
export function beginCycle(world: World, building: Entity, recipe: Recipe, goodType: number): void {
  consumeGoods(world, building, recipe.inputs);
  const cycle: ProductionCycle = { elapsed: 0, duration: Math.max(1, recipe.ticks), goodType };
  const prod = world.tryMut(building, Production);
  if (prod === undefined) world.add(building, Production, { cycles: [cycle] });
  else prod.cycles.push(cycle);
}

/** Start one cycle of the first startable product in content order - the unstaffed-by-design path, with
 *  no operator whose rotation could be consulted. */
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
 * Deposit a completed cycle's product into the workplace's stockpile and emit `goodProduced` per output.
 * Capacity is not re-checked: the room was reserved at cycle start and production is the only writer of a
 * workplace's own outputs. A recipe removed by a content rebase mid-cycle degrades to one unit of the
 * product.
 */
export function depositCycleOutput(
  world: World,
  ctx: SystemContext,
  building: Entity,
  cycle: ProductionCycle,
  recipes: ReadonlyMap<number, Recipe> | undefined,
): void {
  // A breeding cycle's product is an animal, not a unit on a shelf: it joins the herd, which the species
  // row counts by itself.
  if (livestockTribeOfGood(ctx.content, cycle.goodType) !== null) {
    if (birthHerdAnimal(world, ctx, building, cycle.goodType) !== null) {
      ctx.events.emit({ kind: 'goodProduced', building, goodType: cycle.goodType, amount: 1 });
    }
    return;
  }
  const stock = world.get(building, Stockpile).amounts;
  const outputs = recipes?.get(cycle.goodType)?.outputs ?? [{ goodType: cycle.goodType, amount: 1 }];
  for (const output of outputs) {
    const have = stock.get(output.goodType) ?? 0;
    setStockAmount(world, building, output.goodType, have + output.amount);
    ctx.events.emit({
      kind: 'goodProduced',
      building,
      goodType: output.goodType,
      amount: output.amount,
    });
  }
}
