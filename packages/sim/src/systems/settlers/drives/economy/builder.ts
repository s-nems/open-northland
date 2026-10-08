import {
  BuildMode,
  Damaged,
  LostWay,
  ownerOf,
  ownersCompatible,
  Palisade,
  Position,
  RoadSite,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { needsRepair } from '../../../economy/repair.js';
import {
  claimSite,
  constructionSiteAvailableTo,
  isSoloSite,
  releaseSiteClaim,
} from '../../../economy/site-claim.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { pickRoadSite } from '../../../roads/site-pick.js';
import type { NavigationLimit } from '../../../signposts/index.js';
import {
  atOrWalk,
  BUILD_HOUSE_ATOMIC_ID,
  BUILD_ROAD_ATOMIC_ID,
  BUILD_WALL_ATOMIC_ID,
  jobCanBuild,
  startAtomic,
} from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import {
  InteractionCellIndex,
  interactionCell,
  nearestBuilderSite,
  unreachableSiteStand,
} from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { cutOffCheckDue } from '../cut-off.js';
import { claimWorkCell } from '../spacing.js';
import type { ConstructionTaskClaims, SiteRanking } from './construction-task-claims.js';
import { type RepairCrews, startRepair } from './repair.js';
import { boundConstructionSite } from './site-staff.js';
import { constructionMaterialResolver, type SiteSupplyReach } from './site-supply.js';

type MaterialResolver = ReturnType<typeof constructionMaterialResolver>;

/**
 * BUILD - mend the nearest damaged building that is safe to reach, else take the building site of the
 * highest rank with a task for this builder: by its tier (`SITE_TIER`), then by the tenth of its bill
 * delivered, then by distance, its own crew site first among equals. At the site, delivered material is
 * hammered before more is fetched, and a covered site keeps a finishing crew waiting for its last loads.
 * The last builder at a site with a task stays, unless it has no step to hammer there and the site it
 * would go to has nobody. With no task anywhere the builder waits beside a site, unless only its
 * signposts keep it from one. A
 * road or wall run the player started ({@link BuildMode}) goes before all of that. Walls wait while a
 * building site holds a task the builder can do, a damaged wall goes before a new segment, and road sites
 * wait while a building or a wall site holds one. Player pins and unfinished workplace bindings are
 * strict: their builders stay with that site even while another has work.
 *
 * Source basis: builders recruited to a damaged building and repair ahead of an upgrade are original
 * behavior. Authored: the safety gate, repair outranking all automatic construction work, a crew the
 * builder is already on included, where the original recruits only builders with no site, then walls,
 * then roads last (owner ruling), the site ranking and the finishing crew (owner ruling), and hammering
 * ahead of hauling.
 */
export function planBuilder(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  repairs: RepairCrews,
  supply: SiteSupplyReach,
): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!jobCanBuild(ctx.content, settler.jobType)) {
    dropAssignment(plan, claims);
    return false;
  }
  const materials = constructionMaterialResolver(plan, spacing, { confined: supply });
  // A pinned, bound or run site was chosen past the confinement, so its material is too.
  const orderedMaterials = (): MaterialResolver => constructionMaterialResolver(plan, spacing);

  const assigned = world.tryGet(e, SiteAssignment);
  // A road or wall run outranks the pin and the workplace binding: the player ordered it last.
  const mode = world.tryGet(e, BuildMode)?.kind;
  const pinned =
    mode === undefined &&
    assigned?.pinned === true &&
    onOwnSide(plan, assigned.site) &&
    (world.has(assigned.site, UnderConstruction) || needsRepair(world, assigned.site))
      ? assigned.site
      : null;
  // A segment another builder already claimed is not abandoned: the player's pin outranks the drive, so
  // this builder holds the order and does something else until the claim lapses.
  if (pinned !== null && !constructionSiteAvailableTo(world, pinned, e)) return false;
  const bound = mode === undefined ? boundConstructionSite(plan) : null;
  const locked = pinned ?? bound;
  if (locked !== null && segmentAwaitsClearance(plan, locked)) {
    dropAssignment(plan, claims);
    return false;
  }
  if (locked !== null) {
    stampAssignment(plan, claims, locked, pinned !== null);
    if (!holdSegment(plan, claims, locked)) return false;
    // A player's pin chose the risk; a workplace binding waits out the attack like an automatic crew.
    const repairing = needsRepair(world, locked);
    if (repairing && (pinned !== null || repairs.isSafe(locked)) && startRepair(plan, spacing, locked)) {
      return true;
    }
    const worked = !repairing && workAtSite(plan, spacing, claims, orderedMaterials(), locked);
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

  const standableWithin = (limit: NavigationLimit | null) => standableSite(plan, spacing, limit);
  const canStandAt = standableWithin(plan.limit);
  const hasTask = siteHasTask(claims, materials, canStandAt);
  const nearestSite = (
    sites: InteractionCellIndex,
    accepts: (site: Entity) => boolean,
    limit = plan.limit,
  ): Entity | null =>
    nearestBuilderSite(sites, world, here, settler.owner, limit ?? undefined, avoidSite, accepts);

  // A road site's stone paves its pending neighbours too, so the nearest one only anchors the pick.
  const pickRoad = (
    sites: InteractionCellIndex,
    accepts: (site: Entity) => boolean,
    limit = plan.limit,
  ): Entity | null => {
    const nearest = nearestSite(sites, accepts, limit);
    return nearest === null
      ? null
      : pickRoadSite(world, terrain, e, here, nearest, (site) => avoidSite?.(site) !== true && accepts(site));
  };

  if (mode !== undefined) {
    // A run is the player's order, like a pin: it goes on past the signpost area, to any site the builder
    // can walk to.
    const runStandable = standableWithin(null);
    const next =
      keptRunSite(plan, mode, assigned?.site) ??
      (mode === 'roads'
        ? pickRoad(targets.roadSiteCells, runStandable, null)
        : nearestSite(targets.wallSiteCells, runStandable, null));
    if (next !== null) {
      stampAssignment(plan, claims, next, true);
      if (!holdSegment(plan, claims, next)) return false;
      if (!workAtSite(plan, spacing, claims, orderedMaterials(), next)) waitAtSite(plan, spacing, next);
      return true;
    }
    // Nothing of the kind is left to claim: the run is over and normal priorities resume.
    world.remove(e, BuildMode);
    dropAssignment(plan, claims);
  }

  if (repairNearest(plan, spacing, repairs, claims, avoidSite, false)) return true;

  // Building sites are taken by rank, the crew site winning ties, so a crew holds together between
  // equally ranked sites instead of re-ranking every time one hammer atomic completes.
  const crewSite = assigned?.pinned === false && avoidSite?.(assigned.site) !== true ? assigned.site : null;
  const crewBuilding = crewSite !== null && !isSoloSite(world, crewSite) ? crewSite : null;
  // A building site's task for this builder: hammering, a material fetch, or a wait for its last loads.
  const buildingAccepts = (site: Entity): boolean =>
    hasTask(site) || (claims.hasFinishingRoom(site, e) && canStandAt(site));
  let rankedBuilding: Entity | null | undefined;
  const bestBuildingSite = (): Entity | null => {
    rankedBuilding ??= rankedBuildingSite(
      claims.rankBuildingSites(settler.owner, targets.constructionSites),
      crewBuilding,
      buildingAccepts,
      (accepts) => nearestSite(targets.constructionSiteCells, accepts),
    );
    return rankedBuilding;
  };
  // Walls come after buildings: an automatic builder turns to one only while no building site holds a
  // task it can do, so a house starved of material does not stall the walls. Project rule.
  const isWall = (site: Entity): boolean => world.has(site, Palisade);
  const wallsWait = (): boolean => bestBuildingSite() !== null;
  // Roads come after walls the same way: they wait while a building or a wall site holds a task.
  let wallTask: Entity | null | undefined;
  const nearestWallTask = (): Entity | null => {
    if (wallTask === undefined) {
      wallTask = claims.wallMayHaveTask(materials.canSource)
        ? nearestSite(targets.wallSiteCells, hasTask)
        : null;
    }
    return wallTask;
  };
  const roadsWait = (): boolean => wallsWait() || nearestWallTask() !== null;
  const inTurn = (site: Entity): boolean =>
    world.has(site, RoadSite) ? !roadsWait() : !isWall(site) || !wallsWait();
  // Staging only: a building site that passes `accepts` outranks every wall and road, and a wall every
  // road. `walls` and `roads` narrow the sites to those that can pass `accepts`, null for none: while
  // every site waits for material, an idle builder would otherwise weigh them all on each plan.
  const nearestInTurn = (
    accepts: (site: Entity) => boolean,
    walls: () => InteractionCellIndex | null,
    roads: () => InteractionCellIndex | null,
  ): Entity | null => {
    const building = nearestSite(targets.constructionSiteCells, accepts);
    if (building !== null || wallsWait()) return building;
    const wallCandidates = walls();
    const wall = wallCandidates === null ? null : nearestSite(wallCandidates, accepts);
    if (wall !== null || roadsWait()) return wall;
    const roadCandidates = roads();
    return roadCandidates === null ? null : pickRoad(roadCandidates, accepts);
  };
  const everyWall = (): InteractionCellIndex => targets.wallSiteCells;

  // The damaged-wall list is checked first: most passes have none, and `wallsWait` is a site search.
  if (
    world.canonicalQuery(Damaged, Palisade, Position).length > 0 &&
    !wallsWait() &&
    repairNearest(plan, spacing, repairs, claims, avoidSite, true)
  ) {
    return true;
  }

  // A one-builder site is kept while it still has a task and its turn.
  const keptSolo =
    crewSite !== null && crewBuilding === null && hasTask(crewSite) && inTurn(crewSite) ? crewSite : null;
  // The last builder at a building site with a task stays, so a site is never left for a fuller one,
  // unless it has no step to hammer and the site it would go to has nobody.
  const lastHand =
    crewBuilding !== null && claims.crewSize(crewBuilding) <= 1 && buildingAccepts(crewBuilding);
  let site = keptSolo;
  if (site === null) {
    const best = bestBuildingSite();
    const leaves =
      best !== null &&
      claims.crewSize(best) === 0 &&
      crewBuilding !== null &&
      !claims.hasHammerWork(crewBuilding);
    site = lastHand && best !== crewBuilding && !leaves ? crewBuilding : best;
  }
  site ??=
    nearestWallTask() ??
    (claims.roadMayHaveTask(materials.canSource, settler.owner)
      ? pickRoad(targets.roadSiteCells, hasTask)
      : null);
  if (site !== null && isSoloSite(world, site)) {
    // A segment or road site is claimed before any hammer or delivery, so it has one builder.
    stampAssignment(plan, claims, site, false);
    if (!holdSegment(plan, claims, site)) return false;
    if (!workAtSite(plan, spacing, claims, materials, site)) waitAtSite(plan, spacing, site);
    return true;
  }
  if (site !== null) {
    if (workAtSite(plan, spacing, claims, materials, site)) {
      stampAssignment(plan, claims, site, false);
      return true;
    }
    if (claims.hasFinishingRoom(site, e)) {
      stampAssignment(plan, claims, site, false);
      waitAtSite(plan, spacing, site);
      return true;
    }
  }

  // No site has a task this pass, so stand ready where the next one will appear: a site with a delivery
  // already walking in, else the current crew site, else the nearest. A builder has no other trade to
  // fall back to, and one that drifts off with the idle crowd pays the walk back for every delivery.
  // Only a road site with stone on the way is waited at: waiting claims the site, and a claimed site is
  // one a neighbour's finishing stone cannot pave and a supplied builder must pass over. One cut off by its
  // signposts, from its work or its seat, stands lost on the idle tail instead, whose cut-off check tells
  // the player and lifts the mark once the network reaches them.
  if (world.tryGet(e, LostWay)?.cutOff !== true) {
    const staging =
      nearestInTurn(
        (candidate) => plan.supply.hasInbound(candidate) && canStandAt(candidate),
        () => soloSitesAwaitingSupply(plan, 'wall'),
        () => soloSitesAwaitingSupply(plan, 'road'),
      ) ??
      (crewSite !== null && !world.has(crewSite, RoadSite) && canStandAt(crewSite) && inTurn(crewSite)
        ? crewSite
        : nearestInTurn(canStandAt, everyWall, () => null));
    if (
      staging !== null &&
      !(cutOffCheckDue(ctx) && builderWorkBeyondReach(plan, spacing, claims, supply) !== null)
    ) {
      stampAssignment(plan, claims, staging, false);
      if (!holdSegment(plan, claims, staging)) return false;
      waitAtSite(plan, spacing, staging);
      return true;
    }
  }
  dropAssignment(plan, claims);
  return false;
}

