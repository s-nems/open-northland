import { Building, CurrentAtomic, FishSwarm, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { originalReachBudget, type ReachTarget, reachContains } from '../../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf, nearestRingNode } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SpareForce } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { FISH_SHORE_SEARCH_RADIUS } from '../../economy/fish.js';
import { liveFlagOf, liveWorkFlag } from '../../economy/work-flag.js';
import { routeRegions } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isFisherJob } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { type ReachSpan, type TerrainReach, terrainReach } from '../../signposts/terrain-reach.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { manhattan } from '../../spatial/metric.js';
import { HOUSING_WOMEN_PER_FOOD_SOURCE } from '../build-order/housing.js';
import { seatHasSide } from '../build-order/seat-order.js';
import { femaleDemand } from '../female-stock.js';
import { NEAR_BAND_NODES } from '../knowledge/seat-brief.js';
import { claimFlagNode, type FlagGround, legalFlagNodeTest, type TakenFlagNodes } from './flag-spots.js';

/** The most fishers the seat keeps while fish swim in reach (authored): the first is hired beside the
 *  first collector posts, the second only as a top-up, unless the seat's economy leans on fishing. */
const FISHER_TARGET = 2;

/**
 * How many fishers the seat hires up to ({@link FISHER_TARGET} at most), the far fisher among them (owner
 * ruling: the homes go up first, so the women start children before the men go fishing, and one fisher
 * comes before more): none until its first wave of homes stands (`homesStand`), then one, and one more for
 * each {@link HOUSING_WOMEN_PER_FOOD_SOURCE} women and booked daughters past the first.
 */
export function fisherTarget(world: World, ctx: SystemContext, player: number, homesStand: boolean): number {
  if (!homesStand) return 0;
  const women = femaleDemand(world, ctx, player);
  return Math.min(FISHER_TARGET, Math.max(1, Math.ceil(women / HOUSING_WOMEN_PER_FOOD_SOURCE)));
}

/** How far past a fisher's own shore search his water may lie from a store's door, in Manhattan nodes
 *  (authored): the store's carriers walk the catch in from his flag, so the trip is theirs, not his. */
const FISHING_WALK_NODES = 48;

/** How far from a store's door a seat posts a fisher's flag, in Manhattan nodes. */
const FISHING_TRIP_RADIUS_NODES = FISHING_WALK_NODES + FISH_SHORE_SEARCH_RADIUS;

/**
 * How far from a store's door a seat with no fished water within a trip sends its one far fisher, in
 * Manhattan nodes: the seat brief's near band (owner ruling: fish is a quick, good food source, so a seat
 * fishes from the start also where its water lies far, as on specjalna_forteca, whose stores lie 64-135
 * nodes from their nearest fished shore).
 */
const FAR_FISHING_RADIUS_NODES = NEAR_BAND_NODES;

/** One radius of the shore search from a store's door, with each store's held walk search for it. */
interface FishingReach {
  readonly radius: number;
  /** The walk to the shore: an original-style range search from the door, spending twice the radius in
   *  ground resistance (the goods search's convention), so a shore a short line away but only reached
   *  round a long river bend lies outside it. The range is one past the radius, since the search marks
   *  only nodes strictly inside it. */
  readonly span: ReachSpan;
  /** Each store's held search, kept while it answers as a fresh flood would (`terrainReach`). */
  readonly held: WeakMap<World, Map<Entity, TerrainReach>>;
}

function fishingReach(radius: number): FishingReach {
  return {
    radius,
    span: { range: radius + 1, budget: originalReachBudget(radius), groundCost: true, readOnce: false },
    held: new WeakMap(),
  };
}

/** The shores whose catch the store's carriers lift at a flag fisher's flag. */
const TRIP_REACH = fishingReach(FISHING_TRIP_RADIUS_NODES);
/** The shores a fisher employed at the store walks each catch home from. */
const FAR_REACH = fishingReach(FAR_FISHING_RADIUS_NODES);

/** How far from the shore he casts from a fisher's flag stands, in Manhattan nodes (authored): beside the
 *  water, so each catch is dropped where it is caught instead of walked to the store by the fisher. */
export const FISHER_FLAG_MAX_DISTANCE_NODES = 4;

/** One store's fishing water: the fished shore nearest its door within a {@link FishingReach}. */
interface FishingStand {
  readonly store: Entity;
  readonly door: NodeId;
  readonly shore: NodeId;
  readonly trip: number;
}

/** The seat's fishing posts for one decision, shared by both hiring phases so a first-phase hire counts
 *  toward the top-up. */
