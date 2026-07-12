import {
  Building,
  DeliveryFlag,
  JobAssignment,
  Position,
  Resource,
  Resting,
  UnderConstruction,
  WorkFlag,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { farmWorkGood } from '../economy/farming.js';
import { carrierCarryCapacity } from '../progression.js';
import { atomicDuration } from '../readviews/animations.js';
import { manhattan } from '../spatial.js';
import {
  deliveredConstructionFraction,
  isCarrierJob,
  nextNeededConstructionGood,
  recipeOf,
} from '../stores.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, PILEUP_ATOMIC_ID, startAtomic, startPickup } from './actions.js';
import {
  boundProducerOutputToHaul,
  deliveryTargetFor,
  isPorterBoundToStore,
  nearestGroundPile,
  nearestMissingInputSource,
  workplaceOutputToHaul,
  workSeatCount,
} from './ai-supply.js';
import {
  interactionCell,
  jobAtomics,
  nearestCollectablePileFor,
  nearestConstructionSite,
  nearestFreeYardNode,
  nearestHarvestableFor,
  nearestOwnDropFor,
  nearestStoreHolding,
  nearestWorkplaceOutput,
  type TargetCandidates,
} from './ai-targets.js';
import { claimWorkCell, type SpacingState } from './destack.js';
import { dropCarryAtOwnTile } from './effects-goods.js';

// The ECONOMY drives — the work rungs of the planner ladder, in the ladder's priority order:
// deliver a carried load, run a bound producer's supply→produce→deliver loop, gather (chop/collect),
// ferry as a bound porter, haul as the carrier fallback. planGatherer/planPorter/planCarrierHaul
// return `true` when they acted (the settler is spoken for this tick) and `false` to let the next
// rung try; planDelivery and planProducer ALWAYS own their settler once entered (a loaded / bound
// settler never falls through to a lower rung), so their result carries no information.

/** The settler-shape the drives read: the trade + tribe an action is keyed by. `jobType` is
 *  non-null by construction — the planner ladder skips jobless settlers before any economy rung. */
interface Worker {
  readonly tribe: number;
  readonly jobType: number;
}

/**
 * 1. CARRYING — deposit the load where it belongs. {@link deliveryTargetFor} routes it: a fetched
 * recipe input to the bound workshop that consumes it, a harvested/collected good to the settler's
 * bound store (a warehouse, or a flag pile), else the nearest capable store (the unchanged default
 * for an unbound hauler — the vertical-slice woodcutter/carrier route exactly as before). A carrying
 * settler always delivers first (it must free its hands before it can staff, harvest, or fetch).
 * Returns true even when there is nowhere to deposit. What the holder does then depends on WHO it is:
 * a PORTER bound to a passive warehouse SHEDS the undepositable load on the ground (freeing it to haul a
 * deliverable good instead of holding a surplus forever — see the store-full branch); a settler bound to a
 * producing workplace (a farm's field loop / a workshop's recipe) instead waits INSIDE it holding the load
 * (the {@link Resting} marker — the render hides it), re-emerging to deposit the moment its own store frees
 * room; an unbound hauler stands where it is. Either way the settler never falls through to empty-handed work.
 */
export function planDelivery(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  load: { goodType: number; amount: number },
  targets: TargetCandidates,
): boolean {
  const store = deliveryTargetFor(
    targets.stockpiles,
    targets.constructionSites,
    world,
    ctx,
    terrain,
    here,
    e,
    settler.jobType,
    settler.tribe,
    load.goodType,
  );
  if (store === null) {
    const home = world.tryGet(e, JobAssignment)?.workplace;
    // A PORTER bound to a PASSIVE warehouse (not a farm/producer — those wait for their OWN store's field
    // loop / recipe to free room) sheds a surplus it can't deposit anywhere: it sets the load down where it
    // stands and is free to haul a DELIVERABLE good next tick, instead of holding an undepositable load
    // forever ("the store is full of wood → stop hauling wood, fetch something else"). The deliverability
    // gate in `nearestGroundPile` then keeps it from re-lifting that same full good, so the shed surplus
    // just rests on the ground until the store has room again — no pick-up/put-down loop. A drop onto a full
    // tile places nothing → the load stays and it falls through to wait inside.
    if (
      home !== undefined &&
      isPorterBoundToStore(world, ctx, e) &&
      farmWorkGood(world, ctx, home) === null &&
      dropCarryAtOwnTile(world, e) > 0
    ) {
      return true;
    }
    // Nowhere can take the load — wait INSIDE the bound workplace with it (the farmer rung's own
    // rest-inside seam) instead of standing frozen mid-carry at the door; an unbound hauler has no
    // house to wait in and just stands. Hands stay full either way. Only a COMPLETED building can be
    // waited in (no UnderConstruction) — the render hides a Resting settler, and vanishing "inside" a
    // bare foundation would read as a despawn.
    if (
      home !== undefined &&
      world.has(home, Building) &&
      !world.has(home, UnderConstruction) &&
      world.has(home, Position)
    ) {
      atOrWalk(world, e, here, interactionCell(world, ctx, terrain, home, here), () =>
        world.add(e, Resting, { at: home }),
      );
    }
    return true;
  }
  // A delivery FLAG is a marker, not a sink: walk to the nearest free YARD tile around it and set the load
  // down THERE (so the goods land where the gatherer stands — it physically carries any spill to the next
  // free tile, nothing teleports). Every other store is deposited into from its interaction cell as before.
  const cell = world.has(store, DeliveryFlag)
    ? nearestFreeYardNode(targets.stockpiles, world, terrain, store, load.goodType)
    : interactionCell(world, ctx, terrain, store, here);
  atOrWalk(world, e, here, cell, () =>
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store },
      atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID),
      store,
    ),
  );
  return true;
}