/**
 * The stand the signposts keep a builder from: no site within its confinement gives it a task, but one
 * would if no confinement held it. The stand is at that site, or at the source of its material when the
 * site itself is in reach and only the material lies beyond, so the mark points where the builder cannot
 * get to. Null when no such site waits, or when some site in reach has a task, whoever holds it.
 * Original behavior, unconfirmed against the running original: the builder plans that walk
 * anyway and stands lost once its guided pathfinder has failed. Approximation: this planner never plans
 * past the confinement, so the cut-off check asks a pick past the signpost and goods-search gates
 * instead, on its cadence, once per builder and pass. A source on another landmass is no source: no
 * signpost reaches across water.
 */
export function builderWorkBeyondReach(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  supply: SiteSupplyReach,
): NodeId | null {
  if (plan.limit === null) return null;
  const memo = supply.beyondReachByBuilder.get(plan.entity);
  if (memo !== undefined) return memo;
  const beyond = findWorkBeyondReach(plan, spacing, claims, supply);
  supply.beyondReachByBuilder.set(plan.entity, beyond);
  return beyond;
}

function findWorkBeyondReach(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  supply: SiteSupplyReach,
): NodeId | null {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const avoidSite = unreachableSiteStand(
    world,
    ctx,
    terrain,
    targets.yard.blocked,
    here,
    unreachableGoalVeto(world, ctx, e),
  );
  const confined = constructionMaterialResolver(plan, spacing, { confined: supply });
  if (anyTaskSite(plan, spacing, claims, confined, avoidSite) !== null) return null;
  const free: PlannerContext = { ...plan, limit: null };
  const landmass = terrain.componentOf(here);
  const ashore = constructionMaterialResolver(free, spacing, {
    anywhere: true,
    rejectSource: (cell) => terrain.componentOf(cell) !== landmass,
  });
  const site = anyTaskSite(free, spacing, claims, ashore, avoidSite);
  if (site === null) return null;
  // A site in reach with no confined task is one whose material alone lies beyond the signposts.
  const source = builderCanReach(plan, spacing, site) ? ashore.sourceOf(site) : null;
  return interactionCell(world, ctx, terrain, source ?? site, here);
}

