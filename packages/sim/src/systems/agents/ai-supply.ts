import type { Recipe } from '@vinland/data';
import { Building, JobAssignment, Position, Production, Stockpile } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { canStartCycle } from '../economy/production.js';
import { manhattan } from '../spatial.js';
import { lowestStockedGood, recipeOf, stockCapacity } from '../stores.js';
import { boundWorkplaceTarget, interactionCell, nearestStoreFor } from './ai-targets.js';

// The AI planner's SUPPLY layer: the scans behind a *producer worker running its own supply→produce→
// deliver loop* — the "kowal fetches the goods a sword needs, forges it, and carries it back" behavior.
// It sits beside the target-scan layer (ai-targets.ts); ai.ts wires these into the per-settler decision.
//
// The split from the plain haul model: before this, inputs reached a workplace only because a harvester
// happened to deposit them there (`nearestStoreFor` picks the workplace when it's the nearest sink), and
// a worker just staffed the tile. That fails the moment inputs sit in a *warehouse* the harvester
// delivers to instead — the workplace starves. A producer now actively FETCHES the recipe inputs it is
// short on from a store that holds them, and HAULS its finished output out, so the loop closes without a
// dedicated carrier. Every choice is recipe-driven (no per-job/per-good hardcode) and canonically scanned
// (ascending entity-id, Manhattan + cell-id tie-break) so the winner never depends on store history.

/**
 * Whether a workplace would run/continue a production cycle *if its worker stayed on the station this
 * tick* — it is already producing ({@link Production} present), OR it is built and {@link canStartCycle}
 * holds (all inputs present, output room, output goods tech-unlocked). This is the producer's "should I
 * stay put?" gate: while true, the worker latches to the tile so the ProductionSystem's worker-presence
 * gate stays satisfied; while false, the workplace is starved/blocked and the worker is freed to fetch
 * inputs or haul the finished output (see the ai.ts producer branch). Reuses the ProductionSystem's own
 * `canStartCycle`, so the planner and the producer never disagree about whether a cycle can run.
 */
export function workplaceProductiveIfStaffed(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  recipe: Recipe,
): boolean {
  if (world.has(workplace, Production)) return true; // a cycle is already running — stay to keep it fed
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.built < ONE) return false; // gone / still a construction site: never produces
  return canStartCycle(world, ctx, workplace, recipe);
}

/**
 * The nearest store the producer should fetch a **missing recipe input** from, or null if every input is
 * already stocked at the workplace or no store holds a missing one. Walks the recipe inputs in their
 * (fixed content) order and returns the FIRST input the workplace is short of that some OTHER store
 * holds — the good, the amount still needed (so the fetch carries exactly the shortfall, "tylko te
 * wymagane"), and the nearest store holding it (Manhattan + ascending-cell-id tie-break, canonical scan).
 *
 * The workplace itself is excluded as a source (a producer never pulls its own stock back out); any other
 * positioned {@link Stockpile} that holds the good is a valid source — a warehouse, a flag pile, or even
 * another workplace's output. This is what makes the golden slice untouched: there, the only store that
 * ever holds the sawmill's input (wood) IS the sawmill, so this returns null and the operator stays
 * pinned exactly as before — the fetch only fires once an input lives in a *separate* store.
 */
export function nearestMissingInputSource(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  workplace: Entity,
  recipe: Recipe,
): { store: Entity; goodType: number; amount: number } | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    if (have >= input.amount) continue; // this input is already covered for a cycle
    let best: Entity | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestCell = Number.POSITIVE_INFINITY;
    for (const e of candidates) {
      if (e === workplace) continue; // never source an input from the workplace we're supplying
      if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
      if ((world.get(e, Stockpile).amounts.get(input.goodType) ?? 0) <= 0) continue; // holds none
      const cell = interactionCell(world, ctx, terrain, e, here);
      const dist = manhattan(terrain, here, cell);
      if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
        best = e;
        bestDist = dist;
        bestCell = cell;
      }
    }
    if (best !== null) return { store: best, goodType: input.goodType, amount: input.amount - have };
  }
  return null;
}

/**
 * The finished OUTPUT good a producer should haul out of its own workplace (to clear it so the next cycle
 * fits, and to carry the product to a store), or null if the workplace holds no deliverable output. A
 * candidate good is a recipe output the workplace currently stocks (>0) that some OTHER store can accept
 * ({@link nearestStoreFor} finds a sink) — walked in `recipe.outputs` order (a fixed content array, not a
 * Map, so the pick never depends on store insertion history), first deliverable output wins. The producer
 * only reaches this when it cannot produce right now ({@link workplaceProductiveIfStaffed} is false), so
 * hauling its output never steals a tick it should have spent producing.
 */
