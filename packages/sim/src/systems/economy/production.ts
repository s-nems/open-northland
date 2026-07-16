import type { Recipe } from '@open-northland/data';
import {
  Building,
  CraftSelection,
  consumeGoods,
  Position,
  Production,
  type ProductionCycle,
  Settler,
  Stockpile,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { chargeMilitaryPiety } from '../lifecycle/needs.js';
import { goodEnabled } from '../progression/index.js';
import { NodeBuckets } from '../spatial.js';
import {
  presentOperatorCount,
  presentOperators,
  recipesByProductOf,
  stockCapacity,
} from '../stores/index.js';

/**
 * ProductionSystem — one workplace turns input goods into output goods over time.
 *
 * A workplace is a {@link Building} with a {@link Stockpile} whose building type carries `recipes`
 * (one per producible good, inputs → that product over `recipe.ticks`). Each tick, for every such
 * building:
 *
 *  - Running cycles ({@link Production} present — a list of independent batches, each pinned to the
 *    product it crafts): advance as many cycles as there are operators on station
 *    ({@link presentOperatorCount}), oldest first (FIFO) — two millers each work their own batch, so a
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
 *    batches in flight deposit theirs ({@link canStartCycle}). Starting consumes the inputs
 *    immediately (reserving them) and snapshots the recipe's `ticks`/product as the cycle
 *    `duration`/`goodType`. An operator whose selection can't start anything simply starts nothing
 *    this tick (its colleagues still may).
 *
 * Worker-presence gate: a workplace produces only while an operator is present — a settler whose
 * `jobType` matches one of the building type's operator slots (its `workers` minus the carrier
 * transport slots) is standing on its tile ({@link presentOperatorCount}). This is the original's "a
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

    // Completed batches: deposit each one's own product (room reserved at start), drop them from the
    // list, and retire the component when the last is done. `done` is the complement of the same filter
    // that keeps the rest, so the deposit set and the removal can't diverge.
    const done = prod.cycles.filter((c) => c.elapsed >= Math.max(1, c.duration));
    if (done.length === 0) continue; // all advanced batches still mid-grind
    prod.cycles = prod.cycles.filter((c) => c.elapsed < Math.max(1, c.duration));
    const recipes = recipesByProductOf(world, ctx, e);
    for (const cycle of done) depositCycleOutput(world, ctx, e, cycle, recipes);
    chargeMilitaryPietyCost(world, ctx, e, done, operatorsByNode);
    if (prod.cycles.length === 0) world.remove(e, Production);
  }

  // Start cycles on workplaces with spare present operators: one independent batch per operator, each
  // crafting the product that operator's rotation picks. Each start re-checks canStartCycle (inputs
  // shrink and same-product pending outputs grow with every batch started).
  for (const e of world.query(Building, Stockpile)) {
    if (world.get(e, Building).built < ONE) continue; // under construction — a site doesn't produce
    const recipes = recipesByProductOf(world, ctx, e);
    if (recipes === undefined) continue; // not a producing workplace
    // Dormancy gate before the operator lookup: the per-recipe gates are O(recipe goods) and don't depend
    // on operators, so a starved/output-blocked workshop skips the per-building operator-count work (the
    // door-node lookup + content reads) entirely. It elides only a provably-empty start loop.
    if (!anyCycleStartable(world, ctx, e, recipes)) continue;
    const running = world.tryGet(e, Production)?.cycles.length ?? 0;
    const operators = presentOperators(world, ctx, e, operatorsByNode);
    if (operators.length === 0) {
      // Unstaffed-by-design (no worker slots — presentOperatorCount reads 1): one anonymous batch,
      // first startable product in content order. A staffed-but-deserted workplace reads 0 and skips.
      const capacity = presentOperatorCount(world, ctx, e, operatorsByNode);
      if (running < capacity) startFirstStartable(world, ctx, e, recipes);
      continue;
    }
    // The spare operators (indices past the running batches) each try their own product choice; a
    // failed choice skips just that operator.
    for (const operator of operators.slice(running)) {
      startCycleFor(world, ctx, e, operator, recipes);
    }
  }
};

/** Whether any product of `recipes` could start a cycle now (the ProductionSystem's dormancy gate). */
function anyCycleStartable(
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

/**
 * Start one cycle of `operator`'s next product choice, or nothing when no chosen product can start.
 * The choice walks the operator's rotation — its {@link CraftSelection} goods, or every product of the
 * workplace when it has none — from the rotation cursor, taking the first startable product and
 * advancing the cursor past it (so alternation resumes after the started product, and a blocked
 * product is retried next start instead of being skipped forever). A first-ever start stamps the
 * "all products" selection so the worker's rotation position persists.
 */
function startCycleFor(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): void {
  let selection = world.tryGet(operator, CraftSelection);
  const pool =
    selection !== undefined && selection.goods.length > 0
      ? selection.goods.filter((g) => recipes.has(g))
      : [...recipes.keys()];
  if (pool.length === 0) return; // the selection names nothing this workplace makes
  const cursor = selection?.cursor ?? 0;
  for (let i = 0; i < pool.length; i++) {
    const good = pool[(cursor + i) % pool.length];
    const recipe = good !== undefined ? recipes.get(good) : undefined;
    if (good === undefined || recipe === undefined) continue;
    if (!canStartCycle(world, ctx, building, recipe)) continue;
    beginCycle(world, building, recipe, good);
    if (selection === undefined) {
      world.add(operator, CraftSelection, { goods: [], cursor: 0 });
      selection = world.get(operator, CraftSelection);
    }
    selection.cursor = (cursor + i + 1) % pool.length;
    return;
  }
}

/** Start one cycle of the first startable product in content order — the unstaffed-by-design path
 *  (no operator, so no per-worker rotation to consult). */
function startFirstStartable(
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

/** Consume `recipe`'s inputs (reserving them) and append the new batch — the caller has verified
 *  {@link canStartCycle}. */
function beginCycle(world: World, building: Entity, recipe: Recipe, goodType: number): void {
  consumeGoods(world.get(building, Stockpile).amounts, recipe.inputs);
  const cycle: ProductionCycle = { elapsed: 0, duration: recipe.ticks, goodType };
  const prod = world.tryGet(building, Production);
  if (prod === undefined) world.add(building, Production, { cycles: [cycle] });
  else prod.cycles.push(cycle);
}

/**
 * Whether a workplace may begin another cycle of `recipe`'s product now — the start gate the
 * ProductionSystem applies (see {@link startableCycleCount} for the checks; this is its `> 0` view).
 */
export function canStartCycle(world: World, ctx: SystemContext, building: Entity, recipe: Recipe): boolean {
  return startableCycleCount(world, ctx, building, recipe) > 0;
}

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
  const product = recipe.outputs[0]?.goodType;
  const cycles = world.tryGet(building, Production)?.cycles;
  let inFlight = 0;
  if (cycles !== undefined && product !== undefined) {
    for (const c of cycles) if (c.goodType === product) inFlight++;
  }
  let startable = Number.POSITIVE_INFINITY;
  for (const input of recipe.inputs) {
    startable = Math.min(startable, Math.floor((stock.get(input.goodType) ?? 0) / input.amount));
  }
  for (const output of recipe.outputs) {
    const have = stock.get(output.goodType) ?? 0;
    const capacity = stockCapacity(world, ctx, building, output.goodType);
    // Room for each further batch AND every same-product batch already grinding (each deposits `amount`).
    startable = Math.min(startable, Math.floor((capacity - have) / output.amount) - inFlight);
  }
  return Math.max(0, startable);
}

/**
 * Deposit a completed cycle's product into the workplace's stockpile and emit a `goodProduced` event
 * per output (render/audio cue). The outputs are the cycle's own recipe's (looked up by its product
 * key; a recipe removed by a content rebase mid-cycle degrades to one unit of the product). The room
 * was reserved by {@link canStartCycle} at cycle start (no input consumption or competing producer can
 * have removed capacity since — production is the only writer of a workplace's own outputs), so the
 * outputs always fit; the per-good capacity is not re-checked here.
 */
function depositCycleOutput(
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
    stock.set(output.goodType, have + output.amount);
    ctx.events.emit({
      kind: 'goodProduced',
      building,
      goodType: output.goodType,
      amount: output.amount,
    });
  }
}

/**
 * Charge each smith who finished forging this tick a fixed slice of piety — producing a weapon or piece of
 * armor is the only thing that raises the piety deficit (NeedsSystem no longer raises piety over time; praying
 * at a temple clears it). Applied once per completed cycle whose PRODUCT is a military good
 * ({@link import('../../core/content-index.js').ContentIndex.militaryGoods} keyed on `cycle.goodType` — the
 * per-product batch model's one output), to the operators on station in canonical order (a lone-smith
 * workshop charges its one worker per sword). A non-military batch (a mill's flour) is a no-op.
 * Source basis: design rule (user-specified).
 */
function chargeMilitaryPietyCost(
  world: World,
  ctx: SystemContext,
  building: Entity,
  done: readonly ProductionCycle[],
  operatorsByNode: NodeBuckets,
): void {
  const military = contentIndex(ctx.content).militaryGoods;
  const forged = done.filter((c) => military.has(c.goodType)).length;
  if (forged === 0) return;
  const operators = presentOperators(world, ctx, building, operatorsByNode);
  // One charge per completed military batch, one operator each (canonical order); never more than were
  // on station.
  for (const op of operators.slice(0, forged)) chargeMilitaryPiety(world, op);
}