/** The nearest site within `plan.limit` that gives this builder a task from `materials`, in the order the
 *  ladder takes them: buildings, then walls, then roads. */
function anyTaskSite(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  claims: ConstructionTaskClaims,
  materials: MaterialResolver,
  avoidSite: ((site: Entity) => boolean) | undefined,
): Entity | null {
  const { world, here, targets, owner, limit } = plan;
  const hasTask = siteHasTask(claims, materials, standableSite(plan, spacing, limit));
  const found = (sites: InteractionCellIndex): Entity | null =>
    nearestBuilderSite(sites, world, here, owner, limit ?? undefined, avoidSite, hasTask);
  return (
    found(targets.constructionSiteCells) ??
    (claims.wallMayHaveTask(materials.canSource) ? found(targets.wallSiteCells) : null) ??
    (claims.roadMayHaveTask(materials.canSource, owner) ? found(targets.roadSiteCells) : null)
  );
}

/** The building site of the highest rank that `accepts` this builder, the nearest within a rank and
 *  the builder's own `crewSite` first among equals. */
function rankedBuildingSite(
  ranking: SiteRanking,
  crewSite: Entity | null,
  accepts: (site: Entity) => boolean,
  nearest: (accepts: (site: Entity) => boolean) => Entity | null,
): Entity | null {
  const { ranks, rankOf } = ranking;
  for (const rank of ranks) {
    if (crewSite !== null && rankOf.get(crewSite) === rank && accepts(crewSite)) return crewSite;
    const site = nearest((candidate) => rankOf.get(candidate) === rank && accepts(candidate));
    if (site !== null) return site;
  }
  return null;
}