export interface FishingPlan {
  readonly job: number;
  readonly terrain: TerrainGraph;
  readonly ground: FlagGround;
  /** The stands nearest their water first, so a warehouse on the shore posts before a distant base. */
  readonly stands: readonly FishingStand[];
  /** The seat's flag fishers; the decision's hires are pushed in and its retirements taken out. */
  readonly fishers: Entity[];
  /** How many fishers the seat hires up to ({@link fisherTarget}); the top-up phase fills it. */
  readonly target: number;
  /** How many fishers the first phase hires up to: the whole {@link target} for a seat with the `fishing`
   *  side (owner ruling: where fish exist a fisher catches a lot), at most one otherwise. */
  readonly firstHires: number;
  /** The water of the seat's far fisher while no swarm, fished out or not, lies within a trip of a store's
   *  door: the fished shore nearest a store's door within {@link FAR_FISHING_RADIUS_NODES}, or null. A seat
   *  that fished out its near water hires none (authored, from skirmish observation: a far fisher's trickle
   *  does not repay the man). */
  readonly far: FishingStand | null;
  /** The seat's fishers employed at a store, the far fisher among them. */
  readonly employed: readonly Entity[];
}

/**
 * The seat's fishing stands, one per built store with fished water within a trip of its door, and its
 * flag `fishers`. Null when the content lacks the fisher trade or the map has no terrain.
 */
export function fishingPlan(
  world: World,
  ctx: SystemContext,
  player: number,
  ground: FlagGround | null,
  fishers: readonly Entity[],
  target: number,
): FishingPlan | null {
  const terrain = ctx.terrain;
  const job = ctx.content.jobs.find((j) => isFisherJob(ctx.content, j.typeId))?.typeId;
  if (terrain === undefined || ground === null || job === undefined) return null;
  const index = contentIndex(ctx.content);
  const stores: { store: Entity; door: NodeId }[] = [];
  for (const e of homeBuildings(world, ctx, player)) {
    if (!isBuilt(world, e)) continue;
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'storage') continue;
    stores.push({ store: e, door: interactionCell(world, ctx, terrain, e) });
  }
  const standsWithin = (reach: FishingReach): FishingStand[] => {
    const found: FishingStand[] = [];
    for (const { store, door } of stores) {
      const shore = fishedShoreNear(world, ctx, terrain, player, store, door, reach);
      if (shore !== null) found.push({ store, door, shore, trip: manhattan(terrain, door, shore) });
    }
    return found.sort((a, b) => a.trip - b.trip || a.store - b.store);
  };
  const stands = standsWithin(TRIP_REACH);
  const waterNear = stores.some(({ door }) => swarmWithinTrip(world, terrain, door));
  const far = stands.length === 0 && !waterNear ? (standsWithin(FAR_REACH)[0] ?? null) : null;
  const firstHires = seatHasSide(world, player, 'fishing') ? target : Math.min(1, target);
  const employed = homeSettlers(world, ctx, player).filter(
    (e) => world.has(e, JobAssignment) && world.get(e, Settler).jobType === job,
  );
  return { job, terrain, ground, stands, fishers: [...fishers], target, firstHires, far, employed };
}

/** Whether the seat fishes this decision: it keeps flag fishers, or hires them now, its target above none
 *  with a stand to post them at. Water alone does not count: no fisher is hired before the homes stand. */
export function fishersWanted(plan: FishingPlan | null): boolean {
  return plan !== null && (plan.fishers.length > 0 || (plan.target > 0 && plan.stands.length > 0));
}

/** Whether one of the seat's men works as a flag fisher: the side names water in the seat's near band,
 *  which can lie beyond every store's fishing trip, so only a hired fisher shows the seat fishes. A far
 *  fisher employed at a store walks every catch home, a trickle that does not make the seat food-rich. */
export function seatFishes(world: World, ctx: SystemContext, player: number): boolean {
  return flagFishers(world, ctx, player) > 0;
}

/** How many of the seat's men work as flag fishers ({@link seatFishes}). */
export function flagFishers(world: World, ctx: SystemContext, player: number): number {
  let fishers = 0;
  for (const e of homeSettlers(world, ctx, player))
    if (isFisherJob(ctx.content, world.get(e, Settler).jobType) && !world.has(e, JobAssignment)) fishers++;
  return fishers;
}

/**
 * The first phase keeps every fisher's flag on fished water: a flag whose water ran dry moves to the
 * seat's nearest stand with a free bank node, and its holder is handed back as a builder when no stand
 * is left; a man mid-action is left alone. It then hires up to the plan's first hires, the top-up phase
 * up to its target. A hire is a flag
 * fisher rather than a store's employee: he drops each catch at the flag beside his water for the
 * carriers, where an employee walks every fish to the store himself.
 */
