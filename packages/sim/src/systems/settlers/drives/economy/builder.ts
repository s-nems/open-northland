import {
  ownerOf,
  ownersCompatible,
  Palisade,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { needsRepair } from '../../../economy/repair.js';
import {
  claimPalisade,
  constructionSiteAvailableTo,
  releasePalisadeReservation,
} from '../../../palisades/reservation.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { constructionTribeOf, hasInboundSupply } from '../../../stores/index.js';
import {
  atOrWalk,
  BUILD_HOUSE_ATOMIC_ID,
  BUILD_WALL_ATOMIC_ID,
  jobCanBuild,
  startAtomic,
} from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { nearestBuilderSite, unreachableSiteStand } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { claimWorkCell } from '../spacing.js';
import type { ConstructionTaskClaims } from './construction-task-claims.js';
import { type RepairCrews, startRepair } from './repair.js';
import { boundConstructionSite } from './site-staff.js';
import { constructionMaterialResolver } from './site-supply.js';

type MaterialResolver = ReturnType<typeof constructionMaterialResolver>;

/**
 * BUILD - mend the nearest damaged building that is safe to reach, else keep a useful automatic crew
 * assignment stable, otherwise move the builder to the nearest reachable site with material to fetch or
 * delivered labor to install, and with no task anywhere wait beside a site. Player pins and unfinished
 * workplace bindings are strict: their builders stay with that site even while another has work.
 *
 * Source basis: builders recruited to a damaged building and repair ahead of an upgrade are original
 * behavior. Authored: the safety gate, and repair outranking all automatic construction work, a crew the
 * builder is already on included, where the original recruits only builders with no site.
 */
export function planBuilder(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  repairs: RepairCrews,
): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!jobCanBuild(ctx.content, settler.jobType)) {
    dropAssignment(plan);
    return false;
  }
  const materials = constructionMaterialResolver(plan, spacing);

  const assigned = world.tryGet(e, SiteAssignment);
  const pinned =
    assigned?.pinned === true &&
    onOwnSide(plan, assigned.site) &&
    (world.has(assigned.site, UnderConstruction) || needsRepair(world, assigned.site))
      ? assigned.site
      : null;
  // A segment another builder already claimed is not abandoned: the player's pin outranks the drive, so
  // this builder holds the order and does something else until the claim lapses.
  if (pinned !== null && !constructionSiteAvailableTo(world, pinned, e)) return false;
  const bound = boundConstructionSite(plan);
  const locked = pinned ?? bound;
  if (locked !== null && segmentAwaitsClearance(plan, locked)) {
    dropAssignment(plan);
    return false;
  }
  if (locked !== null) {
    stampAssignment(plan, locked, pinned !== null);
    if (!holdSegment(plan, locked)) return false;
    // A player's pin chose the risk; a workplace binding waits out the attack like an automatic crew.
    const repairing = needsRepair(world, locked);
    if (repairing && (pinned !== null || repairs.isSafe(locked)) && startRepair(plan, spacing, locked)) {
      return true;
    }
    const worked = !repairing && workAtSite(plan, spacing, claims, materials, locked);
    if (!worked) waitAtSite(plan, spacing, locked);
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
  if (repairNearest(plan, spacing, repairs, avoidSite)) return true;

  // A damaged upgrade site is mended before its upgrade goes on, and only by a repair crew, so an
  // automatic builder never hammers the upgrade of a building still under attack.
  const canStandAt = (site: Entity): boolean =>
    world.has(site, UnderConstruction) &&
    !needsRepair(world, site) &&
    constructionSiteAvailableTo(world, site, e) &&
    !segmentAwaitsClearance(plan, site) &&
    builderCanReach(plan, spacing, site);
  const hasTask = (site: Entity): boolean =>
    canStandAt(site) && (claims.hasHammerWork(site) || materials.has(site));
  const nearestSite = (accepts: (site: Entity) => boolean): Entity | null =>
    nearestBuilderSite(
      targets.constructionSiteCells,
      world,
      here,
      settler.tribe,
      settler.owner,
      plan.limit ?? undefined,
      avoidSite,
      accepts,
    );

  // Crew membership is sticky while it still has useful work. This avoids re-ranking builders between
  // equally valid sites every time one hammer atomic completes.
  const crewSite = assigned?.pinned === false && avoidSite?.(assigned.site) !== true ? assigned.site : null;
  const site = crewSite !== null && hasTask(crewSite) ? crewSite : nearestSite(hasTask);
  if (site !== null && world.has(site, Palisade)) {
    // A segment is claimed before any hammer or delivery, so it has one builder.
    stampAssignment(plan, site, false);
    if (!holdSegment(plan, site)) return false;
    if (!workAtSite(plan, spacing, claims, materials, site)) waitAtSite(plan, spacing, site);
    return true;
  }
  if (site !== null && workAtSite(plan, spacing, claims, materials, site)) {
    stampAssignment(plan, site, false);
    return true;
  }

  // No site has a task this pass, so stand ready where the next one will appear: a site with a delivery
  // already walking in, else the current crew site, else the nearest. A builder has no other trade to
  // fall back to, and one that drifts off with the idle crowd pays the walk back for every delivery.
  const staging =
    nearestSite((candidate) => canStandAt(candidate) && hasInboundSupply(plan.inbound, candidate)) ??
    (crewSite !== null && canStandAt(crewSite) ? crewSite : nearestSite(canStandAt));
  if (staging !== null) {
    stampAssignment(plan, staging, false);
    if (!holdSegment(plan, staging)) return false;
    waitAtSite(plan, spacing, staging);
    return true;
  }
  dropAssignment(plan);
  return false;
}