export function workplaceOutputToHaul(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  workplace: Entity,
  recipe: Recipe,
  here: NodeId,
): number | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const output of recipe.outputs) {
    if ((stock.get(output.goodType) ?? 0) <= 0) continue; // nothing of this output on hand
    // Deliverable somewhere that isn't this workplace? (nearestStoreFor already excludes the producer.)
    if (nearestStoreFor(candidates, world, ctx, terrain, here, output.goodType) !== null) {
      return output.goodType;
    }
  }
  return null;
}

/**
 * The store a settler carrying `goodType` should deliver it to — the routing that lets a fetched input
 * reach the workshop while a harvested/collected good reaches the warehouse it belongs to:
 *
 *  1. If the settler is bound to a **recipe workplace** and `goodType` is one of that workplace's recipe
 *     INPUTS with room to spare → deliver to the workplace. This is the producer bringing a fetched input
 *     home (the smith carrying iron to the forge), so a picked-up input never gets re-deposited into the
 *     warehouse it came from.
 *  2. Else, if the settler is bound (via {@link JobAssignment}) to a **storage** fixture — a positioned
 *     {@link Stockpile} with no recipe (a warehouse, or a bare flag/ground pile) that can still take the
 *     good → deliver there. This is the gatherer/porter delivering to *its* store (or flag), not merely
 *     the nearest one, so a porter never dumps a load straight back onto the pile it just cleared.
 *  3. Else → the nearest store that can stock the good ({@link nearestStoreFor}) — the unchanged default
 *     for an unbound hauler (so the vertical-slice woodcutter/carrier route exactly as before).
 */
export function deliveryTargetFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  settler: Entity,
  jobType: number,
  tribe: number,
  goodType: number,
): Entity | null {
  // 1. A fetched input goes to the bound workshop that consumes it.
  const workplace = boundWorkplaceTarget(world, ctx, settler, jobType, tribe);
  if (workplace !== null) {
    const recipe = recipeOf(world, ctx, workplace);
    if (recipe?.inputs.some((i) => i.goodType === goodType) && hasRoom(world, ctx, workplace, goodType)) {
      return workplace;
    }
  }
  // 2. A harvested/collected good goes to the settler's bound storage (a warehouse, or a flag pile).
  const binding = world.tryGet(settler, JobAssignment);
  if (binding !== undefined) {
    const home = binding.workplace;
    if (isStorageSink(world, ctx, home) && hasRoom(world, ctx, home, goodType)) return home;
  }
  // 3. Otherwise the nearest capable store — the unchanged default (unbound haulers, the golden slice).
  return nearestStoreFor(candidates, world, ctx, terrain, here, goodType);
}

/**
 * The nearest **ground pile** a porter should collect from and the good to lift, or null if none is
 * within reach. A ground pile is a bare {@link Stockpile} on a positioned entity with **no
 * {@link Building}** (a loose heap dropped at a flag) holding at least one unit — the counterpart of
 * {@link nearestStoreFor}'s building-store sink. Nearest by Manhattan + ascending-cell-id (canonical
 * scan); within the chosen pile the good is its lowest-id stocked good ({@link stockpileEntries}, never
 * raw Map order). The porter then delivers the load through {@link deliveryTargetFor} to its warehouse.
 */
export function nearestGroundPile(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { pile: Entity; goodType: number } | null {
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (world.has(e, Building)) continue; // a building store isn't a loose ground pile
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an empty pile is nothing to collect
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * Whether a settler is a **porter**: bound (via {@link JobAssignment}) to a storage fixture rather than a
 * producing workplace — the gate for the ground-pile collection drive. A porter has no recipe workshop to
 * staff and (by content) no harvest atomic, so it exists to move loose goods into its store.
 */
export function isPorterBoundToStore(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return false;
  return isStorageSink(world, ctx, binding.workplace);
}

/** A store that is a delivery SINK (not a producer): a positioned {@link Stockpile} with no recipe — a
 *  warehouse/HQ, or a bare flag/ground-pile fixture. (A recipe workplace is supplied, never delivered to
 *  as a general sink.) */
function isStorageSink(world: World, ctx: SystemContext, store: Entity): boolean {
  return (
    world.has(store, Stockpile) && world.has(store, Position) && recipeOf(world, ctx, store) === undefined
  );
}

/** Whether a store has free capacity for another unit of `goodType` (a bare fixture is uncapped). */
function hasRoom(world: World, ctx: SystemContext, store: Entity, goodType: number): boolean {
  const have = world.get(store, Stockpile).amounts.get(goodType) ?? 0;
  return have < stockCapacity(world, ctx, store, goodType);
}
