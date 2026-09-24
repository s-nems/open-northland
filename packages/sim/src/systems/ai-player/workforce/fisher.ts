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
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isFisherJob } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { manhattan } from '../../spatial/metric.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/** How many fishers the seat keeps while fish swim in reach (authored): the first is hired beside the
 *  first collector posts, the second only as a top-up. */
export const FISHER_TARGET = 2;

interface FishingStore {
  readonly store: Entity;
  readonly door: NodeId;
  readonly seats: number;
  readonly fishers: Entity[];
  readonly fishable: boolean;
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
 * catch as food - with the fishers each employs and whether live fish swim within a fisher's shore
 * search of its door. Null when the content lacks the fisher trade or the map has no terrain.
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
    stores.push({ store: e, door, seats, fishers: [], fishable: fishInReach(world, terrain, door) });
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
 * and walks an idle fisher who strayed out of reach (a meal, a nap) back to his store's door, since a
 * fisher searches for a shore from where he stands; the walk order keeps his post. The top-up phase
 * hires toward {@link FISHER_TARGET}. A man mid-action is left alone.
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
    if (s.fishable) posted += s.fishers.length;
    if (phase === 'topUp') continue;
    for (const e of s.fishers) {
      if (world.has(e, CurrentAtomic)) continue;
      if (!s.fishable) {
        if (builderJob !== null) commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
      } else if (
        !world.has(e, MoveGoal) &&
        !world.has(e, PlayerOrder) &&
        !fishInReach(world, plan.terrain, nodeOf(plan.terrain, world, e))
      ) {
        const door = plan.terrain.coordsOf(s.door);
        commands.push({ kind: 'moveUnit', entity: e, x: door.x, y: door.y });
      }
    }
  }
  const want = phase === 'first' ? 1 : FISHER_TARGET;
  for (const s of plan.stores) {
    if (!s.fishable) continue;
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
