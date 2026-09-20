import {
  Building,
  ownerOf,
  ownersCompatible,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, jobCanBuild, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { nearestConstructionSite, unreachableSiteStand } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { claimWorkCell } from '../spacing.js';
import type { ConstructionTaskClaims } from './construction-task-claims.js';
import { boundConstructionSite } from './site-staff.js';
import { fetchNeededMaterial, hasFetchableMaterial } from './site-supply.js';

/**
 * BUILD - keep a useful automatic crew assignment stable, otherwise move the builder to the nearest
 * reachable site with material to fetch or delivered labor to install. Player pins and unfinished
 * workplace bindings are strict: their builders stay with that site even while it waits for material.
 */
export function planBuilder(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!jobCanBuild(ctx.content, settler.jobType)) {
    world.remove(e, SiteAssignment);
    return false;
  }

  const assigned = world.tryGet(e, SiteAssignment);
  const pinned =
    assigned?.pinned === true && world.has(assigned.site, UnderConstruction) ? assigned.site : null;
  const bound = boundConstructionSite(plan);
  const locked = pinned ?? bound;
  if (locked !== null) {
    stampAssignment(plan, locked, pinned !== null);
    if (!workAtSite(plan, spacing, claims, locked)) waitAtSite(plan, spacing, locked);
    return true;
  }

  const avoidSite = unreachableSiteStand(
    world,
    ctx,
    terrain,
    targets.yard.blocked,
    here,
    unreachableGoalVeto(world, ctx, e),
  );
  const isReachable = (site: Entity): boolean =>
    automaticSiteMatches(plan, spacing, site) && avoidSite?.(site) !== true;
  const hasTask = (site: Entity): boolean =>
    isReachable(site) && (claims.hasHammerWork(site) || hasFetchableMaterial(plan, site));

  // Crew membership is sticky while it still has useful work. This avoids re-ranking builders between
  // equally valid sites every time one hammer atomic completes.
  const current = assigned?.pinned === false && hasTask(assigned.site) ? assigned.site : null;
  if (current !== null) {
    stampAssignment(plan, current, false);
    if (workAtSite(plan, spacing, claims, current)) return true;
  }

  const site = nearestConstructionSite(
    targets.constructionSiteCells,
    world,
    here,
    settler.tribe,
    settler.owner,
    plan.limit ?? undefined,
    avoidSite,
    hasTask,
  );
  if (site !== null) {
    stampAssignment(plan, site, false);
    if (workAtSite(plan, spacing, claims, site)) return true;
  }

  // Automatic crew membership represents useful work rather than a parking place. Releasing it here
  // lets surplus builders use the normal idle drives and makes a fresh delivery wake allocation cleanly.
  world.remove(e, SiteAssignment);
  return false;
}

/** Run one useful task, preferring a first real hammer worker, then a missing-material fetch. */
function workAtSite(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  site: Entity,
): boolean {
  if (
    claims.hasHammerWork(site) &&
    !claims.hasHammerClaim(site) &&
    startHammer(plan, spacing, claims, site)
  ) {
    return true;
  }
  if (fetchNeededMaterial(plan, site)) return true;
  return startHammer(plan, spacing, claims, site);
}

function startHammer(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  site: Entity,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  if (!claims.hasHammerWork(site)) return false;
  const stand = claimWorkCell(world, terrain, e, here, site, spacing);
  if (stand === null || !claims.claimHammer(site)) return false;
  atOrWalk(world, e, here, stand, () =>
    startAtomic(
      world,
      e,
      BUILD_HOUSE_ATOMIC_ID,
      { kind: 'construct', site },
      atomicDuration(ctx.content, plan, BUILD_HOUSE_ATOMIC_ID),
      site,
    ),
  );
  return true;
}

function waitAtSite(plan: PlannerContext, spacing: PlannerSpacing, site: Entity): void {
  const { world, terrain, entity: e, here } = plan;
  const stand = claimWorkCell(world, terrain, e, here, site, spacing);
  if (stand !== null) atOrWalk(world, e, here, stand, () => {});
}

function stampAssignment(plan: PlannerContext, site: Entity, pinned: boolean): void {
  const { world, entity: e } = plan;
  const assigned = world.tryGet(e, SiteAssignment);
  if (assigned === undefined || assigned.site !== site || assigned.pinned !== pinned) {
    world.add(e, SiteAssignment, { site, pinned });
  }
}

/** Ownership, confinement and an actual routeable perimeter cell for an automatic assignment. */
function automaticSiteMatches(plan: PlannerContext, spacing: PlannerSpacing, site: Entity): boolean {
  const { world, terrain, here } = plan;
  if (!world.has(site, UnderConstruction)) return false;
  const building = world.tryGet(site, Building);
  if (
    building === undefined ||
    building.tribe !== plan.tribe ||
    !ownersCompatible(plan.owner, ownerOf(world, site))
  ) {
    return false;
  }
  const component = terrain.componentOf(here);
  return spacing
    .workCells(site)
    .some(
      (cell: NodeId) => terrain.componentOf(cell) === component && (plan.limit?.allowsNode(cell) ?? true),
    );
}
