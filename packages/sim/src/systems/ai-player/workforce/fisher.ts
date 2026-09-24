import {
  Building,
  CurrentAtomic,
  FishSwarm,
  JobAssignment,
  MoveGoal,
  PlayerOrder,
  Position,
  Settler,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { FISH_SHORE_SEARCH_RADIUS } from '../../economy/fish.js';
import { routeRegions } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isFisherJob } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { manhattan } from '../../spatial/metric.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from '../build-order/entries.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/** How many fishers the seat keeps while fish swim in reach (authored): the first is hired beside the
 *  first collector posts, the second only as a top-up. */
export const FISHER_TARGET = 2;

/** How far from its store's door a seat sends a fisher to a shore, in Manhattan nodes (authored): as far
 *  as the seat builds from its base, plus the fisher's own shore search from there. */
export const FISHING_TRIP_RADIUS_NODES = BUILD_SEARCH_MAX_RADIUS_NODES + FISH_SHORE_SEARCH_RADIUS;

interface FishingStore {
  readonly store: Entity;
  readonly door: NodeId;
  readonly seats: number;
  readonly fishers: Entity[];
  /** Where an idle fisher out of reach of any fish is walked: the door while fish swim within his search
   *  from it, else the nearest fished shore within {@link FISHING_TRIP_RADIUS_NODES}; null when neither. */
  readonly stand: NodeId | null;
}

/** The seat's fishing posts for one decision, shared by both hiring phases so a first-phase hire counts
 *  toward the top-up. */
export interface FishingPlan {
  readonly job: number;
  readonly terrain: TerrainGraph;
  readonly stores: readonly FishingStore[];
}

/**
 * The seat's built stores that offer fisher seats - the headquarters and warehouses do, and bank the
 * catch as food - with the fishers each employs and each store's fishing stand. Null when the content
 * lacks the fisher trade or the map has no terrain.
 */
export function fishingPlan(world: World, ctx: SystemContext, player: number): FishingPlan | null {
  const terrain = ctx.terrain;
  const job = ctx.content.jobs.find((j) => isFisherJob(ctx.content, j.typeId))?.typeId;
  if (terrain === undefined || job === undefined) return null;
  const index = contentIndex(ctx.content);
  const stores: FishingStore[] = [];
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind !== 'storage') continue;
    const seats = type.workers.find((w) => w.jobType === job)?.count ?? 0;
    if (seats <= 0) continue;
    const door = interactionCell(world, ctx, terrain, e);
    stores.push({
      store: e,
      door,
      seats,
      fishers: [],
      stand: fishingStand(world, ctx, terrain, player, door),
    });
  }
  if (stores.length === 0) return null;
  for (const e of ownedSettlers(world, player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace === undefined || !isFisherJob(ctx.content, world.get(e, Settler).jobType)) continue;
    stores.find((s) => s.store === workplace)?.fishers.push(e);
  }
  return { job, terrain, stores };
}

/**
 * The first phase hires one fisher, hands the fishers of a store whose water ran dry back as builders,
 * and walks an idle fisher out of reach of any fish (back from banking a catch, a meal, a nap) to his
 * store's fishing stand, since a fisher searches for a shore from where he stands; the walk order keeps
 * his post. The top-up phase hires toward {@link FISHER_TARGET}. A man mid-action is left alone.
 */
export function allocateFishers(
  world: World,
  ctx: SystemContext,
  plan: FishingPlan | null,
  force: SpareForce,
  builderJob: number | null,
  phase: 'first' | 'topUp',
): PlayerCommand[] {
  if (plan === null) return [];
  const commands: PlayerCommand[] = [];
  let posted = 0;
  for (const s of plan.stores) {
    if (s.stand !== null) posted += s.fishers.length;
    if (phase === 'topUp') continue;
    for (const e of s.fishers) {
      if (world.has(e, CurrentAtomic)) continue;
      if (s.stand === null) {
        if (builderJob !== null) commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
      } else if (
        !world.has(e, MoveGoal) &&
        !world.has(e, PlayerOrder) &&
        !fishInReach(world, plan.terrain, nodeOf(plan.terrain, world, e))
      ) {
        const stand = plan.terrain.coordsOf(s.stand);
        commands.push({ kind: 'moveUnit', entity: e, x: stand.x, y: stand.y });
      }
    }
  }
  const want = phase === 'first' ? 1 : FISHER_TARGET;
  // Stores nearest their water hire first, so a warehouse on the shore staffs before a distant base.
  const byTrip = plan.stores
    .flatMap((s) => (s.stand === null ? [] : [{ s, trip: manhattan(plan.terrain, s.door, s.stand) }]))
    .sort((a, b) => a.trip - b.trip || a.s.store - b.s.store);
  for (const { s } of byTrip) {
    for (let seated = s.fishers.length; seated < s.seats && posted < want; seated++) {
      const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', plan.job));
      if (spare === null) return commands;
      commands.push({ kind: 'assignWorker', entity: spare, building: s.store, jobPriority: [plan.job] });
      s.fishers.push(spare);
      posted++;
    }
  }
  return commands;
}

function nodeOf(terrain: TerrainGraph, world: World, e: Entity): NodeId {
  const at = world.get(e, Position);
  const node = nodeOfPosition(at.x, at.y);
  return terrain.nodeAtClamped(node.hx, node.hy);
}

/**
 * Where a fisher of the store at `door` fishes from: the door itself while fish swim within his search of
 * it, else the nearest shore of a swarm holding fish within {@link FISHING_TRIP_RADIUS_NODES} that a man
 * can walk to from the door, on its ground and inside the seat's signpost reach.
 */
function fishingStand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  door: NodeId,
): NodeId | null {
  if (fishInReach(world, terrain, door)) return door;
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
 *  Manhattan rings. An emptied swarm never refills, so a dry store stays dry. */
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
