import { SiteAssignment, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { deliveredConstructionFraction } from '../../../stores/index.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, jobCanBuild, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { nearestConstructionSite, unreachableSiteStand } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { claimWorkCell } from '../spacing.js';
import { boundConstructionSite } from './site-staff.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * BUILD - a builder raises a construction site of its tribe: hammer while delivered material is left to
 * install, else fetch a still-needed good from any bill line, else wait at the site rather than haul for
 * someone else. The site is the player-pinned one, then the foundation this builder is posted to, else the
 * nearest, stamped as persistent crew membership.
 *
 * Only the site's lead (lowest-id) builder is pinned to the hammer, so the rest peel off to pre-fetch and
 * exactly as many builders fetch as there are still-uncovered material units.
 */
export function planBuilder(plan: PlannerContext, spacing: PlannerSpacing, leads: SiteLeads): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!jobCanBuild(ctx.content, settler.jobType)) {
    world.remove(e, SiteAssignment); // no longer the builder trade, so crew membership is stale
    return false;
  }
  const assigned = world.tryGet(e, SiteAssignment);
  const pinned =
    assigned?.pinned === true && world.has(assigned.site, UnderConstruction) ? assigned.site : null;
  const site =
    pinned ??
    boundConstructionSite(plan) ??
    nearestConstructionSite(
      targets.constructionSiteCells,
      world,
      here,
      settler.tribe,
      settler.owner,
      plan.limit ?? undefined,
      unreachableSiteStand(
        world,
        ctx,
        terrain,
        targets.yard.blocked,
        here,
        unreachableGoalVeto(world, ctx, e),
      ),
    );
  if (site === null) {
    world.remove(e, SiteAssignment);
    return false;
  }
  if (assigned === undefined || assigned.site !== site || assigned.pinned !== (pinned !== null)) {
    world.add(e, SiteAssignment, { site, pinned: pinned !== null });
  }
  const siteStand = (): NodeId | null => claimWorkCell(world, terrain, e, here, site, spacing);
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

  if (world.get(site, UnderConstruction).labor < deliveredConstructionFraction(world, ctx, site)) {
    const isLead = leads.of(site) === e;
    if (!isLead && fetchNeededMaterial(plan, site)) return true;
    hammer();
    return true;
  }

  if (fetchNeededMaterial(plan, site)) return true;

  // Nothing to install and nothing to fetch: wait at the site for a delivery.
  const stand = siteStand();
  if (stand !== null) atOrWalk(world, e, here, stand, () => {});
  return true;
}

/**
 * Each construction site's lead builder, keyed by site and built on the first builder that asks, so a tick
 * with no construction pays nothing.
 */
export class SiteLeads {
  private leadBySite: Map<Entity, Entity> | undefined;
  constructor(private readonly world: World) {}

  /** The site's lead builder, or the site itself when no builder is assigned to it. */
  of(site: Entity): Entity {
    let leads = this.leadBySite;
    if (leads === undefined) {
      leads = new Map<Entity, Entity>();
      for (const member of this.world.query(SiteAssignment)) {
        const memberSite = this.world.get(member, SiteAssignment).site;
        const lead = leads.get(memberSite);
        if (lead === undefined || member < lead) leads.set(memberSite, member);
      }
      this.leadBySite = leads;
    }
    return leads.get(site) ?? site;
  }
}
