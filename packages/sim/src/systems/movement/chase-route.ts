import type { ContentSet } from '@open-northland/data';
import {
  AttackOrder,
  Building,
  Engagement,
  EVERY_PLAYER,
  MoveGoal,
  Owner,
  Palisade,
  PathFollow,
  PathRoute,
  Position,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { hasOpenSide } from '../../nav/nearest.js';
import { findPathWithin, type SearchStats } from '../../nav/pathfinding/index.js';
import { StepFlood } from '../../nav/step-flood.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { hasBodyCollision, playerSlotBit } from './collision/index.js';

/**
 * How many nodes longer than the walk through the bodies a chase's way round them may be and still be
 * taken: a gap between two enemies is walked round, a line is walked up to. Authored: checked against a
 * line holding a gap with the next opening far off, and lone bodies across an open approach.
 */
const CHASE_DETOUR_SLACK_NODES = 12;

/**
 * How many nodes the walk flood for a way round the bodies may visit, past what its depth already bounds.
 * Authored: a cost guard above the open ground {@link CHASE_DETOUR_SLACK_NODES} steps round a short run of
 * bodies covers.
 */
const SIDESTEP_FLOOD_NODES = 512;

/**
 * The settles the search for the way to a stand-in off the route may spend: a fixed allowance plus a share
 * per node of the route. Authored: a cost guard; the stand-in lies beside the crowd the route ends in.
 */
const STAND_IN_ROUTE_BASE_SETTLES = 256;
const STAND_IN_ROUTE_SETTLES_PER_NODE = 8;

/**
 * How many nodes the walk flood for a chaser's stand-in visits before it settles for the best node found, or,
 * with none, the free node of its route nearest the end. Authored: a cost guard, past the nodes a jammed
 * army of a few dozen fills round the end of its walk.
 */
const STAND_IN_FLOOD_NODES = 256;

/**
 * How many walking steps longer than the map distance the walk from the end of a chase's route to its
 * stand-in may be: a node reached round a wall or a corridor's end is not beside the crowd, however near the
 * target it lies. Authored: one step round a body or the target itself, one more for the lattice's slant.
 */
const STAND_IN_DETOUR_STEPS = 2;

/** A node two entities hold this drain. */
const SHARED = -2;

/** One chase request as routing serves it. */
export interface ChaseAsk {
  readonly asker: Entity;
  /** The asker's player. */
  readonly player: number;
  readonly start: NodeId;
  /** The node its stand-in is ranked by nearness to: the unit it chases, else the goal it asked for. */
  readonly toward: NodeId;
  /** `start` when the asker stands on it, the node it may stay on however crowded; else undefined. */
  readonly ownNode: NodeId | undefined;
  /** The walls it routes by: the walk block, or a march's plan with the enemy gates closed. */
  readonly structures: BlockOverlay;
  /** {@link structures} and the standing bodies of every player at war with the asker. */
  readonly bodies: BlockOverlay;
  /** {@link structures} and every standing body. */
  readonly occupied: BlockOverlay;
}

/** What a drain hands its chase requests: the stand-ins it already dealt and the doorways no one waits in. */
export interface ChaseDrainView {
  readonly world: World;
  readonly content: ContentSet;
  /** The drain's requests, ascending id, as it started. */
  readonly requests: readonly Entity[];
  readonly standIns: ReadonlySet<NodeId>;
  readonly doorways: ReadonlySet<NodeId>;
}

/**
 * Owner rule: a chase never takes the long way round bodies it fights. Its route follows the walls and the
 * bodies it cannot fight its way through, walks round the ones it fights only when that costs a few nodes
 * more ({@link CHASE_DETOUR_SLACK_NODES}), and otherwise ends before the first of them; where that end, or
 * the goal, is no node to rest on, it ends on a free node beside it ({@link standIn}). One drain's state,
 * emptied by {@link begin}.
 */
export class ChaseStands {
  /** The nodes chases were routed to this drain. */
  private readonly ends = new Set<NodeId>();
  private readonly flood: StepFlood;
  /** Per node, who stands still on it asking this drain or walks a route there: an entity, or
   *  {@link SHARED}, and the slot bits of the players it is held from. Valid where {@link heldStamp} holds
   *  {@link stamp}. */
  private readonly heldBy: Int32Array;
  private readonly heldFrom: Uint16Array;
  private readonly heldStamp: Int32Array;
  private stamp = 0;
  private heldFilled = false;
  private view: ChaseDrainView | undefined;

  constructor(readonly terrain: TerrainGraph) {
    this.flood = new StepFlood(terrain);
    this.heldBy = new Int32Array(terrain.nodeCount);
    this.heldFrom = new Uint16Array(terrain.nodeCount);
    this.heldStamp = new Int32Array(terrain.nodeCount);
  }

  begin(view: ChaseDrainView): void {
    this.view = view;
    if (this.ends.size > 0) this.ends.clear();
    this.stamp += 1;
    this.heldFilled = false;
  }

  /** `direct`, the route under the walls and the bodies the asker does not fight, made the chase's route;
   *  null when it is null. */
  route(ask: ChaseAsk, direct: readonly NodeId[] | null, spent: SearchStats): readonly NodeId[] | null {
    if (direct === null) return null;
    let path = direct;
    let reachesGoal = true;
    let slack = CHASE_DETOUR_SLACK_NODES;
    for (let body = firstBodyOn(path, ask.bodies, 1); body > 0; ) {
      const around = this.sidestep(ask, path, body, slack, spent);
      if (around === null) {
        path = path.slice(0, body);
        reachesGoal = false;
        break;
      }
      path = around.path;
      slack -= around.extra;
      body = firstBodyOn(path, ask.bodies, Math.max(1, around.past));
    }
    const end = path[path.length - 1] as NodeId;
    const fits = end === ask.ownNode || (reachesGoal ? this.untaken(end, ask) : this.restable(end, ask));
    const routed = fits ? path : this.routeTo(ask, path, this.standIn(ask, path, end, spent), spent);
    this.ends.add(routed[routed.length - 1] as NodeId);
    return routed;
  }

  /**
   * `path` with the run of bodies from index `body` walked round, when the walk round from the node before
   * the run to the node past it is at most `slack` steps longer than through it; null when there is none, or
   * the run reaches the goal. `past` is the index after the node past the run, 0 when the walk round came
   * back through that node and loop removal cut it out; each node the flood reaches is charged to `spent`
   * as a settle.
   */
  private sidestep(
    ask: ChaseAsk,
    path: readonly NodeId[],
    body: number,
    slack: number,
    spent: SearchStats,
  ): { path: NodeId[]; extra: number; past: number } | null {
    const before = body - 1;
    let after = body;
    while (after < path.length && ask.bodies.has(path[after] as NodeId)) after++;
    if (after === path.length) return null;
    const through = after - before;
    const exit = path[after] as NodeId;
    const { flood } = this;
    flood.begin(path[before] as NodeId, ask.bodies);
    let steps = 0;
    while (
      steps < through + slack &&
      flood.order.length < SIDESTEP_FLOOD_NODES &&
      !flood.reached(exit) &&
      flood.nextLevel()
    )
      steps++;
    spent.explored += flood.order.length;
    if (!flood.reached(exit)) return null;
    const round = flood.walkTo(exit);
    const spliced = withoutLoops([...path.slice(0, before), ...round, ...path.slice(after + 1)]);
    return { path: spliced, extra: Math.max(0, steps - through), past: spliced.indexOf(exit) + 1 };
  }

  /**
   * The node the asker may rest on nearest {@link ChaseAsk.toward} among those the walk from `end` reaches
   * directly, stepping through friends and never through an enemy body or a wall; ties go to the shorter
   * walk, then the lower id. Past the flood's cap with none, the free node of `path` nearest its end. Each node
   * the flood reaches is charged to `spent` as a settle.
   */
  private standIn(ask: ChaseAsk, path: readonly NodeId[], end: NodeId, spent: SearchStats): NodeId {
    const { flood, terrain } = this;
    const ex = terrain.xOf(end);
    const ey = terrain.yOf(end);
    const tx = terrain.xOf(ask.toward);
    const ty = terrain.yOf(ask.toward);
    const endToward = hexDistanceBetween(ex, ey, tx, ty);
    let best: NodeId | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestSteps = 0;
    flood.begin(end, ask.bodies);
    for (let steps = 1; flood.order.length < STAND_IN_FLOOD_NODES && flood.nextLevel(); steps++) {
      // A direct walk this long ends at least this far from `toward`, so no later level can do better.
      if (steps - STAND_IN_DETOUR_STEPS - endToward >= bestDist) break;
      for (let i = flood.levelStart; i < flood.levelEnd; i++) {
        const node = flood.order.at(i);
        const x = terrain.xOf(node);
        const y = terrain.yOf(node);
        if (steps > hexDistanceBetween(ex, ey, x, y) + STAND_IN_DETOUR_STEPS) continue;
        const d = hexDistanceBetween(tx, ty, x, y);
        const better =
          d < bestDist || (d === bestDist && steps === bestSteps && best !== undefined && node < best);
        if (!better || !this.restable(node, ask)) continue;
        best = node;
        bestDist = d;
        bestSteps = steps;
      }
    }
    spent.explored += flood.order.length;
    return best ?? this.backAlong(ask, path);
  }

  /** The route to `stand`: `path` cut there when it passes it, else a short search round the bodies. */
  private routeTo(
    ask: ChaseAsk,
    path: readonly NodeId[],
    stand: NodeId,
    spent: SearchStats,
  ): readonly NodeId[] {
    const on = path.indexOf(stand);
    if (on >= 0) return path.slice(0, on + 1);
    const cap = STAND_IN_ROUTE_BASE_SETTLES + STAND_IN_ROUTE_SETTLES_PER_NODE * path.length;
    const found = findPathWithin(this.terrain, ask.start, stand, ask.bodies, spent, cap);
    if (typeof found !== 'string') return found;
    return path.slice(0, path.indexOf(this.backAlong(ask, path)) + 1);
  }

  /** The node of `path` nearest its end, the end excluded, the asker may rest on; its start when none. */
  private backAlong(ask: ChaseAsk, path: readonly NodeId[]): NodeId {
    for (let i = path.length - 2; i > 0; i--) {
      const node = path[i] as NodeId;
      if (this.restable(node, ask)) return node;
    }
    return path[0] as NodeId;
  }

  /** Whether no other body stands on `node` or is routed there this drain, and no friend walks a route
   *  there: chasers of two sides may meet head-on, as the melee slots let them. */
  private untaken(node: NodeId, ask: ChaseAsk): boolean {
    if (node === ask.ownNode) return true;
    const view = this.view;
    if (view === undefined || ask.occupied.has(node)) return false;
    if (this.ends.has(node) || view.standIns.has(node)) return false;
    if (!this.heldFilled) this.fillHeld();
    if (this.heldStamp[node] !== this.stamp) return true;
    return ((this.heldFrom[node] ?? 0) & playerSlotBit(ask.player)) === 0 || this.heldBy[node] === ask.asker;
  }

  /** {@link untaken}, outside a doorway, with an open side to step off it by. */
  private restable(node: NodeId, ask: ChaseAsk): boolean {
    if (node === ask.ownNode) return true;
    if (!this.untaken(node, ask) || this.view?.doorways.has(node) === true) return false;
    return hasOpenSide(this.terrain, node, ask.structures);
  }

  /** Mark the nodes standing colliders that ask this drain stand on, which the standing bodies leave out,
   *  held from every side, and the ends of the routes chasers walk, held from their own side. */
  private fillHeld(): void {
    this.heldFilled = true;
    const view = this.view;
    if (view === undefined) return;
    const { world, content } = view;
    const terrain = this.terrain;
    for (let i = 0; i < view.requests.length; i++) {
      const e = view.requests[i] as Entity;
      if (!world.isAlive(e) || world.has(e, PathFollow) || !hasBodyCollision(world, content, e)) continue;
      const p = world.tryGet(e, Position);
      if (p === undefined) continue;
      const hx = nodeHxOfPosition(p.x, p.y);
      const hy = nodeHyOfPosition(p.x, p.y);
      if (terrain.inBounds(hx, hy)) this.hold(terrain.nodeAt(hx, hy), e, EVERY_PLAYER);
    }
    const engagements = world.canonicalQuery(Engagement, MoveGoal);
    for (let i = 0; i < engagements.length; i++) {
      const e = engagements[i] as Entity;
      if (!world.has(e, PathFollow)) continue;
      const goal = world.get(e, MoveGoal).cell;
      if (world.get(e, PathRoute).waypoints.at(-1)?.node !== goal) continue;
      const owner = world.tryGet(e, Owner)?.player;
      if (owner !== undefined) this.hold(goal, e, playerSlotBit(owner));
    }
  }

  private hold(node: NodeId, e: Entity, from: number): void {
    if (this.heldStamp[node] !== this.stamp) {
      this.heldStamp[node] = this.stamp;
      this.heldBy[node] = e;
      this.heldFrom[node] = from;
    } else {
      if (this.heldBy[node] !== e) this.heldBy[node] = SHARED;
      this.heldFrom[node] = (this.heldFrom[node] ?? 0) | from;
    }
  }
}

/** The node of the unit `e` chases, which its stand-in is ranked round so a crowd wraps it from every side;
 *  undefined when it chases a building, a wall or nothing. */
export function chasedUnitNode(world: World, terrain: TerrainGraph, e: Entity): NodeId | undefined {
  const target = world.tryGet(e, Engagement)?.target ?? world.tryGet(e, AttackOrder)?.target;
  if (target === undefined || world.has(target, Building) || world.has(target, Palisade)) return undefined;
  const p = world.tryGet(target, Position);
  if (p === undefined) return undefined;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  return terrain.inBounds(hx, hy) ? terrain.nodeAt(hx, hy) : undefined;
}

/** The index of the first node of `path` from index `from` that `bodies` blocks, or -1. */
function firstBodyOn(path: readonly NodeId[], bodies: BlockOverlay, from: number): number {
  for (let i = from; i < path.length; i++) if (bodies.has(path[i] as NodeId)) return i;
  return -1;
}

/** `path` with every stretch that comes back to a node it passed cut out. */
function withoutLoops(path: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const at = new Map<NodeId, number>();
  for (const node of path) {
    const seen = at.get(node);
    if (seen !== undefined) {
      for (let i = seen + 1; i < out.length; i++) at.delete(out[i] as NodeId);
      out.length = seen + 1;
      continue;
    }
    at.set(node, out.length);
    out.push(node);
  }
  return out;
}