/** An unfinished site this builder may stand at within `limit`. A damaged upgrade site is mended before its
 *  upgrade goes on, and only by a repair crew, so an automatic builder never hammers the upgrade of a
 *  building still under attack. */
function standableSite(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  limit: NavigationLimit | null,
): (site: Entity) => boolean {
  const { world, entity: e } = plan;
  return (site) =>
    world.has(site, UnderConstruction) &&
    !needsRepair(world, site) &&
    constructionSiteAvailableTo(world, site, e) &&
    !segmentAwaitsClearance(plan, site) &&
    builderCanReach(plan, spacing, site, limit);
}

/** A site with hammering or a material fetch for this builder that it can stand at. The pass-memoized
 *  work checks run before the reach test, the costlier per site. */
function siteHasTask(
  claims: ConstructionTaskClaims,
  materials: MaterialResolver,
  canStandAt: (site: Entity) => boolean,
): (site: Entity) => boolean {
  return (site) => (claims.hasHammerWork(site) || materials.has(site)) && canStandAt(site);
}

/** Start a repair swing at the builder's own repair crew's site while it still qualifies, else at the
 *  nearest damaged one that does: a wall when `walls`, else a building. */
function repairNearest(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  repairs: RepairCrews,
  claims: ConstructionTaskClaims,
  avoidSite: ((site: Entity) => boolean) | undefined,
  walls: boolean,
): boolean {
  const { world, entity: e, here, targets } = plan;
  const qualifies = (site: Entity): boolean =>
    world.has(site, Palisade) === walls &&
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
      walls ? targets.wallRepairCells : targets.repairSiteCells,
      world,
      here,
      plan.owner,
      plan.limit ?? undefined,
      avoidSite,
      qualifies,
    );
  if (site === null || !startRepair(plan, spacing, site)) return false;
  repairs.join(site, e);
  stampAssignment(plan, claims, site, false);
  return true;
}

