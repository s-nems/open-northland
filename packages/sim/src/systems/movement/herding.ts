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
 * HerdingSystem - the **follow-the-leader** movement drive for a herding animal.
 *
 * A herd animal that `searchforleader`s carries a {@link HerdMember} pointing at its pack's leader
 * (set once at spawn by the `spawnAnimalHerd` command - the lowest-id member, which points at
 * **itself**). This system keeps the pack together: an idle **follower** that has wandered farther
 * than its `animaltypes.ini` `maximumleaderdistance` from its leader is sent back, walking to a spot
 * BESIDE the leader via the same {@link MoveGoal}→{@link PathRequest}→{@link PathFollow} chain a
 * settler uses. The recall never aims at an occupied field: landing on the leader's own node draws
 * the two sprites as one animal until the graze drive un-stacks them (user feedback), so the target
 * is the nearest {@link RECALL_OFFSETS} spot inside the cohesion radius that no standing animal
 * holds, falling back to the leader's cell only when the whole ring is taken or the radius is too
 * tight for the stander spacing. The **leader itself** (`HerdMember.leader === self`) runs no follow
 * drive, and a **solitary** animal carries no `HerdMember` at all, so it is never visited.
 *
 * A follower is moved only when **idle and at rest**: no {@link CurrentAtomic} running (don't yank a
 * creature out of an attack swing) and not already travelling (no {@link MoveGoal}/{@link PathRequest}/
 * {@link PathFollow} - it is already heading somewhere; re-issuing would fight the planner). So a
 * fighting or already-returning animal is left alone; cohesion is the **idle-default** behaviour, the
 * same precedence the AI planner gives travel.
 *
 * source-basis: the **cohesion radius** is the verbatim extracted `animaltypes.ini` `maximumleaderdistance`
 * param (faithful - *how far* a follower may stray). **Approximated (no oracle):** that a strayed
 * follower walks back to a free spot beside the leader (the original's herd-cohesion AI - flocking
 * offsets, formation, wander-while-near - is the undocumented "soul"); a `maximumleaderdistance` of 0
 * means "stay on the leader's cell", the literal reading of the param. Recorded in source basis.
 *
 * Determinism: no RNG, no wall-clock. Followers are visited in canonical id order because the spot
 * picks consume a shared taken-set - an earlier follower's choice excludes it for later ones. The
 * standing-occupancy set and block overlay are built lazily, only on a tick where some follower
 * actually strays. No-ops without a terrain graph (a mapless sim has no cells to measure leader
 * distance over - the golden is untouched). Inert on the goldens/slice: no entity there carries a
 * `HerdMember`, so the follower scan finds nobody.
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
    // Busy / already travelling: leave it (don't interrupt a swing or fight the navigation planner).
    if (world.has(e, CurrentAtomic)) continue;
    if (isTravelling(world, e)) continue;
    if (world.has(e, Frightened)) continue; // a scattering follower is not pulled back into the scare
    // A workplace visit owns the creature: no recall out of the building (Resting), and none competing
    // with the visit system's walk to the door (LivestockVisit).
    if (world.has(e, Resting) || world.has(e, LivestockVisit)) continue;
    // A leader that has been reaped (killed in combat) is gone - its components are removed, so a
    // follower has no cell to return to; leave it where it stands (the herd is leaderless until a
    // later slice re-designates one).
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

/** Recall landing spots ringing the leader, nearest first: the node-Manhattan-2 diagonals/axials, then
 *  the 3-ring - every spot at least the stander spacing from the leader, in fixed (canonical) order. */
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

/** Where a strayed follower lands: the first {@link RECALL_OFFSETS} spot inside the cohesion radius
 *  that is walkable, reachable from `from`, unblocked, and clear of standing animals and of spots
 *  earlier recalls took this tick. The leader's own cell is the fallback - a radius under the stander
 *  spacing (the literal `maximumleaderdistance 0` reading) or a fully taken ring still recalls. */
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

/** The nodes standing animals hold right now - every {@link StayPoint} creature not walking and not
 *  inside a building - the recall's "occupied field" read (mirrors the wander system's keeper scan). */
function standingAnimalNodes(world: World, terrain: TerrainGraph): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const e of world.query(StayPoint, Settler, Position)) {
    if (world.has(e, Resting) || isTravelling(world, e)) continue;
    nodes.add(entityNode(world, terrain, e));
  }
  return nodes;
}
