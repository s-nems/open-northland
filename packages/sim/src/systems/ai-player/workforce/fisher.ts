import { Building, CurrentAtomic, FishSwarm } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { FISH_SHORE_SEARCH_RADIUS } from '../../economy/fish.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { routeRegions } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isFisherJob } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { manhattan } from '../../spatial/metric.js';
import { anchorNodeOf, nearestRingNode } from '../node-geometry.js';
import { isBuilt, ownedBuildings } from '../seat-roster.js';
import { claimFlagNode, legalFlagNodeTest, type TakenFlagNodes } from './flag-spots.js';
import type { SpareForce } from './pool.js';

/** How many fishers the seat keeps while fish swim in reach (authored): the first is hired beside the
 *  first collector posts, the second only as a top-up. */
export const FISHER_TARGET = 2;

/** How far past a fisher's own shore search his water may lie from a store's door, in Manhattan nodes
 *  (authored): the store's carriers walk the catch in from his flag, so the trip is theirs, not his. */
const FISHING_WALK_NODES = 48;

/** How far from a store's door a seat posts a fisher's flag, in Manhattan nodes. */
export const FISHING_TRIP_RADIUS_NODES = FISHING_WALK_NODES + FISH_SHORE_SEARCH_RADIUS;

/** How far from the shore he casts from a fisher's flag stands, in Manhattan nodes (authored): beside the
 *  water, so each catch is dropped where it is caught instead of walked to the store by the fisher. */
export const FISHER_FLAG_MAX_DISTANCE_NODES = 4;

/** One store's fishing water: the fished shore nearest its door within {@link FISHING_TRIP_RADIUS_NODES}. */
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
  /** The stands nearest their water first, so a warehouse on the shore posts before a distant base. */
  readonly stands: readonly FishingStand[];
  /** The seat's flag fishers; the decision's hires are pushed in and its retirements taken out. */
  readonly fishers: Entity[];
}

/**
 * The seat's fishing stands, one per built store with fished water within a trip of its door, and its
 * flag `fishers`. Null when the content lacks the fisher trade or the map has no terrain.
 */
export function fishingPlan(
  world: World,
  ctx: SystemContext,
  player: number,
  fishers: readonly Entity[],
): FishingPlan | null {
  const terrain = ctx.terrain;
  const job = ctx.content.jobs.find((j) => isFisherJob(ctx.content, j.typeId))?.typeId;
  if (terrain === undefined || job === undefined) return null;
  const index = contentIndex(ctx.content);
  const stands: FishingStand[] = [];
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'storage') continue;
    const door = interactionCell(world, ctx, terrain, e);
    const shore = fishedShoreNear(world, ctx, terrain, player, door);
    if (shore !== null) stands.push({ store: e, door, shore, trip: manhattan(terrain, door, shore) });
  }
  stands.sort((a, b) => a.trip - b.trip || a.store - b.store);
  return { job, terrain, stands, fishers: [...fishers] };
}

/**
 * The first phase keeps every fisher's flag on fished water: a flag whose water ran dry moves to the
 * seat's nearest stand, and its holder is handed back as a builder when no stand is left; a man mid-action
 * is left alone. It then hires one fisher, the top-up phase toward {@link FISHER_TARGET}. A hire is a flag
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
  if (phase === 'first') keepFlagsOnWater(world, ctx, plan, builderJob, taken, commands);
  const want = phase === 'first' ? 1 : FISHER_TARGET;
  for (const stand of plan.stands) {
    while (plan.fishers.length < want) {
      const spot = fisherFlagSpot(world, ctx, plan, stand, taken);
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
  ctx: SystemContext,
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
    const stand = plan.stands[0];
    const spot = stand === undefined ? null : fisherFlagSpot(world, ctx, plan, stand, taken);
    if (spot !== null) {
      commands.push({ kind: 'setWorkFlag', entity: fisher, x: spot.hx, y: spot.hy });
      claimFlagNode(taken, spot);
    } else if (builderJob !== null) {
      commands.push({ kind: 'setJob', entity: fisher, jobType: builderJob });
      plan.fishers.splice(plan.fishers.indexOf(fisher), 1);
    }
  }
}

/** The legal flag node within {@link FISHER_FLAG_MAX_DISTANCE_NODES} of the stand's shore nearest the
 *  store's door, the shore itself first, or null when the bank is blocked. */
function fisherFlagSpot(
  world: World,
  ctx: SystemContext,
  plan: FishingPlan,
  stand: FishingStand,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const shore = plan.terrain.coordsOf(stand.shore);
  const door = plan.terrain.coordsOf(stand.door);
  return nearestRingNode(
    shore.x,
    shore.y,
    0,
    FISHER_FLAG_MAX_DISTANCE_NODES,
    { hx: door.x, hy: door.y },
    legalFlagNodeTest(world, ctx, plan.terrain, taken),
  );
}

/**
 * The nearest shore of a swarm holding fish within {@link FISHING_TRIP_RADIUS_NODES} of the store's `door`
 * that a man can walk to from it, on its ground and inside the seat's signpost reach, or null.
 */
function fishedShoreNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  door: NodeId,
): NodeId | null {
  const at = terrain.coordsOf(door);
  const shores: { node: NodeId; dist: number }[] = [];
  for (const e of fishSwarmsNearNode(
    world,
    at.x,
    at.y,
    FISHING_TRIP_RADIUS_NODES + FISH_SHORE_SEARCH_RADIUS,
  )) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    const dist = manhattan(terrain, door, swarm.shore);
    if (dist <= FISHING_TRIP_RADIUS_NODES) shores.push({ node: swarm.shore, dist });
  }
  if (shores.length === 0) return null;
  shores.sort((a, b) => a.dist - b.dist || a.node - b.node);
  // Terrain components rule out another landmass, the region veto a pocket walled off by buildings or
  // resources; a pocketed door would invert that veto (see RouteRegions.pocketed), so it is dropped there.
  const regions = routeRegions(world, ctx, terrain);
  const veto = regions.pocketed(door) ? null : regions;
  const limit = networkLimitAt(world, terrain, player, at.x, at.y);
  const ground = terrain.componentOf(door);
  for (const shore of shores) {
    if (terrain.componentOf(shore.node) !== ground || veto?.unroutable(door, shore.node) === true) continue;
    if (limit !== null && !limit.allowsNode(shore.node)) continue;
    return shore.node;
  }
  return null;
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