export function allocateFishers(
  world: World,
  ctx: SystemContext,
  plan: FishingPlan | null,
  force: SpareForce,
  builderJob: number | null,
  taken: TakenFlagNodes,
  phase: 'first' | 'topUp',
): PlayerCommand[] {
  if (plan === null) return [];
  const commands: PlayerCommand[] = [];
  if (phase === 'first') {
    keepFlagsOnWater(world, plan, builderJob, taken, commands);
    if (!keepFarFisher(world, ctx, plan, force, builderJob, taken, commands)) return commands;
  }
  const want = phase === 'first' ? plan.firstHires : plan.target;
  for (const stand of plan.stands) {
    while (plan.fishers.length < want) {
      const spot = fisherFlagSpot(plan, stand, taken);
      if (spot === null) break;
      const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', plan.job));
      if (spare === null) return commands;
      commands.push({ kind: 'setJob', entity: spare, jobType: plan.job });
      commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
      claimFlagNode(taken, spot);
      plan.fishers.push(spare);
    }
  }
  return commands;
}

function keepFlagsOnWater(
  world: World,
  plan: FishingPlan,
  builderJob: number | null,
  taken: TakenFlagNodes,
  commands: PlayerCommand[],
): void {
  const { terrain } = plan;
  for (const fisher of [...plan.fishers]) {
    const flag = liveWorkFlag(world, fisher);
    const at = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (at !== null && fishInReach(world, terrain, terrain.nodeAtClamped(at.hx, at.hy))) continue;
    // Not mid-action, walking included: a walk carries no CurrentAtomic.
    if (world.has(fisher, CurrentAtomic)) continue;
    const spot = firstFlagSpot(plan, taken);
    if (spot !== null) {
      commands.push({ kind: 'setWorkFlag', entity: fisher, x: spot.hx, y: spot.hy });
      claimFlagNode(taken, spot);
    } else if (builderJob !== null) {
      commands.push({ kind: 'setJob', entity: fisher, jobType: builderJob });
      plan.fishers.splice(plan.fishers.indexOf(fisher), 1);
    }
  }
}

/**
 * The seat's one far fisher (owner ruling: a fisher needs no store by the water): while the plan names far
 * water, a man employed at the store nearest fished water within {@link FAR_FISHING_RADIUS_NODES} fishes
 * from a flag beside it and walks every catch home, hired only while the plan's target is above none.
 * Employed rather than flag-bound: a flag fisher drops his catch at the flag for the store's carriers, who
 * lift piles only near their store, so far off it lay where it fell, only the housewives walking out for it. The others are handed back as builders, as
 * is he once the plan names none or his water runs dry; a man mid-action is left alone. False when the
 * spare force ran out, which ends the phase's hiring.
 */
function keepFarFisher(
  world: World,
  ctx: SystemContext,
  plan: FishingPlan,
  force: SpareForce,
  builderJob: number | null,
  taken: TakenFlagNodes,
  commands: PlayerCommand[],
): boolean {
  const { far, terrain } = plan;
  let kept = 0;
  for (const fisher of plan.employed) {
    const flag = liveFlagOf(world, fisher);
    const at = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    const wet = at !== null && fishInReach(world, terrain, terrain.nodeAtClamped(at.hx, at.hy));
    if (far !== null && wet && kept === 0) {
      kept++;
      continue;
    }
    if (builderJob === null || world.has(fisher, CurrentAtomic)) continue;
    commands.push({ kind: 'setJob', entity: fisher, jobType: builderJob });
  }
  if (far === null || kept > 0 || plan.target === 0) return true;
  const spot = fisherFlagSpot(plan, far, taken);
  if (spot === null) return true;
  const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', plan.job));
  if (spare === null) return false;
  commands.push({ kind: 'assignWorker', entity: spare, building: far.store, jobPriority: [plan.job] });
  commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
  claimFlagNode(taken, spot);
  return true;
}

/** The flag spot of the nearest stand whose bank has a legal node, or null. */
function firstFlagSpot(plan: FishingPlan, taken: TakenFlagNodes): HalfCellNode | null {
  for (const stand of plan.stands) {
    const spot = fisherFlagSpot(plan, stand, taken);
    if (spot !== null) return spot;
  }
  return null;
}

