import { fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import {
  latticeOffsetDistance,
  latticeOffsetFloor,
  type NodeId,
  nodeLatticeDistance,
  type TerrainGraph,
  type Traversal,
} from '../terrain/index.js';
import { findPathWithin, type SearchStats } from './find-path.js';
import { nodeMarksOf } from './node-marks.js';

/**
 * The settle cap of each short search on or off a shared corridor. A leg that needs more is no short
 * hop, so the caller routes the walker on its own. Authored: far above an open hop across a group's area,
 * far below a march's own search.
 */
const CORRIDOR_LEG_MAX_EXPLORED = 2048;

/** How many nodes a leg onto or off a corridor may run, and the settle cap of its search. */
export interface CorridorEntry {
  readonly hopNodes: number;
  readonly legMaxExplored: number;
}

/**
 * A route from `start` to `goal` that borrows `corridor`, a path already routed under the same `blocked`
 * overlay: a short search onto the corridor node nearest `start`, the corridor itself, and a short search
 * off the corridor node nearest `goal`. Not the lowest-cost route, only one within the two hops of it.
 * Returns `null` when either nearest node lies more than its hop (Manhattan half-cell nodes) away,
 * when either hop fails, runs past its settle cap or is no straight hop, or when the two nearest nodes
 * leave no stretch of corridor to share.
 */
export function joinCorridor(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats,
  maxHopNodes: number,
  traversal: Traversal = 'land',
): NodeId[] | null {
  const lattice = corridorLattice(graph, corridor);
  // No corridor node lies nearer `start` in Manhattan nodes than the corridor's bounding box does.
  if (manhattanOutside(lattice, graph.xOf(start), graph.yOf(start)) > maxHopNodes) return null;
  // Only the corridor's own start can be blocked, by the walker-exempt rule; no hop may end there.
  const board = nearestStop(graph, lattice, corridor, start, 0, blocked);
  if (board === undefined || manhattanNodes(graph, start, board.node) > maxHopNodes) return null;
  const exit = nearestStop(graph, lattice, corridor, goal, board.index, blocked);
  if (exit === undefined || exit.index === board.index) return null;
  if (manhattanNodes(graph, exit.node, goal) > maxHopNodes) return null;
  const onto = findPathWithin(graph, start, board.node, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED, traversal);
  if (typeof onto === 'string' || !isHop(graph, onto)) return null;
  const off = findPathWithin(graph, exit.node, goal, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED, traversal);
  if (typeof off === 'string' || !isHop(graph, off)) return null;
  return joinedLegs(graph, onto, lattice, corridor, board.index + 1, exit.index, off);
}

/** The index of `node` on a loop-free `corridor`, or undefined off it. */
export function corridorIndexOf(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  node: NodeId,
): number | undefined {
  return corridorLattice(graph, corridor).indexOf.get(node);
}

/**
 * A route to `goal` that takes up `corridor` where `onto` ends: `onto`, a searched path whose last node
 * lies on the corridor, the corridor from there to its node nearest `goal`, and a search off it. Returns
 * `null` when `onto` ends off the corridor, when that nearest node lies more than `maxHopNodes` from the
 * goal, or when the way off runs past `exit.legMaxExplored` settles or is neither a straight hop nor
 * within `exit.hopNodes` nodes long: by a goal among bodies and walls the straight distance is a few
 * nodes and a fair way round is several times that.
 */
export function followCorridor(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  onto: readonly NodeId[],
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats,
  maxHopNodes: number,
  exit: CorridorEntry,
  traversal: Traversal = 'land',
): NodeId[] | null {
  const lattice = corridorLattice(graph, corridor);
  const met = onto.at(-1);
  const at = met === undefined ? undefined : lattice.indexOf.get(met);
  if (at === undefined) return null;
  const last = nearestStop(graph, lattice, corridor, goal, at, blocked);
  if (last === undefined || manhattanNodes(graph, last.node, goal) > maxHopNodes) return null;
  const off = findPathWithin(graph, last.node, goal, blocked, stats, exit.legMaxExplored, traversal);
  if (typeof off === 'string' || (off.length > exit.hopNodes && !isHop(graph, off))) return null;
  // The corridor stretch runs from the node after the meeting up to the last one, which opens `off`;
  // with the last one at the meeting, `off` repeats that one node and the loop cut drops it.
  return joinedLegs(graph, onto, lattice, corridor, at + 1, Math.max(at + 1, last.index), off);
}

/** Manhattan half-cell nodes from `node` to `corridor`'s bounding box, 0 inside it: no corridor node lies
 *  nearer. */
export function corridorBoxGap(graph: TerrainGraph, corridor: readonly NodeId[], node: NodeId): number {
  return manhattanOutside(corridorLattice(graph, corridor), graph.xOf(node), graph.yOf(node));
}

/** {@link nearestStop} over a corridor's cached lattice: the unblocked node at or after `from` nearest
 *  `target`, the earliest on a tie. A test seam: it pins the block skip against a linear scan, which the
 *  outcome of {@link joinCorridor} cannot isolate. */
export function nearestCorridorStop(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  target: NodeId,
  from: number,
  blocked: BlockOverlay,
): { readonly index: number; readonly node: NodeId } | undefined {
  return nearestStop(graph, corridorLattice(graph, corridor), corridor, target, from, blocked);
}

/**
 * Whether `leg` walks at most twice the straight lattice distance between its ends. A leg that has to go
 * round a wall to reach its stop drags the walker away from its own way and back, a detour its own search
 * would never take; a sidestep round a body stays within the bound.
 */
function isHop(graph: TerrainGraph, leg: readonly NodeId[]): boolean {
  const [from] = leg;
  const to = leg.at(-1);
  if (from === undefined || to === undefined) return false;
  const straight = nodeLatticeDistance(graph, from, to);
  let walked = fx.fromInt(0);
  leg.forEach((node, i) => {
    const previous = leg[i - 1];
    if (previous !== undefined) walked = fx.add(walked, nodeLatticeDistance(graph, previous, node));
  });
  return walked <= fx.add(straight, straight);
}

function manhattanNodes(graph: TerrainGraph, a: NodeId, b: NodeId): number {
  return Math.abs(graph.xOf(a) - graph.xOf(b)) + Math.abs(graph.yOf(a) - graph.yOf(b));
}

interface CorridorStop {
  readonly index: number;
  readonly node: NodeId;
}

/** Corridor nodes per block whose bounding box lets {@link nearestStop} skip the block whole. Authored:
 *  a block spans at most twice this many lattice steps, short against a march and long against a scan. */
const STOP_BLOCK_NODES = 32;

/** A block's box fields, in order, within {@link CorridorLattice.blocks}. */
const BLOCK_MIN_X = 0;
const BLOCK_MAX_X = 1;
const BLOCK_MIN_Y = 2;
const BLOCK_MAX_Y = 3;
const BLOCK_FIELDS = 4;

/** A corridor's node coordinates and bounding boxes, read once per corridor rather than per joining walker. */
interface CorridorLattice {
  readonly xs: Int32Array;
  readonly ys: Int32Array;
  /** Per {@link STOP_BLOCK_NODES} block: min x, max x, min y, max y. */
  readonly blocks: Int32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** No node repeats, so no stretch of the corridor holds a loop of its own. */
  readonly loopFree: boolean;
  /** Each node's index, exact when {@link loopFree}. */
  readonly indexOf: ReadonlyMap<NodeId, number>;
}

/** Keyed by the corridor array, which a caller never mutates once routed. */
const lattices = new WeakMap<readonly NodeId[], CorridorLattice>();

function corridorLattice(graph: TerrainGraph, corridor: readonly NodeId[]): CorridorLattice {
  const held = lattices.get(corridor);
  if (held !== undefined) return held;
  const indexOf = new Map<NodeId, number>();
  const xs = new Int32Array(corridor.length);
  const ys = new Int32Array(corridor.length);
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < corridor.length; i++) {
    const node = corridor[i];
    if (node === undefined) continue;
    if (!indexOf.has(node)) indexOf.set(node, i);
    const x = graph.xOf(node),
      y = graph.yOf(node);
    xs[i] = x;
    ys[i] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const blocks = new Int32Array(Math.ceil(corridor.length / STOP_BLOCK_NODES) * BLOCK_FIELDS);
  for (let block = 0; block * STOP_BLOCK_NODES < corridor.length; block++) {
    const first = block * STOP_BLOCK_NODES;
    const last = Math.min(corridor.length, first + STOP_BLOCK_NODES);
    let bMinX = xs[first] ?? 0,
      bMaxX = bMinX,
      bMinY = ys[first] ?? 0,
      bMaxY = bMinY;
    for (let i = first + 1; i < last; i++) {
      const x = xs[i] ?? 0,
        y = ys[i] ?? 0;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }
    const at = block * BLOCK_FIELDS;
    blocks[at + BLOCK_MIN_X] = bMinX;
    blocks[at + BLOCK_MAX_X] = bMaxX;
    blocks[at + BLOCK_MIN_Y] = bMinY;
    blocks[at + BLOCK_MAX_Y] = bMaxY;
  }
  const lattice = {
    xs,
    ys,
    blocks,
    minX,
    maxX,
    minY,
    maxY,
    loopFree: indexOf.size === corridor.length,
    indexOf,
  };
  lattices.set(corridor, lattice);
  return lattice;
}

/** Manhattan nodes from (x, y) to the corridor's bounding box, 0 inside it. */
function manhattanOutside(lattice: CorridorLattice, x: number, y: number): number {
  const dx = Math.max(0, lattice.minX - x, x - lattice.maxX);
  const dy = Math.max(0, lattice.minY - y, y - lattice.maxY);
  return dx + dy;
}

/** No corridor index: {@link nearestStop} has found no stop yet. */
const NO_STOP = -1;

/** The unblocked corridor node at or after index `from` nearest `target` by lattice distance, then by
 *  sideways offset in quarter columns, since a climb across rows drifts sideways for free; the earliest on
 *  a tie. Only a node nearer than the best so far is asked of `blocked`: an overlay's answers are pure. A
 *  block whose box can hold no nearer node is skipped whole. */
function nearestStop(
  graph: TerrainGraph,
  lattice: CorridorLattice,
  corridor: readonly NodeId[],
  target: NodeId,
  from: number,
  blocked: BlockOverlay,
): CorridorStop | undefined {
  const x = graph.xOf(target);
  const y = graph.yOf(target);
  const { xs, ys, blocks } = lattice;
  let best = NO_STOP;
  let bestDistance = fx.fromInt(0);
  let bestSideways = 0;
  for (let index = from; index < corridor.length; ) {
    if (best !== NO_STOP && index % STOP_BLOCK_NODES === 0) {
      const at = (index / STOP_BLOCK_NODES) * BLOCK_FIELDS;
      const ax = Math.max(0, (blocks[at + BLOCK_MIN_X] ?? 0) - x, x - (blocks[at + BLOCK_MAX_X] ?? 0));
      const ay = Math.max(0, (blocks[at + BLOCK_MIN_Y] ?? 0) - y, y - (blocks[at + BLOCK_MAX_Y] ?? 0));
      const floor = latticeOffsetFloor(ax, ay);
      if (floor > bestDistance || (floor === bestDistance && Math.max(0, 2 * ax - 1) >= bestSideways)) {
        index += STOP_BLOCK_NODES;
        continue;
      }
    }
    const dx = (xs[index] ?? 0) - x;
    const dy = (ys[index] ?? 0) - y;
    const distance = latticeOffsetDistance(dx, dy, y);
    const sideways = Math.abs(2 * dx + ((y + dy) & 1) - (y & 1));
    const node = corridor[index];
    index++;
    if (
      best !== NO_STOP &&
      (distance > bestDistance || (distance === bestDistance && sideways >= bestSideways))
    )
      continue;
    if (node === undefined || blocked.has(node)) continue;
    best = index - 1;
    bestDistance = distance;
    bestSideways = sideways;
  }
  const node = corridor[best];
  return node === undefined ? undefined : { index: best, node };
}

/**
 * {@link withoutLoops} of `onto`, `corridor[from..to)` and `off`. The searched legs are loop-free, so when
 * the corridor is too and no node lies in two parts, the joined route is their plain concatenation and
 * the long corridor stretch is never indexed; the legs' nodes are looked up in the corridor's own index.
 */
function joinedLegs(
  graph: TerrainGraph,
  onto: readonly NodeId[],
  lattice: CorridorLattice,
  corridor: readonly NodeId[],
  from: number,
  to: number,
  off: readonly NodeId[],
): NodeId[] {
  const onStretch = (node: NodeId): boolean => {
    const at = lattice.indexOf.get(node);
    return at !== undefined && at >= from && at < to;
  };
  const legs = new Set<NodeId>(onto);
  const shared =
    !lattice.loopFree || off.some((node) => legs.has(node)) || onto.some(onStretch) || off.some(onStretch);
  const joined = new Array<NodeId>(onto.length + (to - from) + off.length);
  let at = 0;
  for (const node of onto) joined[at++] = node;
  for (let i = from; i < to; i++) {
    const node = corridor[i];
    if (node !== undefined) joined[at++] = node;
  }
  for (const node of off) joined[at++] = node;
  joined.length = at;
  return shared ? withoutLoops(graph, joined) : joined;
}

/** `path` with every revisit cut back to the node's first visit, so a hop that crosses the corridor
 *  elsewhere never walks out and back. Neighbours stay lattice neighbours. */
function withoutLoops(graph: TerrainGraph, path: readonly NodeId[]): NodeId[] {
  const marks = nodeMarksOf(graph);
  const kept = marks.next();
  const out: NodeId[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (node === undefined) continue;
    if (marks.stamps[node] !== kept) {
      marks.stamps[node] = kept;
      marks.values[node] = out.length;
      out.push(node);
      continue;
    }
    const cut = (marks.values[node] ?? 0) + 1;
    for (let j = cut; j < out.length; j++) marks.stamps[out[j] ?? 0] = 0;
    out.length = cut;
  }
  return out;
}