/** Per-tick tally of the work seats already claimed at each workplace — created fresh by the
 *  planner every tick and handed to each {@link planProducer} call in settler order, so two
 *  operators of one workshop never both latch onto the same batch (see {@link workSeatCount}). */
export type WorkSeatClaims = Map<Entity, number>;

/**
 * 2. PRODUCER — the self-service loop for a settler bound to a recipe workshop `workplace`; the
 * behavior behind "kowal fetches the goods a sword needs, forges it, and carries it back". In priority:
 *
 *  a. **Claim a work seat & produce** — the workplace offers one seat per batch that would run if
 *     staffed ({@link workSeatCount}: cycles already grinding + cycles the stock could start), and
 *     `seatClaims` hands them out in the planner's deterministic settler order. A worker with a seat
 *     walks to the station (if not on it) and holds there so the ProductionSystem's worker-presence
 *     gate stays satisfied; on the station it steps INSIDE (the {@link Resting} marker — the render
 *     hides it): a craftsman works in its workshop, not standing at the door (observed original
 *     behaviour). A worker who finds every seat taken is SURPLUS — its own batch is done or can't
 *     start — and falls through to the transport branches instead of idling inside while a
 *     colleague's batch finishes.
 *  b. **Fetch an input** — else, fetch a missing recipe input from a store that holds it (the smith
 *     walking to the warehouse for iron); the carrying branch then delivers it to this workshop.
 *     Fetching ranks ABOVE hauling the output out: finished goods accumulate in the shop's own store
 *     while the loop runs, and are carried out only when production can't continue — typically when the
 *     output store fills (observed original behaviour: the miller keeps grinding, flour banks up in the
 *     mill, and only a full mill sends it to the warehouse to make room). A craftsman fetches even when
 *     a carrier is bound: a starved mill takes wheat from whoever gets there first ("jak nie ma, to
 *     idzie po nie sam") — the pickup caps to what the source holds, so racing the carrier is harmless.
 *  c. **Haul the output** — else, if the shop holds a finished output a store can take, carry it out
 *     (an output-full shop makes room for the next cycle; an input-starved one banks its product). The
 *     carrying branch routes it to a store, not back to the shop. SKIPPED when `carrierSupplied` (the
 *     workplace has a bound carrier — {@link
 *     import('./ai-targets.js').TargetCandidates.carrierSuppliedWorkplaces}): carrying the product out
 *     is the carrier's whole job ({@link planWorkshopSupplier}), and unlike a starved input it never
 *     blocks the craft immediately — the craftsman stays near its seat.
 *  d. **Wait** — nothing to fetch or haul: return to / hold the station until an input arrives, waiting
 *     INSIDE it (the same {@link Resting} marker — off-duty workers wait in the house).
 *
 * Every branch is recipe-driven — no per-job or per-good code — so any single-worker workshop self-
 * services. The workplace is known to carry a recipe (the caller's `boundWorkplaceTarget` guard).
 */
