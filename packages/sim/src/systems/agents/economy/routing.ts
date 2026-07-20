import {
  Building,
  DeliveryFlag,
  JobAssignment,
  ownerOf,
  ownersCompatible,
  Position,
  SiteAssignment,
  Stockpile,
  UnderConstruction,
  WorkFlag,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-metric.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { exportedGoodForm } from '../../readviews/index.js';
import {
  buildingProduces,
  type InboundSupplyTally,
  inboundSupplyOf,
  mergedRecipeOf,
  producesGoodWithoutInputs,
  stockCapacity,
} from '../../stores/index.js';
import type { PlannerContext } from '../planner-context.js';
import {
  boundWorkplaceTarget,
  type InteractionCellIndex,
  nearestStoreFor,
  QUALIFIES,
} from '../targets/index.js';
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
  // 3c. A builder's own crew site ({@link SiteAssignment}) is a BOUND target like the workplace/flag above,
  //     so it stays ungated: the player's pin (assignBuilder) may point beyond the signpost area, and
  //     planBuilder fetches for the pinned site unconditionally — a gated delivery would disagree with that
  //     fetch and shuttle the material back to its source forever.
  const crew = world.tryGet(settler, SiteAssignment)?.site;
  if (crew !== undefined && constructionSiteNeeds(world, ctx, crew, tribe, owner, goodType, inbound)) {
    return crew;
  }
  // 4. A construction material flows to a construction site of the tribe that still needs it, so a builder
  //    self-supplying its own foundation (and any hauler topping it up) reaches the site instead of shuttling
  //    the material back into a warehouse. Scans the tiny `sites` list (each advertises its outstanding cost
  //    via `stockCapacity`); this only prioritises the pick — nearest needing site — leaving every
  //    non-construction good to the default below.
  const site = nearestConstructionSiteNeeding(sites, world, ctx, here, tribe, owner, goodType, inbound, gate);
  if (site !== null) return site;
  // 4b. A carrier bound to an input-less UTILITY (the well, the hive) hauling that utility's own output
  //     feeds a nearby recipe CONSUMER of the good — the bakery's water, the brewery's honey — before
  //     central storage, so the shared utility supplies the workshops that need the good first and banks
  //     only the surplus later (user rule 2026-07-19). Falls through to the storage default when no
  //     consumer has room. Gated to the utility carrier: an ordinary hauler keeps the plain store default.
  if (home !== undefined && producesGoodWithoutInputs(world, ctx, home, goodType)) {
    const consumer = nearestRecipeConsumer(stores, world, ctx, here, goodType, gate);
    if (consumer !== null) return consumer;
  }
  // 5. Otherwise the nearest capable store — the default (unbound haulers, the golden slice).
  return nearestStoreFor(stores, world, ctx, here, goodType, false, gate);
}

/**
 * The nearest BUILT workplace whose recipe consumes `goodType` as an input and still has room for it — the
 * delivery target a shared-utility carrier prefers over central storage (a posted well/hive porter feeding
 * the bakery's water / brewery's honey first). Canonical Manhattan + ascending-cell-id pick over the
 * stockpile cell index, gated to the carrier's signpost area. A site still under construction is skipped:
 * it needs delivered build material, not a recipe input.
 */
function nearestRecipeConsumer(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  goodType: number,
  gate?: SpatialGate,
): Entity | null {
  return (
    index.nearest(
      here,
      (e) => {
        if (world.has(e, UnderConstruction)) return null;
        const recipe = mergedRecipeOf(world, ctx, e);
        if (recipe === undefined || !recipe.inputs.some((i) => i.goodType === goodType)) return null;
        return hasRoom(world, ctx, e, goodType) ? QUALIFIES : null;
      },
      gate,
    )?.entity ?? null
  );
}

