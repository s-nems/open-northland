import type { BlockOverlay } from '../block-overlay.js';
import { NodeList } from '../node-list.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../terrain/index.js';
import {
  FLOOD_GUARD_MAX_EXPLORED,
  findPath,
  GOAL_EXHAUST_MAX_EXPLORED,
  POCKET_PROBE_MAX_EXPLORED,
  RACE_SLICE_EXPLORED,
  type SearchStats,
} from './find-path.js';

/** Pockets remembered at once; a new one evicts the oldest. Authored: a siege seals a few interiors. */
const MAX_POCKETS = 8;

/** Uint8 pocket ids; 0 marks a node no remembered pocket covers. */
const NO_POCKET = 0;

/** How far past its remembered size a pocket's flood may grow before the goal reads as no longer sealed.
 *  Authored: bodies stepping in and out move a sealed interior's size by a few nodes, an opened gate by
 *  the whole outside. */
const POCKET_GROWTH_FACTOR = 2;

/** A remembered pocket's open nodes and the blocked nodes that bordered them. */
interface Pocket {
  readonly region: readonly NodeId[];
  readonly seal: readonly NodeId[];
}

/** The largest visit stamp before the stamps wrap and are cleared. */
const MAX_STAMP = 0x7fffffff;

/**
 * Land goals {@link findPath} recently refuted with a full race, so a repeat refusal is proved by two plain
 * floods instead of both searches. Each asking overlay is flooded afresh: the goal's region is what the
 * goal-side search would settle, and a start outside it whose own region outlasts the forward settles
 * that size fixes is refused at exactly the settle count the search would charge `stats`, so a budget
 * keyed on them cuts alike. Remembered pockets only pick which goals try the floods, so one instance
 * serves the askers that share a view of the walls, such as one player's walkers.
 */
export class SealedPockets {
  /** Each node's pocket id, sized to the map on the first remembered pocket: most askers never remember
   *  one, and a map-sized pair per player and mode adds up. */
  private pocketAt = new Uint8Array(0);
  /** The blocked nodes bordering each pocket when it was remembered, by the same ids. A node may border
   *  two; the later one keeps it. Sized with {@link pocketAt}. */
  private sealAt = new Uint8Array(0);
  /** Each remembered pocket's nodes, by id. */
  private readonly pockets: Array<Pocket | undefined> = [];
  /** Pocket ids in the order they were remembered, oldest first. */
  private readonly order: number[] = [];
  private readonly stamps: FloodStamps;
  private readonly queue = new NodeList();
  private readonly steps = new StepBuffer();

  constructor(readonly terrain: TerrainGraph) {
    this.stamps = floodStampsOf(terrain);
  }

  /** {@link findPath} over land, a refusal of a remembered pocket's goal proved without searching. */
  findPath(
    start: NodeId,
    goal: NodeId,
    blocked: BlockOverlay,
    stats: SearchStats,
    goalSlice: number,
  ): NodeId[] | null {
    const settles = this.refusal(start, goal, blocked, goalSlice);
    if (settles !== null) {
      stats.explored += settles;
      return null;
    }
    const before = stats.explored;
    const path = findPath(this.terrain, start, goal, blocked, stats, 'land', goalSlice);
    const charged = stats.explored - before;
    if (path === null && charged > FLOOD_GUARD_MAX_EXPLORED) this.remember(start, goal, blocked, charged);
    return path;
  }

  /** The settles {@link findPath} would charge refusing this request, or null to search instead. */
  private refusal(start: NodeId, goal: NodeId, blocked: BlockOverlay, goalSlice: number): number | null {
    const id = this.pocketAt[goal] ?? NO_POCKET;
    if (id === NO_POCKET) return null;
    const remembered = this.pockets[id];
    if (remembered === undefined) return null;
    // The search's own early answers, which settle nothing, stay with it.
    const { terrain } = this;
    if (start === goal || !terrain.isWalkable(start) || blocked.size === 0 || blocked.has(goal)) return null;
    if (terrain.componentOf(start) !== terrain.componentOf(goal)) return null;
    // A walker inside the pocket or on its seal, a body that stood there, proves nothing about the seal:
    // its search runs and the pocket stays.
    if (this.pocketAt[start] === id || this.sealAt[start] === id) return null;
    const size = this.goalRegion(start, goal, blocked, remembered.region.length * POCKET_GROWTH_FACTOR);
    if (size === null) {
      this.forget(id);
      return null;
    }
    const forward = forwardSettles(size, goalSlice);
    if (forward === null || !this.outlasts(start, blocked, forward)) return null;
    return size + forward;
  }