export function planProducer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  workplace: Entity,
  stockpiles: readonly Entity[],
  seatClaims: WorkSeatClaims,
  carrierSupplied: boolean,
): void {
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return; // guarded by the caller, but keep the types honest

  // a. A batch for THIS worker to run or start? Claim the seat and be on the station.
  const claimed = seatClaims.get(workplace) ?? 0;
  if (claimed < workSeatCount(world, ctx, workplace, recipe)) {
    seatClaims.set(workplace, claimed + 1);
    holdInsideWorkplace(world, ctx, terrain, e, here, workplace);
    return;
  }

  // b. No seat — fetch a missing recipe input from a store that holds it (the smith going to the
  // warehouse). The finished output stays banked in the shop while inputs keep the loop running.
  const src = nearestMissingInputSource(stockpiles, world, ctx, terrain, here, workplace, recipe);
  if (src !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src.store, here), () =>
      startPickup(world, ctx, e, settler, src.store, src.goodType, src.amount),
    );
    return;
  }

  // c. Nothing to fetch — carry the finished output out to a store (an output-full shop frees room
  // for the next cycle; an input-starved one delivers what it made). Skipped when the bound carrier
  // owns the output run.
  if (
    !carrierSupplied &&
    haulWorkplaceOutput(world, ctx, terrain, e, settler, here, workplace, recipe, stockpiles)
  ) {
    return;
  }

  // d. Nothing to fetch or haul (or the bound carrier owns the output run) — return to / wait inside
  // the station for an input to arrive.
  holdInsideWorkplace(world, ctx, terrain, e, here, workplace);
}

/** Walk to the workplace's interaction tile and, once ON it, step INSIDE (the {@link Resting} marker
 *  — the render hides it; the replan sweep clears it every tick, so the worker re-emerges the moment
 *  real work appears). The stand shared by the producer's a/d branches and the supplier's wait. */
function holdInsideWorkplace(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  workplace: Entity,
): void {
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    world.add(e, Resting, { at: workplace }),
  );
}

/** Start carrying a finished output of `workplace` out to a store that can take it (one carry-load),
 *  or return false when no output is deliverable. The haul branch the producer (no carrier bound)
 *  and the workshop supplier share. */
function haulWorkplaceOutput(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  workplace: Entity,
  recipe: NonNullable<ReturnType<typeof recipeOf>>,
  stockpiles: readonly Entity[],
): boolean {
  const outGood = workplaceOutputToHaul(stockpiles, world, ctx, terrain, workplace, recipe, here);
  if (outGood === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    startPickup(world, ctx, e, settler, workplace, outGood, carrierCarryCapacity(world, ctx, settler.tribe)),
  );
  return true;
}

