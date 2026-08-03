import { Carrying, ownerOf, Position, Residence, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { isFood } from '../readviews/index.js';
import { startDrop } from '../settlers/atomics/start.js';
import { unreachableGoalVeto } from '../settlers/unreachable-goals.js';
import type { NavigationLimit } from '../signposts/index.js';
import { deliverHome, fetchFrom } from './food-haul.js';
import type { ExternalFoodIndex } from './food-search.js';
import { builtHomeType, storedFoodUnits } from './households.js';

/**
 * The housewife's hoarding drive - a woman with a home hauls loose and stored food into the home larder
 * until its food stock is full (`houses.ini` `logicstock` capacities), independent of any standing child
 * order. Authored: women stock the pantry continuously, not only to conceive.
 */

/**
 * Maybe task the idle adult woman `e` with one hoarding step, returning true when it took her for this
 * tick. `limit` is her signpost confinement (null when unlimited): a home outside her allowed area
 * suspends the drive entirely, and a source outside it is invisible.
 */
export function planWomanHoard(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  externalFood: ExternalFoodIndex,
  limit: NavigationLimit | null,
): boolean {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined) return false;
  const homeType = builtHomeType(world, ctx, home);
  if (homeType === undefined) return false;
  if (limit !== null && terrain !== undefined) {
    const inode = interactionNode(world, ctx, home);
    if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return false;
  }
  const capacity = homeType.stock.reduce(
    (sum, slot) => (isFood(ctx, slot.goodType) ? sum + slot.capacity : sum),
    0,
  );
  if (storedFoodUnits(world, ctx, home) >= capacity) return false;
  const settler = world.get(e, Settler);
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const load = world.tryGet(e, Carrying);
  if (load !== undefined && load.amount > 0) {
    if (!isFood(ctx, load.goodType)) {
      startDrop(world, ctx, e); // free her hands of a non-food load first
      return true;
    }
    deliverHome(world, ctx, terrain, e, settler, home, hereNode);
    return true;
  }
  const source = externalFood.nearest(hereNode, ownerOf(world, e), limit, unreachableGoalVeto(world, ctx, e));
  if (source === null) return false; // nothing to hoard, so fall through to idling
  fetchFrom(world, ctx, terrain, e, settler, source, hereNode);
  return true;
}