  /**
   * The size of the region the goal-side search settles: every node reachable from `goal` over open
   * steps, `start` readmitted as that search's target. Null once it reaches `start` or exceeds `limit`.
   * Leaves the region in {@link queue} and the blocked nodes bordering it in `seal`.
   */
  private goalRegion(
    start: NodeId,
    goal: NodeId,
    blocked: BlockOverlay,
    limit: number,
    seal?: NodeId[],
  ): number | null {
    const { queue, steps, terrain } = this;
    const mark = this.stamps.next();
    const seen = this.stamps.seen;
    queue.clear();
    queue.push(goal);
    seen[goal] = mark;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      terrain.stepsInto(queue.at(cursor), undefined, steps);
      for (let i = 0; i < steps.length; i++) {
        const next = steps.nodeAt(i);
        if (next === start) return null;
        if (seen[next] === mark) continue;
        seen[next] = mark;
        if (blocked.has(next)) {
          seal?.push(next);
          continue;
        }
        queue.push(next);
        if (queue.length > limit) return null;
      }
    }
    return queue.length;
  }

  /** Whether the region a search from `start` floods holds more than `settles` nodes. */
  private outlasts(start: NodeId, blocked: BlockOverlay, settles: number): boolean {
    const { queue, steps, terrain } = this;
    const mark = this.stamps.next();
    const seen = this.stamps.seen;
    queue.clear();
    queue.push(start);
    seen[start] = mark;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      terrain.stepsInto(queue.at(cursor), blocked, steps);
      for (let i = 0; i < steps.length; i++) {
        const next = steps.nodeAt(i);
        if (seen[next] === mark) continue;
        seen[next] = mark;
        queue.push(next);
        if (queue.length > settles) return true;
      }
    }
    return false;
  }

  /** Remember the pocket a refusal of `goal` charging `charged` settles exhausted, when the goal side
   *  refuted it: then the pocket holds at most what the forward side's flood guard left of the charge. */
  private remember(start: NodeId, goal: NodeId, blocked: BlockOverlay, charged: number): void {
    const seal: NodeId[] = [];
    const limit = Math.min(charged - FLOOD_GUARD_MAX_EXPLORED, GOAL_EXHAUST_MAX_EXPLORED);
    const size = this.goalRegion(start, goal, blocked, limit, seal);
    if (size === null || forwardSettles(size, RACE_SLICE_EXPLORED) === null) return;
    const region = this.queue.nodes.slice(0, size);
    if (this.pocketAt.length === 0) {
      this.pocketAt = new Uint8Array(this.terrain.nodeCount);
      this.sealAt = new Uint8Array(this.terrain.nodeCount);
    }
    for (const node of region) {
      const held = this.pocketAt[node] ?? NO_POCKET;
      if (held !== NO_POCKET) this.forget(held);
    }
    if (this.order.length >= MAX_POCKETS) {
      const oldest = this.order[0];
      if (oldest !== undefined) this.forget(oldest);
    }
    let id = 1;
    while (this.pockets[id] !== undefined) id++;
    for (const node of region) this.pocketAt[node] = id;
    for (const node of seal) this.sealAt[node] = id;
    this.pockets[id] = { region, seal };
    this.order.push(id);
  }

  private forget(id: number): void {
    const pocket = this.pockets[id];
    if (pocket === undefined) return;
    for (const node of pocket.region) if (this.pocketAt[node] === id) this.pocketAt[node] = NO_POCKET;
    for (const node of pocket.seal) if (this.sealAt[node] === id) this.sealAt[node] = NO_POCKET;
    this.pockets[id] = undefined;
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
  }
}

/** Per-node visit stamps for one terrain's floods. Floods run synchronously, so every instance shares
 *  them. */
class FloodStamps {
  readonly seen: Int32Array;
  private stamp = 0;

  constructor(nodeCount: number) {
    this.seen = new Int32Array(nodeCount);
  }

  next(): number {
    if (this.stamp === MAX_STAMP) {
      this.seen.fill(0);
      this.stamp = 0;
    }
    this.stamp += 1;
    return this.stamp;
  }
}

const stampsByTerrain = new WeakMap<TerrainGraph, FloodStamps>();

function floodStampsOf(terrain: TerrainGraph): FloodStamps {
  let stamps = stampsByTerrain.get(terrain);
  if (stamps === undefined) {
    stamps = new FloodStamps(terrain.nodeCount);
    stampsByTerrain.set(terrain, stamps);
  }
  return stamps;
}

/**
 * The forward settles {@link findPath} spends refusing a goal sealed in a region of `size` nodes while the
 * start's region outlasts them: the flood guard, then one race slice per goal-side slice the region does
 * not exhaust. Null when the pocket probe refutes it alone or the goal side would stop at its cap.
 */
function forwardSettles(size: number, goalSlice: number): number | null {
  if (size <= POCKET_PROBE_MAX_EXPLORED) return null;
  let goalSide = POCKET_PROBE_MAX_EXPLORED;
  let forward = FLOOD_GUARD_MAX_EXPLORED;
  for (;;) {
    const target = Math.min(goalSide + goalSlice, GOAL_EXHAUST_MAX_EXPLORED);
    if (size <= target) return forward;
    if (target >= GOAL_EXHAUST_MAX_EXPLORED) return null;
    goalSide = target;
    forward += RACE_SLICE_EXPLORED;
  }
}
