import {
  CurrentAtomic,
  Frightened,
  HerdMember,
  LivestockVisit,
  MoveGoal,
  Position,
  Resting,
  Settler,
  StayPoint,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { herdParams } from '../readviews/index.js';
import { canonicalById, entityNode, isTravelling, manhattan } from '../spatial/nodes.js';
import { ANIMAL_SPACING_NODES, nearHeld } from './spacing.js';

/**
 * The follow-the-leader drive: an idle {@link HerdMember} that has strayed farther than its cohesion radius
 * from its leader is sent back to a spot beside it, through the same goal-to-path chain a settler walks. A
 * leader points at itself and follows no one, and a solitary animal carries no `HerdMember`. Only an idle,
 * resting follower is moved, so a swing in progress or an already-travelling animal is left alone.
 *
 * Landing on the leader's own node draws the two sprites as one animal, so the recall aims at the nearest
 * free ring spot and falls back to the leader's cell only when the ring is taken or the radius is too tight.
 *
 * source-basis: the cohesion radius is the verbatim `animaltypes.ini` `maximumleaderdistance`. Approximation:
 * that a strayed follower walks back to a free spot beside the leader, and that a radius of 0 reads literally
 * as standing on the leader's cell.
 *
 * Followers are visited in canonical id order because the spot picks consume a shared taken-set, so an
 * earlier follower's choice excludes it for later ones.
 */
export const herdingSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure leader distance over
  const terrain = ctx.terrain;
  // All lazy: a tick where every follower is home pays only the distance reads.
  let standing: Set<NodeId> | undefined;
  let taken: Set<NodeId> | undefined;
  let blocked: BlockOverlay | undefined;
  for (const e of canonicalById(world.query(HerdMember, Settler, Position))) {
    const leader = world.get(e, HerdMember).leader;
    if (leader === e) continue; // the leader follows no one
    // Busy or already travelling: interrupting would cut a swing short or fight the navigation planner.
    if (world.has(e, CurrentAtomic)) continue;
    if (isTravelling(world, e)) continue;
    if (world.has(e, Frightened)) continue; // a scattering follower is not pulled back into the scare
    // A workplace visit owns the creature: no recall out of the building (Resting), and none competing
    // with the visit system's walk to the door (LivestockVisit).
    if (world.has(e, Resting) || world.has(e, LivestockVisit)) continue;
    // A reaped leader has no Position, so the follower has no cell to return to and stays where it is.
    if (!world.has(leader, Position)) continue;

    const range = herdParams(ctx.content, world.get(e, Settler).tribe)?.leaderDistance ?? 0;
    const here = entityNode(world, terrain, e);
    const leaderCell = entityNode(world, terrain, leader);
    if (manhattan(terrain, here, leaderCell) <= range) continue; // close enough - stay put

    standing ??= standingAnimalNodes(world, terrain);
    taken ??= new Set<NodeId>();
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    world.add(e, MoveGoal, {
      cell: recallSpot(terrain, standing, taken, blocked, here, leaderCell, range),
    });
  }
};

/** Recall landing spots ringing the leader, nearest first and in canonical order: every spot sits at least
 *  the stander spacing away. */
const RECALL_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 1],
  [-2, -1],
  [1, 2],
  [-1, -2],
  [2, -1],
  [-2, 1],
  [-1, 2],
  [1, -2],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

/** Where a strayed follower lands: the first {@link RECALL_OFFSETS} spot inside the cohesion radius that is
 *  walkable, reachable from `from`, unblocked, and clear of standing animals and of spots earlier recalls
 *  took this tick. A radius under the stander spacing or a fully taken ring falls back to the leader's cell,
 *  so a recall always has a target. */
function recallSpot(
  terrain: TerrainGraph,
  standing: ReadonlySet<NodeId>,
  taken: Set<NodeId>,
  blocked: BlockOverlay,
  from: NodeId,
  leaderCell: NodeId,
  range: number,
): NodeId {
  if (range < ANIMAL_SPACING_NODES) return leaderCell; // too tight a radius to hold the spacing
  const at = terrain.coordsOf(leaderCell);
  for (const [dx, dy] of RECALL_OFFSETS) {
    if (Math.abs(dx) + Math.abs(dy) > range) continue;
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const node = terrain.nodeAt(at.x + dx, at.y + dy);
    if (!terrain.isWalkable(node)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(from)) continue;
    if (blocked.has(node)) continue;
    if (nearHeld(terrain, node, standing) || nearHeld(terrain, node, taken)) continue;
    taken.add(node);
    return node;
  }
  return leaderCell;
}

/** The nodes standing animals hold right now: every {@link StayPoint} creature not walking and not inside
 *  a building. */
function standingAnimalNodes(world: World, terrain: TerrainGraph): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const e of world.query(StayPoint, Settler, Position)) {
    if (world.has(e, Resting) || isTravelling(world, e)) continue;
    nodes.add(entityNode(world, terrain, e));
  }
  return nodes;
}