/**
 * 2a-bis. WORKSHOP SUPPLIER — a **carrier** bound to a recipe workshop ("tragarz w młynie"): it never
 * operates the craft (it neither runs nor speeds production — see `presentOperatorCount`), it FERRIES.
 * In priority:
 *
 *  a. **Top up the inputs** — fetch a recipe input the workplace's input slot isn't full of, from any
 *     store/pile that holds it ({@link nearestMissingInputSource} with `restockToCapacity`: the target
 *     is the slot's CAPACITY, not one cycle's worth — the carrier keeps the mill's wheat store filled
 *     trip after trip so the millers inside never starve). Feeding the craft outranks clearing it:
 *     an input-starved workshop makes nothing at all.
 *  b. **Carry the output out** — else, haul a finished output to a store that can take it (the flour
 *     to the warehouse) — continuously, not only when the shop is full: hauling IS this settler's
 *     craft, and the shop's output slot stays clear for the operators.
 *  c. **Wait inside** — nothing to ferry either way: wait in the workshop (the {@link Resting}
 *     marker) until goods appear, like every off-duty worker.
 *
 * Observed original behaviour (the carrier ferries, the craftsman crafts); the exact original trip
 * scheduling isn't decoded, so the fetch-before-haul priority is a named approximation.
 */
export function planWorkshopSupplier(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  workplace: Entity,
  stockpiles: readonly Entity[],
): void {
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return; // guarded by the caller, but keep the types honest

  // a. Keep the input slots topped up toward their capacity (one carry-load per trip).
  const RESTOCK_TO_CAPACITY = true; // the carrier's fetch target: the slot's capacity, not one cycle
  const src = nearestMissingInputSource(
    stockpiles,
    world,
    ctx,
    terrain,
    here,
    workplace,
    recipe,
    RESTOCK_TO_CAPACITY,
  );
  if (src !== null) {
    const batch = Math.min(src.amount, carrierCarryCapacity(world, ctx, settler.tribe));
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src.store, here), () =>
      startPickup(world, ctx, e, settler, src.store, src.goodType, batch),
    );
    return;
  }

  // b. Inputs are covered — carry a finished output out to a store that can take it.
  if (haulWorkplaceOutput(world, ctx, terrain, e, settler, here, workplace, recipe, stockpiles)) return;

  // c. Nothing to ferry — wait inside the workshop until goods appear.
  holdInsideWorkplace(world, ctx, terrain, e, here, workplace);
}

/** Set a `MoveGoal` to `target` unless the settler is already on it (then it stays put). */
function walkToOrHold(world: World, e: Entity, here: NodeId, target: NodeId): void {
  atOrWalk(world, e, here, target, () => {});
}

/**
 * 2b. BUILD — a **builder** raises the nearest construction site of its tribe, faithful to the original's
 * "settlers search for a foundation, get put on it, and hammer it up carrying material" flow. A builder is
 * any job the data permits to run the build-house atomic ({@link BUILD_HOUSE_ATOMIC_ID}) — the data-driven
 * "who constructs" test, not a hardcoded jobType id — so a non-builder returns false at once and falls
 * through to the gather/porter/carrier rungs. In priority:
 *
 *  a. **Hammer** — while the site has material on hand to install (its builder-work `labor` still trails
 *     the delivered-material fraction), walk to the site and run a `construct` swing (each swing installs
 *     one delivered unit — the ConstructionSystem reflects it into `built`/`Health`).
 *  b. **Self-supply** — the site has run dry (labor caught up to delivered material): fetch a still-needed
 *     construction good from a store that holds it. The delivery drive then routes the load to the site
 *     (which advertises the demand) — "budowniczy sam zanosi surowce", while an assigned hauler tops the
 *     same site up through the identical path.
 *  c. **Wait** — nothing to install and nothing to fetch (no source holds a needed good): hold at the site
 *     until a hauler delivers. A builder is committed to its site — it does not fall through to haul
 *     someone else's goods while a foundation of its own stands unraised.
 *
 * The hammer and wait stands go through {@link claimWorkCell}: a crew on one site spreads over the
 * site's yard instead of stacking on its one interaction cell — body collision can't do it (civilians
 * are deliberate pass-through, and standing units are never displaced; see the destack module doc).
 *
 * Sits below the bound-producer loop (a builder is not bound to a recipe workshop, so that rung passes it)
 * and above gather/porter/carrier, so a builder builds before it ferries. `jobType` is non-null here.
 */
