import { Building, Position, SiteAssignment, UnderConstruction } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import { assembleBuilding } from '../../../command/placement.js';
import { advanceRotation, nextRotationPick } from '../../../economy/production.js';
import { findVehicleSite, reusableVehicleSite } from '../../../footprint/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { vehicleHouseOfGood } from '../../../readviews/index.js';
import { deliveredConstructionFraction, recipesByProductOf } from '../../../stores/index.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { interactionCell } from '../../targets/index.js';
import { isUnreachableGoal, noteUnreachableGoal, unreachableGoals } from '../../unreachable-goals.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * VEHICLE YARD - a workshop operator whose rotation has reached a vehicle good builds it as a hidden
 * construction site of the good's `vehicleHouse` beside the workshop instead of running a cycle
 * (docs/formats/VEHICLES.md "Construction"): it reuses its own or any unfinished site of that house within
 * the reuse ring of the work centre, else opens one at the first admissible point of the placement ring,
 * then hammers from the house work point while delivered material is left to install and fetches the
 * bill's goods otherwise, the way a builder crews an ordinary site. The construction system launches the
 * vehicle when the site finishes; the worker then moves its rotation past the vehicle good.
 *
 * Returns whether the operator's turn was a vehicle's. A search that finds nowhere raises the refusal
 * once and parks the worker for the failed-goal memo's span before it looks again.
 */
export function planVehicleYard(plan: PlannerContext, workplace: Entity, spacing: PlannerSpacing): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return false;
  releaseFinishedSite(plan, workplace, recipes);
  const pick = nextRotationPick(world, ctx, workplace, e, recipes);
  const houseType = pick === null ? undefined : vehicleHouseOfGood(ctx.content, pick.good);
  if (houseType === undefined) return false;

  const site = siteFor(plan, workplace, houseType);
  if (site === null) return true;
  const assigned = world.tryGet(e, SiteAssignment);
  if (assigned === undefined || assigned.site !== site || assigned.pinned) {
    world.add(e, SiteAssignment, { site, pinned: false });
  }
  const workPoint = interactionCell(world, ctx, terrain, site, here);
  if (world.get(site, UnderConstruction).labor < deliveredConstructionFraction(world, ctx, site)) {
    atOrWalk(world, e, here, workPoint, () =>
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
  if (fetchNeededMaterial(plan, spacing, site)) return true;
  // Nothing to install and nothing to fetch: wait at the work point for a delivery.
  atOrWalk(world, e, here, workPoint, () => {});
  return true;
}

/**
 * A site this worker was crewing that no longer stands under construction has finished (or fallen): its
 * turn is over, so the rotation moves past the vehicle good it was for and the crew membership ends.
 */
function releaseFinishedSite(
  plan: PlannerContext,
  workplace: Entity,
  recipes: NonNullable<ReturnType<typeof recipesByProductOf>>,
): void {
  const { world, ctx, entity: e } = plan;
  const assigned = world.tryGet(e, SiteAssignment);
  if (assigned === undefined || assigned.pinned || world.has(assigned.site, UnderConstruction)) return;
  world.remove(e, SiteAssignment);
  const pick = nextRotationPick(world, ctx, workplace, e, recipes);
  if (pick !== null && vehicleHouseOfGood(ctx.content, pick.good) !== undefined)
    advanceRotation(world, e, pick);
}

/**
 * The site the worker builds `houseType` on: the one it already crews, else the nearest unfinished one of
 * the owner's within the reuse ring, else a fresh one opened at the first admissible placement-ring point.
 * Null when none can be had, which parks the worker.
 */
function siteFor(plan: PlannerContext, workplace: Entity, houseType: number): Entity | null {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const assigned = world.tryGet(e, SiteAssignment);
  if (
    assigned !== undefined &&
    !assigned.pinned &&
    world.has(assigned.site, UnderConstruction) &&
    world.tryGet(assigned.site, Building)?.buildingType === houseType
  ) {
    return assigned.site;
  }
  const centreOf = world.get(workplace, Position);
  const centre = nodeOfPosition(centreOf.x, centreOf.y);
  const reused = reusableVehicleSite(world, targets.vehicleSites, houseType, plan.owner, centre);
  if (reused !== null) return reused;
  // The work centre stands in for the failed search in the memo: it is the worker's bound workplace, which
  // no target scan vetoes, so the entry only spaces the searches out.
  const centreNode = terrain.nodeAtClamped(centre.hx, centre.hy);
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), centreNode)) return null;
  const verdict = findVehicleSite(world, ctx, terrain, houseType, centre, here);
  if (verdict.kind !== 'site') {
    if (noteUnreachableGoal(world, ctx, e, centreNode)) {
      ctx.events.emit({ kind: 'vehicleSiteRefused', entity: e, reason: verdict.kind });
    }
    return null;
  }
  const type = contentIndex(ctx.content).commandBuildings.get(houseType);
  if (type === undefined) return null;
  const site = assembleBuilding(world, ctx, type, {
    buildingType: houseType,
    tribe: plan.tribe,
    owner: plan.owner,
    missionId: undefined,
    x: verdict.node.hx,
    y: verdict.node.hy,
    underConstruction: true,
    fillStock: false,
  });
  if (site !== null) targets.vehicleSites.push(site);
  return site;
}