/** Start a repair swing at the builder's own repair crew's building while it still qualifies, else at the
 *  nearest damaged building that does. */
function repairNearest(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  repairs: RepairCrews,
  avoidSite: ((site: Entity) => boolean) | undefined,
): boolean {
  const { world, entity: e, here, targets } = plan;
  const qualifies = (site: Entity): boolean =>
    needsRepair(world, site) &&
    repairs.isSafe(site) &&
    builderCanReach(plan, spacing, site) &&
    // Last: the first crew question of a pass scans every assignment in the world.
    repairs.hasRoom(site, e);
  const assigned = world.tryGet(e, SiteAssignment);
  const crewSite =
    assigned?.pinned === false && avoidSite?.(assigned.site) !== true && qualifies(assigned.site)
      ? assigned.site
      : null;
  const site =
    crewSite ??
    nearestBuilderSite(
      targets.repairSiteCells,
      world,
      here,
      plan.tribe,
      plan.owner,
      plan.limit ?? undefined,
      avoidSite,
      qualifies,
    );
  if (site === null || !startRepair(plan, spacing, site)) return false;
  repairs.join(site, e);
  stampAssignment(plan, site, false);
  return true;
}

/** Take a wall segment's single-builder claim; an ordinary building always passes. A lost claim drops
 *  the assignment. */
function holdSegment(plan: PlannerContext, site: Entity): boolean {
  if (claimPalisade(plan.world, site, plan.entity)) return true;
  dropAssignment(plan);
  return false;
}

/** A hammered segment finishes only once its cells are clear, so a builder waiting beside it would hold
 *  it unfinished. */
function segmentAwaitsClearance(plan: PlannerContext, site: Entity): boolean {
  const { world } = plan;
  return world.has(site, Palisade) && (world.tryGet(site, UnderConstruction)?.labor ?? ONE) >= ONE;
}

/** Leave crew membership, releasing any wall segment claim before the assignment that anchors it. */
function dropAssignment(plan: PlannerContext): void {
  releasePalisadeReservation(plan.world, plan.entity);
  plan.world.remove(plan.entity, SiteAssignment);
}

/** Run one useful task, preferring a first real hammer worker, then a missing-material fetch. */
function workAtSite(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  materials: MaterialResolver,
  site: Entity,
): boolean {
  if (
    claims.hasHammerWork(site) &&
    !claims.hasHammerClaim(site) &&
    startHammer(plan, spacing, claims, site)
  ) {
    return true;
  }
  if (materials.fetch(site)) return true;
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
  const buildAtomic = world.has(site, Palisade) ? BUILD_WALL_ATOMIC_ID : BUILD_HOUSE_ATOMIC_ID;
  atOrWalk(world, e, here, stand, () =>
    startAtomic(
      world,
      e,
      buildAtomic,
      { kind: 'construct', site },
      atomicDuration(ctx.content, plan, buildAtomic),
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
    if (assigned?.site !== site) releasePalisadeReservation(world, e);
    world.add(e, SiteAssignment, { site, pinned });
  }
}

/** Whether `site` is still a building of the builder's own tribe and side; a script can hand it away. */
function onOwnSide(plan: PlannerContext, site: Entity): boolean {
  return (
    constructionTribeOf(plan.world, site) === plan.tribe &&
    ownersCompatible(plan.owner, ownerOf(plan.world, site))
  );
}

/** Ownership, confinement and an actual routeable perimeter cell for an automatic assignment. */
function builderCanReach(plan: PlannerContext, spacing: PlannerSpacing, site: Entity): boolean {
  const { terrain, here } = plan;
  if (!onOwnSide(plan, site)) return false;
  const component = terrain.componentOf(here);
  return spacing
    .workCells(site)
    .some(
      (cell: NodeId) => terrain.componentOf(cell) === component && (plan.limit?.allowsNode(cell) ?? true),
    );
}