export function planBuilder(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  targets: TargetCandidates,
  spacing: SpacingState,
): boolean {
  if (!jobAtomics(ctx, settler.jobType).has(BUILD_HOUSE_ATOMIC_ID)) return false; // not a builder
  const site = nearestConstructionSite(targets.constructionSites, world, ctx, terrain, here, settler.tribe);
  if (site === null) return false; // nothing under construction — fall through to hauling
  const siteStand = (): NodeId =>
    claimWorkCell(world, ctx, terrain, e, here, interactionCell(world, ctx, terrain, site, here), spacing);

  // a. Material on hand to install? Hammer only while builder work trails delivered material.
  if (world.get(site, UnderConstruction).labor < deliveredConstructionFraction(world, ctx, site)) {
    atOrWalk(world, e, here, siteStand(), () =>
      startAtomic(
        world,
        e,
        BUILD_HOUSE_ATOMIC_ID,
        { kind: 'construct', site },
        atomicDuration(ctx.content, settler, BUILD_HOUSE_ATOMIC_ID),
        site,
      ),
    );
    return true;
  }

  // b. Out of material — fetch a still-needed construction good from a store that holds it (the delivery
  // drive routes the load back to the site next tick). Lift a batch bounded by the tribe's carry
  // capacity (one unit on foot), capped again by `pickupFromStore` to what the source actually holds.
  const need = nextNeededConstructionGood(world, ctx, site);
  const src = need && nearestStoreHolding(targets.stockpiles, world, ctx, terrain, here, need.goodType);
  if (need !== null && src != null) {
    const batch = Math.min(need.amount, carrierCarryCapacity(world, ctx, settler.tribe));
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src, here), () =>
      startPickup(world, ctx, e, settler, src, need.goodType, batch),
    );
    return true;
  }

  // c. Can't hammer, nothing to fetch — hold at the site and wait for a delivery.
  walkToOrHold(world, e, here, siteStand());
  return true;
}

/**
 * 3. HARVEST / COLLECT — the gatherer drive, in two shapes:
 *
 *  - **Flag-bound** (carries a {@link WorkFlag}): the user-specified collector — it works ONLY the nodes
 *    within its flag's radius, carries off ONLY the trunks/ore it dug itself, delivers to its own flag, and
 *    stands idle beside the flag when nothing is in reach ({@link planFlagGatherer}). It always owns the
 *    tick (returns true), so it never ferries other settlers' goods or de-stacks off its post.
 *  - **Unbound roaming** (no WorkFlag — the golden slice's woodcutter, unchanged): CHOPS the nearest
 *    standing resource its job may harvest OR carries off the nearest loose trunk of that trade, whichever
 *    is nearer, delivering to the nearest capable store. Returns false when nothing is reachable, falling
 *    through to the porter/carrier drives.
 *
 * Harvesting is gated by the job's atomic permissions AND the good's `needforgood` XP threshold; collecting
 * an already-dropped good is hauling, not harvesting. Ordered before the porter/carrier drives so a gatherer
 * works its own resources+trunks before ferrying others'. `jobType` is non-null here.
 */
