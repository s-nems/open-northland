import type { BlockOverlay } from './block-overlay.js';
import { ringSearch } from './ring-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * How far (in nodes) {@link nearestUnblockedNode} searches for a free node around a blocked/unwalkable
 * anchor before giving up — enough to ring several bodies deep around a crowded target, or to step a
 * click that landed on a resource/building footprint out to the walkable edge of it. Tuning bound
 * (a search-cost guard), not data-pinned.
 */
export const NEAREST_NODE_SEARCH_CAP = 64;

const NO_CLAIMS: ReadonlySet<NodeId> = new Set();

/**
 * The nearest node to `from` that is neither walk-blocked (`blocked`) nor already claimed (`claimed`),
 * bounded by `cap` (default {@link NEAREST_NODE_SEARCH_CAP}).
 *
 * The search TRAVERSES blocked nodes (the free node behind a rank of bodies, or just past a resource
 * footprint, is a fine anchor — whether it is actually reachable is the follow-up A*'s job); `claimed`
 * nodes are traversed but never returned, so two callers aiming at one crowded spot fan out to
 * DIFFERENT free nodes.
 */
export function nearestUnblockedNode(
  terrain: TerrainGraph,
  from: NodeId,
  blocked: BlockOverlay,
  claimed: ReadonlySet<NodeId> = NO_CLAIMS,
  cap: number = NEAREST_NODE_SEARCH_CAP,
): NodeId | null {
  return ringSearch(terrain, from, cap, { accept: (n) => !blocked.has(n) && !claimed.has(n) });
}
