import type { Recipe } from '@vinland/data';
import {
  Building,
  DeliveryFlag,
  JobAssignment,
  Position,
  Production,
  Stockpile,
  WorkFlag,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { farmWorkGood } from '../economy/farming.js';
import { startableCycleCount } from '../economy/production.js';
import { manhattan } from '../spatial.js';
import { buildingProduces, lowestStockedGood, recipeOf, stockCapacity } from '../stores.js';
import { boundWorkplaceTarget, interactionCell, jobAtomics, nearestStoreFor } from './ai-targets.js';

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
 * How many WORK SEATS the workplace offers this tick — the number of operators whose staying on the
 * station would actually run a batch: the cycles already grinding (each needs one present operator to
 * advance — see the ProductionSystem's FIFO rule) plus the further cycles the current stock could
 * start ({@link startableCycleCount}: inputs on hand, output room, tech gate). This is the producer's
 * "should I stay put?" gate, per worker instead of per building: the planner hands out seats in its
 * deterministic settler order, and a worker who finds them all taken is SURPLUS — its batch is done
 * or can't start, so it is freed to fetch inputs / haul output instead of idling inside while a
 * colleague's batch finishes (the "drugi młynarz czeka w środku" bug). An unbuilt/gone workplace
 * offers no seats. Reuses the ProductionSystem's own start gate, so the planner and the producer
 * never disagree about whether a cycle can run.
 */
export function workSeatCount(world: World, ctx: SystemContext, workplace: Entity, recipe: Recipe): number {
  const running = world.tryGet(workplace, Production)?.cycles.length ?? 0;
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.built < ONE) return running; // a construction site never starts a cycle
  return running + startableCycleCount(world, ctx, workplace, recipe);
}

/**
 * The nearest store the producer should fetch a **missing recipe input** from, or null if every input is
 * already stocked at the workplace or no store holds a missing one. Walks the recipe inputs in their
 * (fixed content) order and returns the FIRST input the workplace is short of that some OTHER store
 * holds — the good, the amount still needed (so the fetch carries exactly the shortfall, "tylko te
 * wymagane"), and the nearest store holding it (Manhattan + ascending-cell-id tie-break, canonical scan).
 *
 * `restockToCapacity` raises each input's target from the recipe amount (a craftsman fetching just
 * enough for the next cycle) to the workplace's declared input-slot CAPACITY — the bound CARRIER's
 * shape: it keeps the mill's wheat store topped up trip after trip so the millers never starve, and
 * only stops when the slot is full (observed original behaviour: the carrier stocks the workshop, the
 * craftsman crafts).
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
  restockToCapacity = false,
): { store: Entity; goodType: number; amount: number } | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    const target = restockToCapacity ? stockCapacity(world, ctx, workplace, input.goodType) : input.amount;
    if (have >= target) continue; // this input is already covered (for a cycle / to the slot's brim)
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
    if (best !== null) return { store: best, goodType: input.goodType, amount: target - have };
  }
  return null;
}

/**
 * The finished OUTPUT good a producer should haul out of its own workplace (to clear it so the next cycle
 * fits, and to carry the product to a store), or null if the workplace holds no deliverable output. A
 * candidate good is a recipe output the workplace currently stocks (>0) that some OTHER store can accept
 * ({@link nearestStoreFor} finds a sink) — walked in `recipe.outputs` order (a fixed content array, not a
 * Map, so the pick never depends on store insertion history), first deliverable output wins. The producer
 * only reaches this when it holds no work seat right now ({@link workSeatCount} exhausted), so
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
 *  2. Else, if the settler is a **flag-bound gatherer** (carries a {@link WorkFlag}) → deliver to ITS flag.
 *     This is the "each gatherer carries the good to its own flag" rule: a flag-bound collector banks its
 *     harvest at its own flag, never merely the nearest store (a warehouse that happens to sit closer). The
 *     flag is only a MARKER — the pileup spreads the load onto loose ground heaps around it, not into it.
 *  3. Else, if the settler is bound (via {@link JobAssignment}) to a **storage** fixture — a positioned
 *     {@link Stockpile} with no recipe (a warehouse, or a bare flag/ground pile) that can still take the
 *     good → deliver there. This is the porter delivering to *its* store, so it never dumps a load straight
 *     back onto the pile it just cleared.
 *  4. Else, if a **construction site** of the tribe still needs the good, deliver it there — a builder
 *     self-supplying its own foundation (or a hauler topping it up) reaches the site, not a warehouse.
 *  5. Else → the nearest store that can stock the good ({@link nearestStoreFor}) — the unchanged default
 *     for an unbound hauler (so the vertical-slice woodcutter/carrier route exactly as before).
 */
export function deliveryTargetFor(
  candidates: readonly Entity[],
  sites: readonly Entity[],
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
  // 2. A flag-bound gatherer banks its harvest at its OWN flag. The flag is a MARKER, not a store (it
  //    carries no Stockpile) — the pileup spreads the load onto loose ground heaps AROUND the flag, each
  //    pinned to its tile, so nothing already dropped teleports when the flag is relocated. Route to the
  //    flag whenever it still exists; the ground always has room, so there is no capacity gate here.
  const flag = world.tryGet(settler, WorkFlag);
  if (flag !== undefined && world.has(flag.flag, DeliveryFlag) && world.has(flag.flag, Position)) {
    return flag.flag;
  }
  // 3. A CARRIER bound to a PRODUCING building (a farm) carrying that building's own OUTPUT hauls it OUT
  //    to a warehouse — the delivery twin of `boundProducerOutputToHaul`. Routed to the nearest OTHER
  //    store (the bound building EXCLUDED, so a no-recipe farm's wheat never lands back in the farm it was
  //    lifted from), ABOVE the bring-into-my-store case below so the load leaves the producer. Gated to a
  //    NON-field-worker: a FARMER banks its own reaped crop INTO the farm (case 3b, overflowing only when
  //    the farm is full), while the farm's carrier clears it to central storage — the two-role split.
  const binding = world.tryGet(settler, JobAssignment);
  const home = binding?.workplace;
  if (
    home !== undefined &&
    recipeOf(world, ctx, home) === undefined &&
    buildingProduces(world, ctx, home).includes(goodType) &&
    !isFieldWorkerOf(world, ctx, home, jobType)
  ) {
    return nearestStoreFor(candidates, world, ctx, terrain, here, goodType, home);
  }
  // 3b. Otherwise a porter's / farmer's load goes to the storage it is bound to (a warehouse, a flag pile,
  //     or the farm's own store when a farmer banks its sheaf and the farm still has room).
  if (home !== undefined && isStorageSink(world, ctx, home) && hasRoom(world, ctx, home, goodType)) {
    return home;
  }
  // 4. A construction material flows to a construction site of the tribe that still needs it, so a builder
  //    self-supplying its own foundation (and any hauler topping it up) reaches the site instead of shuttling
  //    the material back into a warehouse. Scans the tiny `sites` list (each advertises its outstanding cost
  //    via `stockCapacity`); this only prioritises the pick — nearest needing site — leaving every
  //    non-construction good to the default below.
  const site = nearestConstructionSiteNeeding(sites, world, ctx, terrain, here, tribe, goodType);
  if (site !== null) return site;
  // 5. Otherwise the nearest capable store — the unchanged default (unbound haulers, the golden slice).
  return nearestStoreFor(candidates, world, ctx, terrain, here, goodType);
}

/**
 * The nearest **construction site** of `tribe` that still has room for `goodType` in its `construction`
 * cost — a {@link Building} + {@link UnderConstruction} whose delivered amount of the good is below the
 * site's advertised {@link stockCapacity} for it (its outstanding demand). Scans the tiny
 * {@link import('./ai-targets.js').TargetCandidates.constructionSites} list (UnderConstruction + Building +
 * Position guaranteed) in canonical order with the standard Manhattan + ascending-cell-id tie-break.
 * Returns the site or null when no site needs the good — the routing preference behind a builder
 * self-supplying its own site and an assigned hauler topping it up.
 */
function nearestConstructionSiteNeeding(
  sites: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  tribe: number,
  goodType: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of sites) {
    if (world.get(e, Building).tribe !== tribe) continue;
    const have = world.get(e, Stockpile).amounts.get(goodType) ?? 0;
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this material (or not a cost good)
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (dist < bestDist || (dist === bestDist && cell < bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest **ground pile** a porter should collect from and the good to lift, or null if none is
 * within reach. A ground pile is a bare {@link Stockpile} on a positioned entity with **no
 * {@link Building}** (a loose heap dropped at a flag) holding at least one unit — the counterpart of
 * {@link nearestStoreFor}'s building-store sink. Nearest by Manhattan + ascending-cell-id (canonical
 * scan); within the chosen pile the good is its lowest-id stocked good ({@link stockpileEntries}, never
 * raw Map order). The porter then delivers the load through {@link deliveryTargetFor} to its warehouse.
 *
 * A pile is skipped when **no store can currently take its good** (every warehouse full for it): lifting it
 * would just make the porter hold a load it can't deposit, so instead it leaves that good on the ground and
 * collects the next DELIVERABLE pile — "the store is full of wood, so stop hauling wood and fetch something
 * else" (the same deliverability gate {@link nearestWorkplaceOutput} applies to workplace output). The
 * check is memoised per good — its deliverability is the same for every pile of that good in one scan.
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
  const deliverable = new Map<number, boolean>();
  const canDeliver = (good: number): boolean => {
    const cached = deliverable.get(good);
    if (cached !== undefined) return cached;
    // `here` feeds only `nearestStoreFor`'s distance sort, never its null-ness — a good is deliverable iff
    // ANY store has room (position-independent) — so one probe from `here` decides it for every pile of
    // that good, and caching by good alone stays deterministic.
    const ok = nearestStoreFor(candidates, world, ctx, terrain, here, good) !== null;
    deliverable.set(good, ok);
    return ok;
  };
  for (const e of candidates) {
    if (world.has(e, Building)) continue; // a building store isn't a loose ground pile
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an empty pile is nothing to collect
    if (!canDeliver(good)) continue; // every store full for this good — leave it, try another good
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
 * The finished OUTPUT good a carrier should haul OUT of the **producing building it is bound to**, to a
 * warehouse — or null when there is nothing to haul. This is the production half of the carrier rule
 * ("tragarz wbity w produkcję jednocześnie przynosi towary I odnosi do magazynu"): a carrier stationed at
 * a FARM (or any producing building) carries its finished output to central storage, where a carrier
 * stationed at a warehouse/HQ only brings goods IN.
 *
 * A candidate is a good the bound building's type PRODUCES ({@link buildingProduces}) that the building
 * currently stocks (>0) and that some OTHER store can take ({@link nearestStoreFor} with the building
 * itself EXCLUDED — a no-recipe farm is not excluded by the standard producer check, so a guard here
 * keeps the load from shuttling farm→farm). Walked in `produces` order (a fixed content array, so the
 * pick never depends on store insertion history), first haulable output wins.
 *
 * Scoped to a bound building that carries **no recipe** — a recipe workshop's finished output is already
 * hauled by the producer loop / carrier fallback ({@link workplaceOutputToHaul}/`nearestWorkplaceOutput`),
 * so this closes the gap only for the producing-but-recipeless building (the farm) whose bound carrier was
 * otherwise a pure inbound porter. Returns the good to lift, or null.
 */
export function boundProducerOutputToHaul(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  settler: Entity,
  tribe: number,
  here: NodeId,
): number | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  const b = world.tryGet(home, Building);
  if (b === undefined || b.tribe !== tribe) return null; // gone / wrong tribe
  if (recipeOf(world, ctx, home) !== undefined) return null; // recipe shops haul via the producer/carrier path
  if (!world.has(home, Stockpile) || !world.has(home, Position)) return null;
  const stock = world.get(home, Stockpile).amounts;
  for (const goodType of buildingProduces(world, ctx, home)) {
    if ((stock.get(goodType) ?? 0) <= 0) continue; // none of this output on hand
    if (nearestStoreFor(candidates, world, ctx, terrain, here, goodType, home) !== null) return goodType;
  }
  return null;
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

/** Whether `jobType` is a **field-worker** of `building` — its job can run the building's field crop's
 *  PLANT atomic (the FARMER). Mirrors `boundFarmTarget`'s field-trade gate. A field-worker banks its own
 *  reaped crop INTO the farm; a NON-field-worker bound to the farm (the carrier) hauls its output OUT, so
 *  this is the split the delivery routing keys on to send the farmer's sheaf home but the carrier's load
 *  to a warehouse. Returns false for a non-farm building (no field crop). */
function isFieldWorkerOf(world: World, ctx: SystemContext, building: Entity, jobType: number): boolean {
  const spec = farmWorkGood(world, ctx, building);
  return spec !== null && jobAtomics(ctx, jobType).has(spec.plantAtomic);
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