export function planGatherer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker & { jobType: number; experience: Map<number, number> },
  here: NodeId,
  targets: TargetCandidates,
): boolean {
  const flag = world.tryGet(e, WorkFlag);
  // A live flag binding switches on the bounded collector behaviour; a stale binding (the flag was removed)
  // falls back to roaming so the gatherer is never stranded pointing at a gone flag.
  if (flag !== undefined && world.has(flag.flag, Position)) {
    return planFlagGatherer(world, ctx, terrain, e, settler, here, flag, targets);
  }

  const node = nearestHarvestableFor(targets.resources, world, ctx, terrain, here, settler);
  const trunk = nearestCollectablePileFor(
    targets.groundDrops,
    targets.harvestAtomicByGood,
    world,
    ctx,
    terrain,
    here,
    settler.jobType,
  );
  const nodeDist =
    node !== null
      ? manhattan(terrain, here, interactionCell(world, ctx, terrain, node, here))
      : Number.POSITIVE_INFINITY;
  // Prefer the trunk on a tie (it is the wood already at hand — grab it before a fresh tree).
  if (trunk !== null && trunk.dist <= nodeDist) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, trunk.pile, here), () =>
      startPickup(
        world,
        ctx,
        e,
        settler,
        trunk.pile,
        trunk.goodType,
        carrierCarryCapacity(world, ctx, settler.tribe),
      ),
    );
    return true;
  }
  if (node !== null) {
    const res = world.get(node, Resource);
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, node, here), () =>
      startAtomic(
        world,
        e,
        res.harvestAtomic,
        { kind: 'harvest', resource: node, goodType: res.goodType },
        atomicDuration(ctx.content, settler, res.harvestAtomic),
        node,
      ),
    );
    return true;
  }
  return false;
}

/**
 * The FLAG-BOUND gatherer's decision, in priority order (the user-specified behaviour):
 *
 *  1. **Finish your own drop** — if THIS gatherer has a trunk/ore pile it dug ({@link nearestOwnDropFor},
 *     keyed by {@link HarvestedBy}), carry it off before starting anything new. Clearing its own drop first
 *     keeps it from scattering half-emptied trunks, and it leaves every OTHER loose pile untouched.
 *  2. **Harvest within the flag radius** — else chop/mine the nearest node inside the flag's work area
 *     ({@link nearestHarvestableFor} with the flag as centre); a felled trunk / mined pile becomes an
 *     owned drop that branch 1 then carries home.
 *  3. **Idle by the flag** — nothing in reach: walk to and hold beside the flag (the "stoi bezczynnie obok
 *     flagi" case), rather than roaming or ferrying.
 *
 * Always returns true: a flag-bound gatherer is spoken for every tick (the flag guarantees a fallback
 * target), so it never falls through to the porter / carrier / de-stack rungs. The delivery of a carried
 * load to the flag is the carrying rung's job ({@link deliveryTargetFor} routes a WorkFlag load to its flag).
 */
function planFlagGatherer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker & { jobType: number; experience: Map<number, number> },
  here: NodeId,
  flag: { flag: Entity; radius: number },
  targets: TargetCandidates,
): boolean {
  const flagCell = interactionCell(world, ctx, terrain, flag.flag, here);

  // 1. Carry off a trunk/ore this gatherer dug (only its own — foreign piles are left in peace).
  const own = nearestOwnDropFor(targets.groundDrops, world, ctx, terrain, here, e);
  if (own !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, own.pile, here), () =>
      startPickup(
        world,
        ctx,
        e,
        settler,
        own.pile,
        own.goodType,
        carrierCarryCapacity(world, ctx, settler.tribe),
      ),
    );
    return true;
  }

  // 2. Chop / mine the nearest node within the flag's work radius (nothing beyond it).
  const node = nearestHarvestableFor(targets.resources, world, ctx, terrain, here, settler, {
    center: flagCell,
    radius: flag.radius,
  });
  if (node !== null) {
    const res = world.get(node, Resource);
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, node, here), () =>
      startAtomic(
        world,
        e,
        res.harvestAtomic,
        { kind: 'harvest', resource: node, goodType: res.goodType },
        atomicDuration(ctx.content, settler, res.harvestAtomic),
        node,
      ),
    );
    return true;
  }

  // 3. Nothing to dig and nothing of its own to carry — stand idle beside the flag.
  atOrWalk(world, e, here, flagCell, () => {});
  return true;
}

