import { CARRY_CAPACITY, SiteAssignment, UnderConstruction } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { atomicDuration } from '../../readviews/animations.js';
import {
  deliveredConstructionFraction,
  neededConstructionGoods,
  stampSupplyRun,
} from '../../stores/index.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, startAtomic, startPickup } from '../actions.js';
import { claimWorkCell, type SpacingState } from '../destack.js';
import type { PlannerContext } from '../planner-context.js';
import {
  interactionCell,
  jobAtomics,
  nearestConstructionSite,
  nearestStoreHolding,
} from '../targets/index.js';

/**
 * 2b. BUILD — a builder raises a construction site of its tribe, faithful to the original's "settlers search
 * for a foundation, get put on it, and hammer it up carrying material" flow. A builder is any job the data
 * permits to run the build-house atomic ({@link BUILD_HOUSE_ATOMIC_ID}) — the data-driven "who constructs"
 * test, not a hardcoded jobType id — so a non-builder returns false at once and falls through to the
 * gather/porter/carrier rungs. The site is the player-pinned one when an `assignBuilder` right-click bound it
 * (while it still stands), else the nearest; the pick is stamped as a persistent {@link SiteAssignment} (the
 * crew the site's workers window lists). In priority:
 *
 *  a. **Hammer** — while the site has material on hand to install (its builder-work `labor` still trails the
 *     delivered-material fraction), walk to the site and run a `construct` swing (each swing installs one
 *     delivered unit — the ConstructionSystem reflects it into `built`/`Health`). To overlap fetching with
 *     hammering, only the site's LEAD (lowest-id) builder is pinned to the hammer here: every other crew
 *     member first tries the self-supply rung (b) and hammers only if nothing is left to fetch. Each fetch
 *     stamps a SupplyRun that shrinks the remaining need down the canonical crew order, so exactly as many
 *     builders peel off to fetch as there are still-uncovered units (one short material → one fetcher, the
 *     rest keep hammering) instead of the whole crew hammering to the cap and then stalling on one trip.
 *  b. **Self-supply** — the site has run dry (labor caught up to delivered material), or this non-lead builder
 *     is peeling off to pre-fetch: fetch a still-needed construction good from a store that holds it — any
 *     available bill line, not in bill order, so one scarce material never blocks the others. The delivery
 *     drive then routes the load to the site (which advertises the demand), while an assigned hauler tops the
 *     same site up through the identical path.
 *  c. **Wait** — nothing to install and nothing to fetch (no source holds any needed good): hold at the site
 *     until a hauler delivers. A builder is committed to its site — it does not fall through to haul someone
 *     else's goods while a foundation of its own stands unraised.
 *
 * The hammer and wait stands go through {@link claimWorkCell}: a crew spreads over the site's legal
 * perimeter instead of stacking on its finished-building interaction cell — body collision can't do it
 * (civilians are deliberate pass-through, and standing units are never displaced; see the destack module doc).
 *
 * Sits below the bound-producer loop and above gather/porter/carrier, so a builder builds before it ferries.
 * `jobType` is non-null here.
 */
