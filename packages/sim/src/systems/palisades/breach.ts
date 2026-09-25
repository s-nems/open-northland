import {
  AttackOrder,
  Engagement,
  Palisade,
  PalisadeBlocking,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexNeighboursOf, nodeOfPosition } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding/index.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import { isValidOrderedTarget } from '../conflict/targeting.js';
import type { SystemContext } from '../context.js';
import { translatedCells } from '../footprint/geometry.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { manhattan } from '../spatial/metric.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * Turn a player-driven walk that walls block into an attack on the wall barring it, reporting whether it
 * did. `resume` is the ordered target to go back to once the wall falls; for an attack-move it is null and
 * the march resumes instead. A further wall behind is found the same way. Project rule: soldiers ordered
 * past a sealed palisade break through it rather than giving up.
 */
export function breakThroughWall(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  route: { readonly start: NodeId; readonly goal: NodeId },
  resume: Entity | null,
): boolean {
  const breach = palisadeBarring(world, ctx, terrain, e, route.start, route.goal);
  if (breach === null) return false;
  clearNavState(world, e);
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  if (resume === null && march !== undefined)
    world.mut(e, PlayerOrder).attackMove = { ...march, resume: true };
  world.add(e, AttackOrder, { target: breach.wall, breach: { resume, stand: breach.stand } });
  world.add(e, Engagement, { repathAt: ctx.tick });
  return true;
}

/**
 * A wall fell: every breach order lets go, so a squad chopping several posts walks through the first gap
 * instead of felling the rest. An ordered attack returns to its target; a march resumes and finds the next
 * wall itself if the gap does not open the way. Costs the standing attack orders, once per fallen wall.
 */
export function releaseWallBreaches(world: World, ctx: SystemContext): void {
  const released: { e: Entity; resume: Entity | null }[] = [];
  for (const e of world.query(AttackOrder)) {
    const breach = world.get(e, AttackOrder).breach;
    if (breach !== undefined) released.push({ e, resume: breach.resume });
  }
  for (const { e, resume } of released) {
    if (resume !== null && world.isAlive(resume)) {
      world.add(e, AttackOrder, { target: resume });
      world.add(e, Engagement, { repathAt: ctx.tick });
    } else {
      world.remove(e, AttackOrder);
    }
  }
}

/** A wall to break and the node to break it from, or null when no free one was found on the near side. */
export interface Breach {
  readonly wall: Entity;
  readonly stand: NodeId | null;
}

/**
 * The wall segment `e` must break to reach `goal` from `start`, and where to stand: the first wall it may
 * attack on the route that treats every such wall as open ground, or a joined segment further along the
 * line when the first one's near-side nodes are all taken. Null when walls are not what blocks the way: the
 * goal is reachable as it is, out of reach for another reason, or barred only by walls `e` may not attack.
 * Costs the standing walls and a few searches.
 */
export function palisadeBarring(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  start: NodeId,
  goal: NodeId,
): Breach | null {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return null;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  // A route refused over a crowd or a far-off chase target is not a wall's doing.
  if (findPath(terrain, start, goal, blocked) !== null) return null;
  const wallAt = new Map<NodeId, Entity>();
  for (const wall of canonicalById(world.query(PalisadeBlocking, Palisade, Position))) {
    if (!isValidOrderedTarget(world, ctx, e, settler, wall)) continue;
    const at = world.get(wall, Position);
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    for (const cell of translatedCells(terrain, world.get(wall, Palisade).walk, hx, hy)) {
      if (!wallAt.has(cell)) wallAt.set(cell, wall);
    }
  }
  if (wallAt.size === 0) return null;
  const breachable: BlockOverlay = {
    has: (node) => !wallAt.has(node) && blocked.has(node),
    get size() {
      return blocked.size;
    },
  };
  const path = findPath(terrain, start, goal, breachable);
  if (path === null) return null;
  const hit = firstWallOn(terrain, blocked, wallAt, path);
  if (hit === null) return null;
  const line: BreachLine = { terrain, blocked, wallAt, first: hit.wall, approach: hit.approach };
  return spreadAlongLine(world, line, e, { start, goal });
}

/** The first wall on `path` and the node the path reaches it from. */
function firstWallOn(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  wallAt: ReadonlyMap<NodeId, Entity>,
  path: readonly NodeId[],
): { readonly wall: Entity; readonly approach: NodeId } | null {
  for (let at = 0; at < path.length; at++) {
    const node = path[at];
    if (node === undefined) continue;
    const wall = wallAt.get(node);
    if (wall !== undefined) return { wall, approach: path[at - 1] ?? node };
    const next = path[at + 1];
    if (next === undefined) continue;
    const squeezed = postSqueezedPast(terrain, blocked, wallAt, node, next);
    if (squeezed !== null) return { wall: squeezed, approach: node };
  }
  return null;
}

interface BreachLine {
  readonly terrain: TerrainGraph;
  readonly blocked: BlockOverlay;
  readonly wallAt: ReadonlyMap<NodeId, Entity>;
  readonly first: Entity;
  /** Where the route meets the line: the near side the breakers gather on. */
  readonly approach: NodeId;
}

/** How many joints along the line from the first wall on the route a squad spreads its breakers. */
const BREACH_SPREAD = 8;
/** How far from the line the near-side walk reaches, in lattice steps: past a post's own neighbours to the
 *  row behind them, so the walk follows the line round its turns and seals. */