/** The legal flag node within {@link FISHER_FLAG_MAX_DISTANCE_NODES} of the stand's shore nearest the
 *  store's door, the shore itself first, or null when the bank is blocked. */
function fisherFlagSpot(plan: FishingPlan, stand: FishingStand, taken: TakenFlagNodes): HalfCellNode | null {
  const shore = plan.terrain.coordsOf(stand.shore);
  const door = plan.terrain.coordsOf(stand.door);
  return nearestRingNode(
    shore.x,
    shore.y,
    0,
    FISHER_FLAG_MAX_DISTANCE_NODES,
    { hx: door.x, hy: door.y },
    legalFlagNodeTest(plan.ground, taken),
  );
}

/**
 * The nearest shore of a swarm holding fish within the `reach` radius of the store's `door` that a man can
 * walk to from it within the reach's span, on its ground and inside the seat's signpost reach, or null.
 */
function fishedShoreNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  store: Entity,
  door: NodeId,
  reach: FishingReach,
): NodeId | null {
  const at = terrain.coordsOf(door);
  const shores: { node: NodeId; dist: number }[] = [];
  for (const e of fishSwarmsNearNode(world, at.x, at.y, reach.radius + FISH_SHORE_SEARCH_RADIUS)) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    const dist = manhattan(terrain, door, swarm.shore);
    if (dist <= reach.radius) shores.push({ node: swarm.shore, dist });
  }
  if (shores.length === 0) return null;
  shores.sort((a, b) => a.dist - b.dist || a.node - b.node);
  // Terrain components rule out another landmass, the region veto a pocket walled off by buildings or
  // resources; a pocketed door would invert that veto (see RouteRegions.pocketed), so it is dropped there.
  const regions = routeRegions(world, ctx, terrain);
  const veto = regions.pocketed(door) ? null : regions;
  const limit = networkLimitAt(world, terrain, player, at.x, at.y);
  const ground = terrain.componentOf(door);
  const open: ReachTarget[] = [];
  for (const shore of shores) {
    if (terrain.componentOf(shore.node) !== ground || veto?.unroutable(door, shore.node) === true) continue;
    if (limit !== null && !limit.allowsNode(shore.node)) continue;
    open.push({ hx: terrain.xOf(shore.node), hy: terrain.yOf(shore.node) });
  }
  if (open.length === 0) return null;
  const walk = shoreWalk(world, ctx, terrain, reach, store, at.x, at.y, open);
  for (const shore of open) {
    if (reachContains(walk.area, shore.hx, shore.hy)) return terrain.nodeAt(shore.hx, shore.hy);
  }
  return null;
}

/** The `reach` span's search from `store`'s door at `(hx, hy)`, exact for the `shores`. */
function shoreWalk(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  reach: FishingReach,
  store: Entity,
  hx: number,
  hy: number,
  shores: readonly ReachTarget[],
): TerrainReach {
  let held = reach.held.get(world);
  if (held === undefined) {
    held = new Map();
    reach.held.set(world, held);
  }
  for (const e of held.keys()) if (!world.isAlive(e)) held.delete(e);
  const found = terrainReach(world, ctx.content, terrain, hx, hy, reach.span, held.get(store), {
    nodes: shores,
    count: shores.length,
  });
  held.set(store, found);
  return found;
}

/** Whether a swarm, fished out or not, has its shore within {@link FISHING_TRIP_RADIUS_NODES} of `door`. */
function swarmWithinTrip(world: World, terrain: TerrainGraph, door: NodeId): boolean {
  const at = terrain.coordsOf(door);
  for (const e of fishSwarmsNearNode(
    world,
    at.x,
    at.y,
    FISHING_TRIP_RADIUS_NODES + FISH_SHORE_SEARCH_RADIUS,
  )) {
    const shore = world.get(e, FishSwarm).shore;
    if (shore !== null && manhattan(terrain, door, shore) <= FISHING_TRIP_RADIUS_NODES) return true;
  }
  return false;
}

/** Whether a swarm holding fish has its shore inside a fisher's shore search from `from`, which walks
 *  Manhattan rings. An emptied swarm never refills, so a dry flag stays dry. */
function fishInReach(world: World, terrain: TerrainGraph, from: NodeId): boolean {
  const at = terrain.coordsOf(from);
  // A swarm's shore lies within the search radius of the swarm, so twice the radius bounds the query.
  for (const e of fishSwarmsNearNode(world, at.x, at.y, 2 * FISH_SHORE_SEARCH_RADIUS)) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    if (manhattan(terrain, from, swarm.shore) <= FISH_SHORE_SEARCH_RADIUS) return true;
  }
  return false;
}
