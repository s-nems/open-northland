import { Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { carrierCarryCapacity } from '../progression.js';
import { atomicDuration } from '../readviews/animations.js';
import { manhattan } from '../spatial.js';
import { recipeOf } from '../stores.js';
import { PILEUP_ATOMIC_ID, atOrWalk, startAtomic, startPickup } from './actions.js';
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
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestWorkplaceOutput,
} from './ai-targets.js';

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
 * Returns true even when there is nowhere to deposit — the settler idles this tick with its hands
 * full (a later slice may wait/drop); it must not fall through to empty-handed work.
 */
export function planDelivery(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker,
  here: CellId,
  load: { goodType: number; amount: number },
  targets: TargetCandidates,
): boolean {
  const store = deliveryTargetFor(
    targets.stockpiles,
    world,
    ctx,
    terrain,
    here,
    e,
    settler.jobType,
    settler.tribe,
    load.goodType,
  );
  if (store === null) return true; // nowhere to deposit — idle this tick, hands stay full
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, store, here), () =>
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
  here: CellId,
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
function walkToOrHold(world: World, e: Entity, here: CellId, target: CellId): void {
  atOrWalk(world, e, here, target, () => {});
}

/**
 * 3. HARVEST / COLLECT — a gatherer either CHOPS the nearest standing resource its job may harvest,
 * or CARRIES OFF the nearest loose trunk of that trade (a felled tree's dropped wood), whichever is
 * nearer. Standing on its own fresh trunk (distance 0) it picks the wood up before walking to the
 * next tree — the original's fell-then-carry collector cadence; on a return trip it takes whichever
 * of {next tree, remaining trunk} is closer. Harvesting is gated by the job's atomic permissions AND
 * the good's `needforgood` XP threshold; collecting an already-dropped good is hauling, not
 * harvesting, so only the job-trade filter applies. Ordered before the porter/carrier drives so a
 * gatherer works its own resources+trunks before ferrying others'. `jobType` is non-null here.
 */
export function planGatherer(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: Worker & { jobType: number; experience: Map<number, number> },
  here: CellId,
  targets: TargetCandidates,
): boolean {
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
  here: CellId,
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
  here: CellId,
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