/** The wall segments or road sites a live supply errand is bringing material to, indexed like
 *  `TargetCandidates.wallSiteCells`, or null for none. */
function soloSitesAwaitingSupply(plan: PlannerContext, kind: 'wall' | 'road'): InteractionCellIndex | null {
  const { world, ctx, terrain } = plan;
  const component = kind === 'wall' ? Palisade : RoadSite;
  const sites: Entity[] = [];
  for (const site of plan.supply.inbound.keys()) {
    if (world.has(site, component) && world.has(site, UnderConstruction) && world.has(site, Position)) {
      sites.push(site);
    }
  }
  return sites.length === 0 ? null : new InteractionCellIndex(world, ctx, terrain, sites);
}

/** The site a road or wall run keeps working: its current one while that is still an unfinished site of
 *  the run's kind on the builder's side that no other builder holds. Reach is not re-tested, like a pin. */
function keptRunSite(plan: PlannerContext, mode: 'roads' | 'walls', site: Entity | undefined): Entity | null {
  const { world, entity: e } = plan;
  if (
    site === undefined ||
    !world.has(site, mode === 'roads' ? RoadSite : Palisade) ||
    !world.has(site, UnderConstruction) ||
    !onOwnSide(plan, site) ||
    !constructionSiteAvailableTo(world, site, e) ||
    segmentAwaitsClearance(plan, site)
  ) {
    return null;
  }
  return site;
}

/** Take a wall segment's single-builder claim; an ordinary building always passes. A lost claim drops
 *  the assignment. */
function holdSegment(plan: PlannerContext, claims: ConstructionTaskClaims, site: Entity): boolean {
  if (claimSite(plan.world, site, plan.entity)) return true;
  dropAssignment(plan, claims);
  return false;
}

/** A hammered segment has no work left: it stands once no traveller is on its cells, and its claim holds
 *  until then without the builder. */
function segmentAwaitsClearance(plan: PlannerContext, site: Entity): boolean {
  const labor = plan.world.tryGet(site, UnderConstruction)?.labor;
  return labor !== undefined && labor >= ONE && plan.world.has(site, Palisade);
}

/** Leave crew membership, releasing any one-builder site claim before the assignment that anchors it. */
function dropAssignment(plan: PlannerContext, claims: ConstructionTaskClaims): void {
  claims.moveCrew(plan.world.tryGet(plan.entity, SiteAssignment)?.site, undefined);
  releaseSiteClaim(plan.world, plan.entity);
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
  const buildAtomic = world.has(site, Palisade)
    ? BUILD_WALL_ATOMIC_ID
    : world.has(site, RoadSite)
      ? BUILD_ROAD_ATOMIC_ID
      : BUILD_HOUSE_ATOMIC_ID;
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

function stampAssignment(
  plan: PlannerContext,
  claims: ConstructionTaskClaims,
  site: Entity,
  pinned: boolean,
): void {
  const { world, entity: e } = plan;
  const assigned = world.tryGet(e, SiteAssignment);
  claims.moveCrew(assigned?.site, site);
  if (assigned === undefined || assigned.site !== site || assigned.pinned !== pinned) {
    if (assigned?.site !== site) releaseSiteClaim(world, e);
    world.add(e, SiteAssignment, { site, pinned });
  }
}

/** Whether `site` is still on the builder's side; a script can hand it away. */
function onOwnSide(plan: PlannerContext, site: Entity): boolean {
  return ownersCompatible(plan.owner, ownerOf(plan.world, site));
}

/** Ownership, confinement to `limit` and an actual routeable perimeter cell for an assignment. */
function builderCanReach(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  site: Entity,
  limit: NavigationLimit | null = plan.limit,
): boolean {
  const { terrain, here } = plan;
  if (!onOwnSide(plan, site)) return false;
  const component = terrain.componentOf(here);
  return spacing
    .workCells(site)
    .some((cell: NodeId) => terrain.componentOf(cell) === component && (limit?.allowsNode(cell) ?? true));
}
