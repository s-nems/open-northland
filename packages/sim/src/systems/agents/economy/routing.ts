import {
  Building,
  DeliveryFlag,
  JobAssignment,
  Position,
  Stockpile,
  WorkFlag,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { manhattan } from '../../spatial.js';
import { buildingProduces, inboundSupply, recipeOf, stockCapacity } from '../../stores/index.js';
import type { PlannerContext } from '../planner-context.js';
import { boundWorkplaceTarget, closer, interactionCell, nearestStoreFor } from '../targets/index.js';
import { hasRoom, isFarmCarrierHaulOutRole, isStorageSink } from './store-policy.js';

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
export function deliveryTargetFor(plan: PlannerContext, goodType: number): Entity | null {
  const { world, ctx, terrain, here, entity: settler, jobType, tribe, targets } = plan;
  const candidates = targets.stockpiles;
  const sites = targets.constructionSites;
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
  // 3. A CARRIER bound to a FIELD-PRODUCING building (a farm) carrying that building's own OUTPUT hauls
  //    it OUT to storage — the delivery twin of `boundProducerOutputToHaul` (the twins test the same
  //    predicates: same tribe, same field-producer key, same field-worker split). Routed with
  //    producers-of-the-good excluded, so the load reaches a warehouse and never another farm, ABOVE the
  //    bring-into-my-store case below so it leaves the producer. Gated to a NON-field-worker: a FARMER
  //    banks its own reaped crop INTO the farm (case 3b, overflowing only when the farm is full), while
  //    the farm's carrier clears it to central storage — the two-role split. Keyed on the good's
  //    `farming` block (the field loop's own data signal), NOT on "no recipe": the sandbox farm carries
  //    no recipe, but the pipeline-extracted farm has a synthesized one, so a recipe test would silently
  //    turn this rung off under real extracted content.
  const binding = world.tryGet(settler, JobAssignment);
  const home = binding?.workplace;
  if (
    home !== undefined &&
    isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe) &&
    buildingProduces(world, ctx, home).includes(goodType)
  ) {
    return nearestStoreFor(candidates, world, ctx, terrain, here, goodType, true);
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
 * {@link import('../../targets/index.js').TargetCandidates.constructionSites} list (UnderConstruction + Building +
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
    // Count both what the site HOLDS and what other settlers' live supply errands already have inbound
    // (SupplyRun): a site whose last unit is on someone's back stops attracting more of the good, so a
    // duplicate fetch diverts to a warehouse instead of over-delivering.
    const have = (world.get(e, Stockpile).amounts.get(goodType) ?? 0) + inboundSupply(world, e, goodType);
    if (have >= stockCapacity(world, ctx, e, goodType)) continue; // full for this material (or not a cost good)
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}