export function planBuilder(plan: PlannerContext, spacing: SpacingState): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!jobAtomics(ctx, settler.jobType).has(BUILD_HOUSE_ATOMIC_ID)) {
    world.remove(e, SiteAssignment); // no longer the builder trade — any crew membership is stale
    return false; // not a builder
  }
  // A player-pinned site (the assignBuilder right-click) wins while it still stands; otherwise the nearest.
  // Either way the pick is stamped as SiteAssignment — persistent crew membership, so the workers window lists
  // this builder even while it waits for material or walks a player detour.
  const assigned = world.tryGet(e, SiteAssignment);
  const pinned =
    assigned?.pinned === true && world.has(assigned.site, UnderConstruction) ? assigned.site : null;
  const site =
    pinned ??
    nearestConstructionSite(
      targets.constructionSiteCells,
      world,
      here,
      settler.tribe,
      settler.owner,
      plan.limit ?? undefined,
    );
  if (site === null) {
    world.remove(e, SiteAssignment); // nothing under construction — the crew disbands
    return false; // fall through to hauling
  }
  if (assigned === undefined || assigned.site !== site || assigned.pinned !== (pinned !== null)) {
    world.add(e, SiteAssignment, { site, pinned: pinned !== null });
  }
  const siteStand = (): NodeId | null => claimWorkCell(world, ctx, terrain, e, here, site, spacing);
  const hammer = (): void => {
    const stand = siteStand();
    if (stand !== null) {
      atOrWalk(world, e, here, stand, () =>
        startAtomic(
          world,
          e,
          BUILD_HOUSE_ATOMIC_ID,
          { kind: 'construct', site },
          atomicDuration(ctx.content, settler, BUILD_HOUSE_ATOMIC_ID),
          site,
        ),
      );
    }
  };

  // a. Material on hand to install (builder work still trails delivered material)? The lead builder hammers;
  // any other crew member pre-fetches a still-missing material first so the deficit closes in parallel with
  // the hammering, and hammers only if nothing is left to fetch.
  if (world.get(site, UnderConstruction).labor < deliveredConstructionFraction(world, ctx, site)) {
    const isLead = constructionSiteLead(world, spacing, site) === e;
    if (!isLead && fetchNeededMaterial(plan, site)) return true;
    hammer();
    return true;
  }

  // b. Out of material — fetch a still-needed construction good from a store that holds it.
  if (fetchNeededMaterial(plan, site)) return true;

  // c. Can't hammer, nothing to fetch — hold at the site and wait for a delivery (empty callback: a
  // MoveGoal to the stand cell, or stay put if already there).
  const stand = siteStand();
  if (stand !== null) atOrWalk(world, e, here, stand, () => {});
  return true;
}

/**
 * Fetch one still-needed construction good for `site` from a store that holds it, routing the pickup so the
 * delivery drive carries the load back to the site (which advertises the demand). Tries the least-covered
 * material first but falls through the whole bill: the goods need not arrive in bill order, so a good with no
 * source anywhere never blocks fetching the ones that are available (the site accumulates what it can and
 * waits for the scarce good). One unit per trip (the global {@link CARRY_CAPACITY}). The needs already
 * discount other settlers' live supply errands (SupplyRun), and this fetch stamps its own — so a crew spreads
 * over the still-unclaimed materials instead of racing to the same unit. Returns whether a fetch was started.
 */
function fetchNeededMaterial(plan: PlannerContext, site: Entity): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  for (const need of neededConstructionGoods(world, ctx, site, plan.inbound)) {
    const src = nearestStoreHolding(
      targets.stockpileCells,
      world,
      here,
      need.goodType,
      plan.limit ?? undefined,
    );
    if (src == null) continue; // no store holds this material — try the next bill line
    const batch = Math.min(need.amount, CARRY_CAPACITY);
    stampSupplyRun(world, e, plan.inbound, { site, goodType: need.goodType, amount: batch });
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src, here), () =>
      startPickup(world, ctx, e, settler, src, need.goodType, batch),
    );
    return true;
  }
  return false;
}

/**
 * The site's LEAD builder — the lowest-id settler currently assigned to `site` ({@link SiteAssignment}) — the
 * one crew member kept on the hammer while others peel off to pre-fetch, so a manned site is never left with
 * nobody hammering. Memoised once per planner tick into {@link SpacingState}: a single pass over the crew
 * assignments captures the lead per site, a frozen snapshot every builder reads the same, so the pick is
 * stable across the tick and history-independent. Falls back to the site itself when no lead is recorded
 * (unreachable in practice — the caller has just stamped its own SiteAssignment).
 */
function constructionSiteLead(world: World, spacing: SpacingState, site: Entity): Entity {
  let leads = spacing.crewLeadBySite;
  if (leads === undefined) {
    leads = new Map<Entity, Entity>();
    for (const member of world.query(SiteAssignment)) {
      const memberSite = world.get(member, SiteAssignment).site;
      const lead = leads.get(memberSite);
      if (lead === undefined || member < lead) leads.set(memberSite, member);
    }
    spacing.crewLeadBySite = leads;
  }
  return leads.get(site) ?? site;
}
