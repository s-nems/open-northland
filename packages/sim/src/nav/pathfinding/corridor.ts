import { fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import { latticeDistanceTo, type NodeId, nodeLatticeDistance, type TerrainGraph } from '../terrain/index.js';
import { findPathWithin, type SearchStats } from './find-path.js';

/**
 * The settle cap of each short search on or off a shared corridor. A leg that needs more is no short
 * hop, so the caller routes the walker on its own. Authored: far above an open hop across a group's area,
 * far below a march's own search.
 */
const CORRIDOR_LEG_MAX_EXPLORED = 2048;

/**
 * A route from `start` to `goal` that borrows `corridor`, a path already routed under the same `blocked`
 * overlay: a short search onto the corridor node nearest `start`, the corridor itself, and a short search
 * off the corridor node nearest `goal`. Not the lowest-cost route, only one within the two hops of it.
 * Returns `null` when either nearest node lies more than `maxHopNodes` (Manhattan half-cell nodes) away,
 * when either hop fails, runs past {@link CORRIDOR_LEG_MAX_EXPLORED} or is no straight hop, or when the
 * two nearest nodes leave no stretch of corridor to share.
 */
export function joinCorridor(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  start: NodeId,
  goal: NodeId,
  blocked: BlockOverlay,
  stats: SearchStats,
  maxHopNodes: number,
): NodeId[] | null {
  // Only the corridor's own start can be blocked, by the walker-exempt rule; no hop may end there.
  const entry = nearestStop(graph, corridor, start, 0, blocked);
  if (entry === undefined || manhattanNodes(graph, start, entry.node) > maxHopNodes) return null;
  const exit = nearestStop(graph, corridor, goal, entry.index, blocked);
  if (exit === undefined || exit.index === entry.index) return null;
  if (manhattanNodes(graph, exit.node, goal) > maxHopNodes) return null;
  const onto = findPathWithin(graph, start, entry.node, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED);
  if (typeof onto === 'string' || !isHop(graph, onto)) return null;
  const off = findPathWithin(graph, exit.node, goal, blocked, stats, CORRIDOR_LEG_MAX_EXPLORED);
  if (typeof off === 'string' || !isHop(graph, off)) return null;
  return withoutLoops([...onto, ...corridor.slice(entry.index + 1, exit.index), ...off]);
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

/** The unblocked corridor node at or after index `from` nearest `target`, the earliest on a tie. */
function nearestStop(
  graph: TerrainGraph,
  corridor: readonly NodeId[],
  target: NodeId,
  from: number,
  blocked: BlockOverlay,
): CorridorStop | undefined {
  const x = graph.xOf(target);
  const y = graph.yOf(target);
  let best: CorridorStop | undefined;
  let bestDistance = fx.fromInt(0);
  corridor.forEach((node, index) => {
    if (index < from || blocked.has(node)) return;
    const distance = latticeDistanceTo(graph, x, y, node);
    if (best === undefined || distance < bestDistance) {
      best = { index, node };
      bestDistance = distance;
    }
  });
  return best;
}

/** `path` with every revisit cut back to the node's first visit, so a hop that crosses the corridor
 *  elsewhere never walks out and back. Neighbours stay lattice neighbours. */
function withoutLoops(path: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const indexOf = new Map<NodeId, number>();
  for (const node of path) {
    const seen = indexOf.get(node);
    if (seen === undefined) {
      indexOf.set(node, out.length);
      out.push(node);
      continue;
    }
    for (const dropped of out.splice(seen + 1)) indexOf.delete(dropped);
  }
  return out;
}