const NEAR_SIDE_REACH = 2;
/** Neighbours shown not to open the way before a breaker settles on the first wall. */
const BREACH_PROBES = 2;

/**
 * One breaker to a node: the nearest free near-side node beside the first wall, else beside the nearest
 * joined segment that also opens the way to the goal, so a squad fells the line along its length instead of
 * queueing at one post. The near side is walked from where the route meets the line, so a node on the far
 * side, which no route reaches, is never dealt. Project rule. Costs the standing breach orders, a walk along
 * the line near the first wall, and up to {@link BREACH_PROBES} failed searches.
 */
function spreadAlongLine(
  world: World,
  line: BreachLine,
  breaker: Entity,
  route: { readonly start: NodeId; readonly goal: NodeId },
): Breach {
  const { terrain, blocked, wallAt, first, approach } = line;
  const held = new Set<NodeId>();
  for (const e of world.query(AttackOrder)) {
    const stand = world.get(e, AttackOrder).breach?.stand;
    if (e !== breaker && stand !== undefined && stand !== null) held.add(stand);
  }

  const cellsOf = new Map<Entity, NodeId[]>();
  for (const [cell, wall] of wallAt) {
    const cells = cellsOf.get(wall);
    if (cells === undefined) cellsOf.set(wall, [cell]);
    else cells.push(cell);
  }
  const joints = new Map<Entity, number>([[first, 0]]);
  const walls: Entity[] = [first];
  for (let at = 0; at < walls.length; at++) {
    const wall = walls[at];
    if (wall === undefined) continue;
    const depth = joints.get(wall) ?? 0;
    if (depth >= BREACH_SPREAD) continue;
    for (const cell of cellsOf.get(wall) ?? []) {
      const { x, y } = terrain.coordsOf(cell);
      for (const n of hexNeighboursOf(x, y)) {
        if (!terrain.inBounds(n.hx, n.hy)) continue;
        const next = wallAt.get(terrain.nodeAt(n.hx, n.hy));
        if (next === undefined || joints.has(next)) continue;
        joints.set(next, depth + 1);
        walls.push(next);
      }
    }
  }

  const nearLine = (node: NodeId): boolean => {
    for (const wall of walls) {
      for (const cell of cellsOf.get(wall) ?? []) {
        if (manhattan(terrain, node, cell) <= NEAR_SIDE_REACH) return true;
      }
    }
    return false;
  };
  const nearSide = [approach];
  const seen = new Set<NodeId>(nearSide);
  const steps = new StepBuffer();
  for (let at = 0; at < nearSide.length; at++) {
    const node = nearSide[at];
    if (node === undefined) continue;
    terrain.stepsInto(node, blocked, steps);
    for (let i = 0; i < steps.length; i++) {
      const next = steps.at(i).node;
      if (seen.has(next) || !nearLine(next)) continue;
      seen.add(next);
      nearSide.push(next);
    }
  }

  const byApproach = (a: NodeId, b: NodeId): number =>
    manhattan(terrain, a, approach) - manhattan(terrain, b, approach) || a - b;
  const ranked = [...walls].sort((a, b) => (joints.get(a) ?? 0) - (joints.get(b) ?? 0) || a - b);
  let probes = 0;
  for (const wall of ranked) {
    const cells = cellsOf.get(wall) ?? [];
    const free = nearSide
      .filter((node) => !held.has(node) && cells.some((cell) => manhattan(terrain, node, cell) === 1))
      .sort(byApproach);
    const stand = free[0];
    if (stand === undefined) continue;
    if (wall !== first) {
      if (probes >= BREACH_PROBES) break;
      if (!opensWay(line, cells, route)) {
        probes++;
        continue;
      }
    }
    return { wall, stand };
  }
  return { wall: first, stand: null };
}

/** Whether breaking the wall on `cells` alone opens a route from `start` to `goal`. */
function opensWay(
  line: BreachLine,
  cells: readonly NodeId[],
  route: { readonly start: NodeId; readonly goal: NodeId },
): boolean {
  const { blocked } = line;
  const through: BlockOverlay = {
    has: (node) => !cells.includes(node) && blocked.has(node),
    get size() {
      return blocked.size;
    },
  };
  return findPath(line.terrain, route.start, route.goal, through) !== null;
}

/**
 * A diagonal step passes between its two midpoint flanks and may cross a wall line without standing on it:
 * with both flanks closed it is a joint the walls-open route slipped through, and the lower-id wall of the
 * two is the one in the way.
 */
function postSqueezedPast(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  wallAt: ReadonlyMap<NodeId, Entity>,
  from: NodeId,
  to: NodeId,
): Entity | null {
  const a = terrain.coordsOf(from);
  const c = terrain.coordsOf(to);
  if (Math.abs(c.y - a.y) !== 2) return null;
  const row = (a.y + c.y) / 2;
  const flanks = [terrain.nodeAt(a.x, row), terrain.nodeAt(c.x, row)];
  if (!flanks.every((flank) => blocked.has(flank) || !terrain.isWalkable(flank))) return null;
  let post: Entity | null = null;
  for (const flank of flanks) {
    const wall = wallAt.get(flank);
    if (wall !== undefined && (post === null || wall < post)) post = wall;
  }
  return post;
}
