import { NO_WALK, type WalkLengths } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { closer, hexNodeDistance, manhattan, nearestCell } from './metric.js';

/** Added to the Manhattan distance of a cell the measured walk does not reach: above every walk length. */
export const BEYOND_WALK = NO_WALK + 1;

/** Two steps into the next rows cross two rows and one column, three nodes of Manhattan distance, and the
 *  column may fall to the first of them. */
const ROW_PAIR_STEPS = 2;
const ROW_PAIR_SPAN = 3;
const FIRST_STEP_EXTRA_SPAN = 1;

/** What a nearest-candidate search ranks from: a node, by Manhattan distance, or a walk, by its steps from
 *  the node it is measured from. */
export type RankFrom = NodeId | WalkLengths;

/** The node `rank` ranks from. */
export function rankOrigin(rank: RankFrom): NodeId {
  return typeof rank === 'number' ? rank : rank.from;
}

/** The walk `rank` ranks by, or undefined to rank by Manhattan distance. */
export function rankWalk(rank: RankFrom): WalkLengths | undefined {
  return typeof rank === 'number' ? undefined : rank;
}

/**
 * The length a nearest-candidate search ranks `cell` at, `span` Manhattan nodes from the ranking origin:
 * that distance, or under `walk` the steps of the walk there. A cell the walk does not reach, one a
 * confinement allows through a signpost group alone, ranks after every cell it does, by distance.
 * Project rule: the original takes the first hit of its own flood.
 *
 * `within` is the length a search already holds: a longer one is only known to be longer, which is all a
 * search dropping it needs.
 */
export function rankLength(
  walk: WalkLengths | undefined,
  cell: NodeId,
  span: number,
  within = Number.POSITIVE_INFINITY,
): number {
  if (walk === undefined) return span;
  const steps = walk.stepsTo(cell, within);
  return steps === NO_WALK ? BEYOND_WALK + span : steps;
}

/** The Manhattan distance a walk of `steps` covers at most. */
export function farthestSpan(steps: number): number {
  return Math.floor((ROW_PAIR_SPAN * steps + FIRST_STEP_EXTRA_SPAN) / ROW_PAIR_STEPS);
}

/** The least length a cell `span` Manhattan nodes from the origin can rank at: for a search that knows
 *  only how far a candidate lies, not where. */
export function leastRankLength(walk: WalkLengths | undefined, span: number): number {
  if (walk === undefined) return span;
  return Math.max(0, Math.ceil((ROW_PAIR_STEPS * span - FIRST_STEP_EXTRA_SPAN) / ROW_PAIR_SPAN));
}

/** The least length `cell`, `span` Manhattan nodes from the origin, can rank at, read without the walk's
 *  flood: no walk is shorter than the hex distance. */
export function leastRankLengthTo(
  terrain: TerrainGraph,
  walk: WalkLengths | undefined,
  cell: NodeId,
  span: number,
): number {
  return walk === undefined ? span : hexNodeDistance(terrain, walk.from, cell);
}

/** The Manhattan distance from the origin past which no cell ranks at `length` or under. */
export function rankSweepRadius(walk: WalkLengths | undefined, length: number): number {
  if (walk === undefined) return length;
  if (length < BEYOND_WALK) return farthestSpan(length);
  // Every walked cell ranks under an unwalked one, however far a walk of the greatest length strays.
  return Math.max(length - BEYOND_WALK, farthestSpan(walk.maxSteps));
}

/** {@link nearestCell} from `rank` by rank length, with the same `(length, id)` tie-break and lazy
 *  `accept`. */
export function nearestRankedCell(
  terrain: TerrainGraph,
  rank: RankFrom,
  candidates: readonly NodeId[],
  accept?: (cell: NodeId) => boolean,
): NodeId | null {
  const from = rankOrigin(rank);
  const walk = rankWalk(rank);
  if (walk === undefined) return nearestCell(terrain, candidates, from, accept);
  let best: NodeId | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const cell of candidates) {
    const span = manhattan(terrain, from, cell);
    if (!closer(leastRankLengthTo(terrain, walk, cell, span), cell, bestLength, bestCell)) continue;
    if (accept !== undefined && !accept(cell)) continue;
    const length = rankLength(walk, cell, span, bestLength);
    if (!closer(length, cell, bestLength, bestCell)) continue;
    best = cell;
    bestLength = length;
    bestCell = cell;
  }
  return best;
}
