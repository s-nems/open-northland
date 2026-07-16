import {
  Building,
  DeliveryFlag,
  JobAssignment,
  ownerOf,
  ownersCompatible,
  Position,
  Stockpile,
  WorkFlag,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import type { SpatialGate } from '../../node-metric.js';
import {
  buildingProduces,
  type InboundSupplyTally,
  inboundSupplyOf,
  mergedRecipeOf,
  stockCapacity,
} from '../../stores/index.js';
import type { PlannerContext } from '../planner-context.js';
import { boundWorkplaceTarget, type InteractionCellIndex, nearestStoreFor } from '../targets/index.js';
import { hasRoom, isFarmCarrierHaulOutRole, isStorageSink } from './store-policy.js';

/**
 * The store a settler carrying `goodType` should deliver it to — the routing that lets a fetched input
 * reach the workshop while a harvested/collected good reaches the warehouse it belongs to:
 *
 *  1. If the settler is bound to a **recipe workplace** and `goodType` is one of that workplace's recipe inputs
 *     with room to spare → deliver to the workplace. The producer bringing a fetched input home (the smith
 *     carrying iron to the forge), so a picked-up input never gets re-deposited into the warehouse it came from.
 *  2. Else, if the settler is a **flag-bound gatherer** (carries a {@link WorkFlag}) → deliver to its flag: a
 *     flag-bound collector banks its harvest at its own flag, never merely the nearest store. The flag is only
 *     a marker — the pileup spreads the load onto loose ground heaps around it, not into it.
 *  3. Else, if the settler is bound (via {@link JobAssignment}) to a **storage** fixture — a positioned
 *     {@link Stockpile} with no recipe (a warehouse, or a bare flag/ground pile) that can still take the good →
 *     deliver there, so a porter never dumps a load straight back onto the pile it just cleared.
 *  4. Else, if a **construction site** of the tribe still needs the good, deliver it there — a builder
 *     self-supplying its own foundation (or a hauler topping it up) reaches the site, not a warehouse.
 *  5. Else → the nearest store that can stock the good ({@link nearestStoreFor}) — the default for an unbound
 *     hauler.
 */
export function deliveryTargetFor(plan: PlannerContext, goodType: number): Entity | null {
  const { world, ctx, here, entity: settler, jobType, tribe, owner, targets, inbound } = plan;
  const stores = targets.stockpileCells;
  const sites = targets.constructionSiteCells;
  // The carrier's signpost confinement gates every SEARCHED sink (cases 3/4/5) — an out-of-area store is
  // not one it knows the way to; a load with no in-area sink falls to planDelivery's no-sink branches
  // (drop at feet / rest at the workplace). The BOUND targets (cases 1–3b: the own workshop, flag, or
  // storage binding) stay ungated — a settler always knows the way home.
  const gate = plan.limit ?? undefined;
  // 1. A fetched input goes to the bound workshop that consumes it.
  const workplace = boundWorkplaceTarget(world, ctx, settler, jobType, tribe);
  if (workplace !== null) {
    const recipe = mergedRecipeOf(world, ctx, workplace);
    if (recipe?.inputs.some((i) => i.goodType === goodType) && hasRoom(world, ctx, workplace, goodType)) {
      return workplace;
    }
  }
  // 2. A flag-bound gatherer banks its harvest at its own flag. The flag is a marker, not a store (it carries
  //    no Stockpile) — the pileup spreads the load onto loose ground heaps around the flag, each pinned to its
  //    tile, so nothing already dropped teleports when the flag is relocated. Route to the flag whenever it
  //    still exists; the ground always has room, so there is no capacity gate here.
  const flag = world.tryGet(settler, WorkFlag);
  if (flag !== undefined && world.has(flag.flag, DeliveryFlag) && world.has(flag.flag, Position)) {
    return flag.flag;
  }
  // 3. A carrier bound to a field-producing building (a farm) carrying that building's own output hauls it out
  //    to storage — the delivery twin of `boundProducerOutputToHaul`. Routed with producers-of-the-good
  //    excluded, so the load reaches a warehouse and never another farm, above the bring-into-my-store case
  //    below so it leaves the producer. Gated to a non-field-worker: a farmer banks its own reaped crop into the
  //    farm (case 3b, overflowing only when the farm is full), while the farm's carrier clears it to central
  //    storage. Keyed on the good's `farming` block (the field loop's own data signal), not on "no recipe": the
  //    sandbox farm carries no recipe, but the pipeline-extracted farm has a synthesized one, so a recipe test
  //    would silently turn this rung off under real extracted content.
  const binding = world.tryGet(settler, JobAssignment);
  const home = binding?.workplace;
  if (
    home !== undefined &&
    isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe) &&
    buildingProduces(world, ctx, home).includes(goodType)
  ) {
    return nearestStoreFor(stores, world, ctx, here, goodType, /* excludeProducers */ true, gate);
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
  const site = nearestConstructionSiteNeeding(sites, world, ctx, here, tribe, owner, goodType, inbound, gate);
  if (site !== null) return site;
  // 5. Otherwise the nearest capable store — the default (unbound haulers, the golden slice).
  return nearestStoreFor(stores, world, ctx, here, goodType, false, gate);
}

/**
 * The nearest **construction site** of `tribe` that still has room for `goodType` in its `construction`
 * cost — a {@link Building} + {@link UnderConstruction} whose delivered amount of the good is below the
 * site's advertised {@link stockCapacity} for it (its outstanding demand). Searches the construction-site
 * ring index with the standard Manhattan + ascending-cell-id tie-break. Returns the site or null when no
 * site needs the good — the routing preference behind a builder self-supplying its own site and an
 * assigned hauler topping it up. `owner` is the hauler's owning player ({@link ownerOf}) — material flows
 * only to the hauler's own player's sites.
 */
function nearestConstructionSiteNeeding(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  tribe: number,
  owner: number | undefined,
  goodType: number,
  inbound: InboundSupplyTally,
  gate?: SpatialGate,
): Entity | null {
  return (
    index.nearest(
      here,
      (e) => {
        if (world.get(e, Building).tribe !== tribe) return false;
        if (!ownersCompatible(owner, ownerOf(world, e))) return false; // another player's site (same tribe isn't same side)
        // Count both what the site holds and what other settlers' live supply errands already have inbound
        // (the `inbound` tally): a site whose last unit is on someone's back stops attracting more of the
        // good, so a duplicate fetch diverts to a warehouse instead of over-delivering.
        const have =
          (world.get(e, Stockpile).amounts.get(goodType) ?? 0) + inboundSupplyOf(inbound, e, goodType);
        return have < stockCapacity(world, ctx, e, goodType); // room left for this material (and it's a cost good)
      },
      gate,
    )?.entity ?? null
  );
}
