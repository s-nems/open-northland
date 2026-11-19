import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import { NO_WALK } from '../../nav/node-circle.js';
import {
  enteredCost,
  type FloodCosts,
  floodReach,
  HEX_DX_EVEN,
  HEX_DX_ODD,
  HEX_DY,
  NOT_ENTERED,
} from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { floodMayEnter } from './reach.js';
import { signpostMask } from './terrain-reach.js';

/** The hex range of a flood asked only for its costs: its marked area is one unread node. */
const NO_MARKED_AREA = 1;

export { NO_WALK };

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

/** The steps to `(x, y)` in `lengths`, or to a node no walk stands on from the nearest neighbour one does,
 *  or {@link NO_WALK}. */
export function walkLengthTo(lengths: FloodCosts, x: number, y: number): number {
  const own = enteredCost(lengths, x, y);
  if (own !== NOT_ENTERED) return own;
  let beside = NOT_ENTERED;
  const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
  for (let k = 0; k < HEX_DY.length; k++) {
    const cost = enteredCost(lengths, x + (dxs[k] as number), y + (HEX_DY[k] as number));
    if (cost < beside) beside = cost;
  }
  return beside === NOT_ENTERED ? NO_WALK : beside + 1;
}
