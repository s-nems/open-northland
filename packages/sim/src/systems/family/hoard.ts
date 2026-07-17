import { Carrying, Position, Residence, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { startDrop } from '../agents/actions.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import { isFood } from '../stores/index.js';
import { deliverHome, fetchFrom } from './food-haul.js';
import type { ExternalFoodIndex } from './food-search.js';
import { builtHomeType, storedFoodUnits } from './households.js';

/**
 * The housewife's hoarding drive — a woman with a home keeps hauling loose/store food into the home
 * larder until its food stock is full (`houses.ini` `logicstock` capacities), independent of any
 * standing child order (user-directed design 2026-07-16: women stock the pantry continuously, not only
 * to conceive). Runs from the AI planner as a woman's work rung — women take no trade, so this is what
 * an idle woman does; the needs drives and the family fences (wedding, child order) still outrank it.
 */

/**
 * Maybe task the idle adult woman `e` with one hoarding step: deliver a held food unit home, or fetch
 * the nearest external unit (the planner tick's shared {@link ExternalFoodIndex} — never another
 * family's larder). Returns true when it took the settler for this tick. A homeless woman, an unbuilt
 * home, a full larder, or a world with no reachable food outside homes leaves her to the planner's
 * remaining rungs. `limit` is her signpost confinement (null = unlimited): a home outside her allowed
 * area suspends the drive entirely, and a source outside it is invisible — the housewife searches only
 * her local circle plus the guidepost network, like every other economy search.
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
  const source = externalFood.nearest(hereNode, limit);
  if (source === null) return false; // nothing to hoard — fall through to idling
  fetchFrom(world, ctx, terrain, e, settler, source, hereNode);
  return true;
}
