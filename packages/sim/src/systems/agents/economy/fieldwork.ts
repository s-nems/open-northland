import { Position, Resource, UnderConstruction, WorkFlag } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { carrierCarryCapacity } from '../../progression/index.js';
import { atomicDuration } from '../../readviews/animations.js';
import { deliveredConstructionFraction, nextNeededConstructionGood } from '../../stores/index.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, startAtomic, startPickup } from '../actions.js';
import { claimWorkCell, type SpacingState } from '../destack.js';
import type { PlannerContext } from '../planner-context.js';
import {
  interactionCell,
  jobAtomics,
  nearestCollectablePileFor,
  nearestConstructionSite,
  nearestHarvestableFor,
  nearestOwnDropFor,
  nearestStoreHolding,
} from '../targets/index.js';
import { deliveryTargetFor } from './routing.js';

// The ECONOMY drives — the work rungs of the planner ladder, in the ladder's priority order:
// deliver a carried load, run a bound producer's supply→produce→deliver loop, gather (chop/collect),
// ferry as a bound porter, haul as the carrier fallback. planGatherer/planPorter/planCarrierHaul
// return `true` when they acted (the settler is spoken for this tick) and `false` to let the next
// rung try; planDelivery and planProducer ALWAYS own their settler once entered (a loaded / bound
// settler never falls through to a lower rung), so their result carries no information.

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
export function planBuilder(plan: PlannerContext, spacing: SpacingState): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
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

  // c. Can't hammer, nothing to fetch — hold at the site and wait for a delivery (empty callback: a
  // MoveGoal to the stand cell, or stay put if already there).
  atOrWalk(world, e, here, siteStand(), () => {});
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
export function planGatherer(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  const flag = world.tryGet(e, WorkFlag);
  // A live flag binding switches on the bounded collector behaviour; a stale binding (the flag was removed)
  // falls back to roaming so the gatherer is never stranded pointing at a gone flag.
  if (flag !== undefined && world.has(flag.flag, Position)) {
    return planFlagGatherer(plan, flag);
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
  const nodeDist = node !== null ? node.dist : Number.POSITIVE_INFINITY;
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
    const res = world.get(node.entity, Resource);
    atOrWalk(world, e, here, node.cell, () =>
      startAtomic(
        world,
        e,
        res.harvestAtomic,
        { kind: 'harvest', resource: node.entity, goodType: res.goodType },
        atomicDuration(ctx.content, settler, res.harvestAtomic),
        node.entity,
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
function planFlagGatherer(plan: PlannerContext, flag: { flag: Entity; radius: number }): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
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
    const res = world.get(node.entity, Resource);
    atOrWalk(world, e, here, node.cell, () =>
      startAtomic(
        world,
        e,
        res.harvestAtomic,
        { kind: 'harvest', resource: node.entity, goodType: res.goodType },
        atomicDuration(ctx.content, settler, res.harvestAtomic),
        node.entity,
      ),
    );
    return true;
  }

  // 3. Nothing to dig and nothing of its own to carry — stand idle beside the flag.
  atOrWalk(world, e, here, flagCell, () => {});
  return true;
}
