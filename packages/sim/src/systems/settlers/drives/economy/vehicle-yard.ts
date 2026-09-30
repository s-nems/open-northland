import {
  Building,
  Position,
  SiteAssignment,
  UnderConstruction,
  VehicleYardRefusals,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { liveEntries, remember } from '../../../../core/expiring-list.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import { assembleBuilding } from '../../../command/placement.js';
import { advanceRotation, nextRotationPick, spendRotationPick } from '../../../economy/production.js';
import { findVehicleSite, reusableVehicleSite, vehicleSiteRings } from '../../../footprint/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { vehicleHouseOfGood } from '../../../readviews/index.js';
import { deliveredConstructionFraction, recipesByProductOf } from '../../../stores/index.js';
import { atOrWalk, BUILD_HOUSE_ATOMIC_ID, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { interactionCell } from '../../targets/index.js';
import { UNREACHABLE_GOAL_MEMO_TICKS } from '../../unreachable-goals.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * VEHICLE YARD - a workshop operator whose rotation has reached a vehicle good builds it as a hidden
 * construction site of the good's `vehicleHouse` beside the workshop instead of running a cycle
 * (docs/formats/VEHICLES.md "Construction"): it reuses its own or any unfinished site of that house within
 * its yard rings of the work centre, else opens one at the first admissible point of those rings,
 * then hammers from the house work point while delivered material is left to install and fetches the
 * bill's goods otherwise, from the workshop's own shelves first, the way a builder crews an ordinary site. The construction system launches the
 * vehicle when the site finishes; the worker then moves its rotation past the vehicle good.
 *
 * Returns whether the operator's turn was a vehicle's. A search that finds nowhere raises the refusal
 * once per refusal span of the workshop and skips the turn; while the refusal holds, every workmate skips
 * that house's turn unsearched.
 */
export function planVehicleYard(plan: PlannerContext, workplace: Entity, spacing: PlannerSpacing): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return false;
  pruneYardRefusals(world, ctx.tick, workplace);
  releaseFinishedSite(plan, workplace, recipes);
  const pick = nextRotationPick(world, ctx, workplace, e, recipes);
  const houseType = pick === null ? undefined : vehicleHouseOfGood(ctx.content, pick.good);
  if (pick === null || houseType === undefined) return false;

  const site = siteFor(plan, workplace, houseType);
  if (site === null) {
    // No spot for the yard (a joinery far from water asked for a ship): the turn is skipped, so the
    // rotation moves on to the workshop's other products instead of stalling on this one.
    advanceRotation(world, e, pick);
    return false;
  }
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
  if (fetchNeededMaterial(plan, spacing, site, workplace)) return true;
  // Nothing to install and nothing to fetch: wait at the work point for a delivery.
  atOrWalk(world, e, here, workPoint, () => {});
  return true;
}

/**
 * A site this worker was crewing that no longer stands under construction has finished (or fallen): its
 * turn is over, so the rotation spends the vehicle good it was for and the crew membership ends.
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
    spendRotationPick(world, e, pick);
}

/**
 * The site the worker builds `houseType` on: the one it already crews, else the nearest unfinished one of
 * the owner's within the yard rings, else a fresh one opened at their first admissible point.
 * Null when none can be had, which skips the turn.
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
  const house = contentIndex(ctx.content).commandBuildings.get(houseType);
  if (house === undefined) return null;
  const rings = vehicleSiteRings(house);
  // A yard across the water or on another shore is out of this crew's walk, however near it stands.
  const shore = terrain.componentOf(here);
  const onShore = (candidate: Entity): boolean =>
    terrain.componentOf(interactionCell(world, ctx, terrain, candidate, here)) === shore;
  const reused = reusableVehicleSite(
    world,
    targets.vehicleSites,
    houseType,
    plan.owner,
    centre,
    rings,
    onShore,
  );
  if (reused !== null) return reused;
  if (yardRefused(world, workplace, houseType)) return null;
  const verdict = findVehicleSite(world, ctx, terrain, houseType, plan.tribe, centre, here);
  if (verdict.kind !== 'site') {
    noteYardRefused(world, ctx.tick, workplace, houseType);
    ctx.events.emit({ kind: 'vehicleSiteRefused', entity: e, reason: verdict.kind });
    return null;
  }
  const site = assembleBuilding(world, ctx, house, {
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

/** How long a workshop's failed yard search holds: the failed-goal memo's span. */
const YARD_REFUSAL_TICKS = UNREACHABLE_GOAL_MEMO_TICKS;
/** No bound past the one entry per yard house that {@link remember} already keeps. */
const YARD_REFUSALS_UNBOUNDED = Number.POSITIVE_INFINITY;

/** Drop `workplace`'s lapsed refusals, shedding the component once none is left. Runs on every plan of a
 *  worker there, whatever its rotation picks, so a workshop that stopped making vehicles carries no dead
 *  state into the hash. */
function pruneYardRefusals(world: World, tick: number, workplace: Entity): void {
  const refusals = world.tryGet(workplace, VehicleYardRefusals);
  if (refusals === undefined) return;
  const live = liveEntries(refusals.entries, tick);
  if (live.length === 0) world.remove(workplace, VehicleYardRefusals);
  else if (live !== refusals.entries) world.mut(workplace, VehicleYardRefusals).entries = [...live];
}

/** Whether `workplace` gave up on a site of `houseType` within the span, read after {@link pruneYardRefusals}. */
function yardRefused(world: World, workplace: Entity, houseType: number): boolean {
  return (
    world.tryGet(workplace, VehicleYardRefusals)?.entries.some((entry) => entry.houseType === houseType) ===
    true
  );
}

/** Record that `workplace` found no site for `houseType`. */
function noteYardRefused(world: World, tick: number, workplace: Entity, houseType: number): void {
  const entries = remember(
    world.tryGet(workplace, VehicleYardRefusals)?.entries ?? [],
    tick,
    { houseType, until: tick + YARD_REFUSAL_TICKS },
    (held) => held.houseType === houseType,
    YARD_REFUSALS_UNBOUNDED,
  );
  if (world.has(workplace, VehicleYardRefusals))
    world.mut(workplace, VehicleYardRefusals).entries = [...entries];
  else world.add(workplace, VehicleYardRefusals, { entries: [...entries] });
}
