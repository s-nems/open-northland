import type { BlockOverlay } from './block-overlay.js';
import { ringSearch } from './ring-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * How many nodes {@link nearestUnblockedNode} visits around a blocked anchor before giving up.
 * Authored: a search-cost guard sized to ring several bodies deep around a crowded target, or to step a
 * click that landed on a footprint out to its walkable edge.
 */
export const NEAREST_NODE_SEARCH_CAP = 64;

const NO_CLAIMS: ReadonlySet<NodeId> = new Set();

/**
 * The nearest node to `from` that is neither walk-blocked (`blocked`) nor already claimed (`claimed`),
 * bounded by `cap` (default {@link NEAREST_NODE_SEARCH_CAP}).
 *
 * The search traverses blocked nodes, leaving reachability to the follow-up A*, so the free node behind
 * a rank of bodies is a fine anchor. `claimed` nodes are traversed but never returned, so two callers
 * aiming at one crowded spot fan out to different free nodes.
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