/**
 * 4. PORTER — a settler bound to a storage fixture (no recipe) that moves loose goods. The full carrier
 * rule ("tragarz"):
 *
 *  - a carrier at a **producing building** (a FARM: no recipe, but produces a field good) HAULS its
 *    finished output OUT to a warehouse ({@link boundProducerOutputToHaul}; the delivery drive then routes
 *    the load to the nearest OTHER store) — "wbity w produkcję ⇒ odnosi do magazynu". Prioritised so the
 *    producer's store keeps clearing to central storage;
 *  - a carrier at ANY bound store (warehouse/HQ, or a farm with nothing to haul out) also BRINGS loose
 *    ground piles IN to it ("przynosi towary"): the counterpart that ferries the goods gatherers drop at a
 *    flag into the store they belong to.
 *
 * A warehouse/HQ carrier only ever reaches the bring-in half (it produces nothing); a production carrier
 * does both, hauling-out first.
 */
export function planPorter(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  targets: TargetCandidates,
): boolean {
  if (!isPorterBoundToStore(world, ctx, e)) return false;
  // Haul the bound producer's finished output OUT to a warehouse (a farm's wheat) — the load then routes
  // to the nearest other store, never back into the producer (deliveryTargetFor case 3).
  const outGood = boundProducerOutputToHaul(targets.stockpiles, world, ctx, terrain, e, settler.tribe, here);
  if (outGood !== null) {
    const home = world.get(e, JobAssignment).workplace;
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, home, here), () =>
      startPickup(world, ctx, e, settler, home, outGood, carrierCarryCapacity(world, ctx, settler.tribe)),
    );
    return true;
  }
  // Otherwise bring a loose ground pile IN to the bound store (the warehouse/HQ porter, unchanged).
  const pile = nearestGroundPile(targets.stockpiles, world, ctx, terrain, here);
  if (pile === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, pile.pile, here), () =>
    startPickup(
      world,
      ctx,
      e,
      settler,
      pile.pile,
      pile.goodType,
      carrierCarryCapacity(world, ctx, settler.tribe),
    ),
  );
  return true;
}

/**
 * 5. STORE-CARRIER HAUL — an **employed carrier** (the transport trade, bound to a building — in
 * practice a warehouse/HQ transport slot; a workshop-bound carrier never falls this far, rung 2a owns
 * it) hauls a finished workplace output to a store, so producing workshops don't clog and goods reach
 * the settlement's stores; the delivery rung then routes the load to ITS bound store when that store
 * can take it. NOBODY else ferries: a settler of another trade with nothing to do idles, and an
 * unemployed or unbound settler does no work at all — transport is a job one is hired for, never a
 * default pastime (observed original behaviour: "bezrobotny to bezrobotny", a carrier works only
 * through its assignment; the JobSystem's report-in pass is what binds a loose carrier to an open
 * transport slot).
 * `anyHaulable` is the planner's per-tick dormancy gate — when nothing is haulable anywhere the
 * per-settler scan is provably null and skipped. Returns false when this settler may not / need not
 * haul (the caller de-stacks it).
 */
export function planCarrierHaul(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: NodeId,
  targets: TargetCandidates,
  anyHaulable: boolean,
): boolean {
  if (!isCarrierJob(ctx, settler.jobType)) return false; // hauling is the carrier trade's job alone
  if (!world.has(e, JobAssignment)) return false; // an unassigned carrier has no store to work for
  const haul = anyHaulable ? nearestWorkplaceOutput(targets.stockpiles, world, ctx, terrain, here) : null;
  if (haul === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, haul.workplace, here), () =>
    // Lift a batch sized by the tribe's best unlocked vehicle (`stockSlots`), or one unit on foot
    // when no vehicle is available — `pickupFromStore` caps the move to what the source actually holds.
    startPickup(
      world,
      ctx,
      e,
      settler,
      haul.workplace,
      haul.goodType,
      carrierCarryCapacity(world, ctx, settler.tribe),
    ),
  );
  return true;
}
