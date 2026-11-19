import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import { type FloodCosts, floodReach } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { floodMayEnter } from './reach.js';
import { signpostMask } from './terrain-reach.js';

/** The hex range of a flood asked only for its costs: its marked area is one unread node. */
const NO_MARKED_AREA = 1;

/**
 * The steps of the shortest walk from `(hx, hy)` to each node at most `steps` away, over the ground a
 * walk reach floods, or null on a spot no walk starts from. Not held: for a caller that asks seldom and
 * over a short walk.
 */
export function walkLengthsFrom(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  steps: number,
): FloodCosts | null {
  if (!floodMayEnter(world, content, terrain, hx, hy)) return null;
  // A flood enters the nodes costing less than its budget.
  const budget = steps + 1;
  const blocked = signpostMask(world, content, terrain).levelled();
  return floodReach(terrain, blocked, hx, hy, NO_MARKED_AREA, budget, false).costs;
}