/**
 * A memoized "could this settler's `good` actually be delivered anywhere right now" probe —
 * {@link deliveryTargetFor} under the settler's own signpost gate, the exact decision the delivery rung
 * makes once the good is on its back. The pickup rungs consult it before lifting, so fetch and delivery
 * can never disagree: a disagreement is a livelock (a porter lifting a pile whose only sink is out of its
 * area sheds it at its feet and re-lifts it next tick). Memoized per planner call — a scan probes few
 * distinct goods, and the answer is position-stable for the one decision the caller makes this tick.
 *
 * Pass `from` when the good would be lifted out of a known store: a dish leaving the house that produces
 * it is routed as the edible it becomes ({@link exportedGoodForm}), since that is what the carrier will be
 * holding. Without `from` — or from a ground pile, or a store that merely holds the good — the raw form is
 * routed, so a hunter's meat heap still reaches the animal farm that stocks meat. The memo keys on the
 * carried form, so two dishes sharing an edible answer from one routing walk.
 */
export function deliverableGoodProbe(plan: PlannerContext): (goodType: number, from?: Entity) => boolean {
  const memo = new Map<number, boolean>();
  return (rawGoodType: number, from?: Entity): boolean => {
    const goodType = carriedGoodForm(plan.world, plan.ctx, from, rawGoodType);
    // Tick-global cheap precondition first ({@link SinkAvailability}): when no store ANYWHERE could take
    // the good, the full routing walk below is skipped — this keeps a saturated settlement (every store
    // full, every idle hauler re-probing each tick) at ~zero probe cost. It deliberately ignores
    // construction-site sinks, exactly like the pre-confinement gate: builders supply sites through
    // their own fetch rung, so a hauler passing on such a pile matches the long-standing behavior.
    if (!plan.targets.sinks.has(goodType)) return false;
    let known = memo.get(goodType);
    if (known === undefined) {
      known = deliveryTargetFor(plan, goodType) !== null;
      memo.set(goodType, known);
    }
    return known;
  };
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
      (e) => (constructionSiteNeeds(world, ctx, e, tribe, owner, goodType, inbound) ? QUALIFIES : null),
      gate,
    )?.entity ?? null
  );
}

/** Whether construction site `e` (of this settler's `tribe`/`owner` side) still has room for `goodType`
 *  in its bill — the shared accept of the case-4 scan and the bound crew-site (3c) check. Counts both
 *  what the site holds and what other settlers' live supply errands already have inbound (the `inbound`
 *  tally), so a unit already on someone's back stops attracting a duplicate fetch. */
function constructionSiteNeeds(
  world: World,
  ctx: SystemContext,
  e: Entity,
  tribe: number,
  owner: number | undefined,
  goodType: number,
  inbound: InboundSupplyTally,
): boolean {
  if (!world.has(e, UnderConstruction) || !world.has(e, Building)) return false;
  if (world.get(e, Building).tribe !== tribe) return false;
  if (!ownersCompatible(owner, ownerOf(world, e))) return false; // another player's site (same tribe isn't same side)
  const have = (world.get(e, Stockpile).amounts.get(goodType) ?? 0) + inboundSupplyOf(inbound, e, goodType);
  return have < stockCapacity(world, ctx, e, goodType); // room left for this material (and it's a cost good)
}

/**
 * The form `goodType` takes on a settler's back when lifted out of `from` — a dish leaving the house that
 * produces it becomes its edible ({@link exportedGoodForm}); everything else is carried as itself.
 *
 * The producer test is what keeps the conversion meaning "out of the kitchen". `meat` is a dish AND a
 * map-harvested good with its own gathering pipeline: converting it wherever it was found would stop a
 * porter routing a meat heap to `work_animal_farm`, the one store that stocks meat. Shared by the pickup
 * rungs' routing probe and by `pickupFromStore`, so plan and effect never disagree about the load.
 */
export function carriedGoodForm(
  world: World,
  ctx: SystemContext,
  from: Entity | null | undefined,
  goodType: number,
): number {
  if (from === null || from === undefined) return goodType;
  if (!buildingProduces(world, ctx, from).includes(goodType)) return goodType;
  return exportedGoodForm(ctx, goodType);
}
