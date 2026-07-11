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
import { carrierCarryCapacity } from '../progression.js';
import { atomicDuration } from '../readviews/animations.js';
import { manhattan } from '../spatial.js';
import { deliveredConstructionFraction, nextNeededConstructionGood, recipeOf } from '../stores.js';
import { BUILD_HOUSE_ATOMIC_ID, PILEUP_ATOMIC_ID, atOrWalk, startAtomic, startPickup } from './actions.js';
import {
  deliveryTargetFor,
  isPorterBoundToStore,
  nearestGroundPile,
  nearestMissingInputSource,
  workplaceOutputToHaul,
  workplaceProductiveIfStaffed,
} from './ai-supply.js';
import {
  type TargetCandidates,
  interactionCell,
  jobAtomics,
  nearestCollectablePileFor,
  nearestConstructionSite,
  nearestFreeYardNode,
  nearestHarvestableFor,
  nearestOwnDropFor,
  nearestStoreHolding,
  nearestWorkplaceOutput,
} from './ai-targets.js';
import { type SpacingState, claimWorkCell } from './destack.js';

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
 * Returns true even when there is nowhere to deposit: a settler bound to a built workplace walks home
 * and waits INSIDE it holding the load (the {@link Resting} marker — the render hides it, so no frozen
 * carry pose at the door), re-emerging to deposit the moment any sink frees room (the replan sweep
 * clears the marker every tick); an unbound hauler stands where it is. Either way the settler never
 * falls through to empty-handed work.
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
    // Nowhere can take the load — wait INSIDE the bound workplace with it (the farmer rung's own
    // rest-inside seam) instead of standing frozen mid-carry at the door; an unbound hauler has no
    // house to wait in and just stands. Hands stay full either way. Only a COMPLETED building can be
    // waited in (no UnderConstruction) — the render hides a Resting settler, and vanishing "inside" a
    // bare foundation would read as a despawn.
    const home = world.tryGet(e, JobAssignment)?.workplace;
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

/**
 * 2. PRODUCER — the self-service loop for a settler bound to a recipe workshop `workplace`; the
 * behavior behind "kowal fetches the goods a sword needs, forges it, and carries it back". In priority:
 *
 *  a. **Stay & produce** — if staying on the station would run a cycle ({@link workplaceProductiveIfStaffed}:
 *     already producing, or built with all inputs present + output room), walk to the station (if not on
 *     it) and hold there so the ProductionSystem's worker-presence gate stays satisfied.
 *  b. **Haul the output** — else, if the shop holds a finished output a store can take, carry it out
 *     (clears the shop for the next cycle and delivers the product). The carrying branch routes it to a
 *     store, not back to the shop.
 *  c. **Fetch an input** — else, fetch a missing recipe input from a store that holds it (the smith
 *     walking to the warehouse for iron); the carrying branch then delivers it to this workshop.
 *  d. **Wait** — nothing to fetch or haul: return to / hold the station until an input arrives.
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
): void {
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return; // guarded by the caller, but keep the types honest

  // a. Would staying produce a cycle? Be on the station (walk there / hold) so production runs.
  if (workplaceProductiveIfStaffed(world, ctx, workplace, recipe)) {
    walkToOrHold(world, e, here, interactionCell(world, ctx, terrain, workplace, here));
    return;
  }

  // b. Can't produce now — carry the finished output out to a store first (frees the shop, delivers it).
  const outGood = workplaceOutputToHaul(stockpiles, world, ctx, terrain, workplace, recipe, here);
  if (outGood !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, workplace, here), () =>
      startPickup(
        world,
        ctx,
        e,
        settler,
        workplace,
        outGood,
        carrierCarryCapacity(world, ctx, settler.tribe),
      ),
    );
    return;
  }

  // c. Fetch a missing recipe input from a store that holds it (the smith going to the warehouse).
  const src = nearestMissingInputSource(stockpiles, world, ctx, terrain, here, workplace, recipe);
  if (src !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src.store, here), () =>
      startPickup(world, ctx, e, settler, src.store, src.goodType, src.amount),
    );
    return;
  }

  // d. Nothing to fetch or haul — return to / hold the station and wait for an input to arrive.
  walkToOrHold(world, e, here, interactionCell(world, ctx, terrain, workplace, here));
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
 * 4. PORTER — a settler bound to a storage fixture (no recipe) collects the nearest loose ground
 * pile and carries it to its warehouse (the delivery drive then routes the load there). This is
 * the "tragarz" who ferries goods gatherers drop at a flag into the store they belong to.
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
 * 5. CARRIER FALLBACK — with nothing to harvest, produce, or collect, act as a carrier: haul a
 * finished workplace output to a store (so a producing workshop doesn't clog and goods reach the
 * settlement's stores). Nearest workplace with a haulable output it can deliver somewhere.
 * `anyHaulable` is the planner's per-tick dormancy gate — when nothing is haulable anywhere the
 * per-settler scan is provably null and skipped. Returns false when there is nothing to haul (the
 * settler is genuinely idle — the caller de-stacks it).
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
