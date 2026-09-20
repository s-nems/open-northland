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
import { demandedHomeQualityGoods, homeQualityAllowed, homeQualityUse } from './home-quality.js';
import { builtHomeType, storedFoodUnits } from './households.js';
import type { ExternalQualityIndex } from './quality-search.js';

/**
 * The housewife's hoarding drive - a woman with a home hauls food into its larder and the configured
 * durable household wares into its quality pools.
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
  externalQuality: ExternalQualityIndex,
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
  const settler = world.get(e, Settler);
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const load = world.tryGet(e, Carrying);
  if (load !== undefined && load.amount > 0) {
    const quality = homeQualityUse(ctx, load.goodType);
    if (
      (!isFood(ctx, load.goodType) && quality === undefined) ||
      (quality !== undefined && !homeQualityAllowed(world, home, quality.effect))
    ) {
      startDrop(world, ctx, e); // free her hands without consuming a forbidden in-flight household good
      return true;
    }
    deliverHome(world, ctx, terrain, e, settler, home, hereNode);
    return true;
  }
  const owner = ownerOf(world, e);
  const avoid = unreachableGoalVeto(world, ctx, e);
  const foodSource =
    storedFoodUnits(world, ctx, home) < capacity ? externalFood.nearest(hereNode, owner, limit, avoid) : null;
  const demanded = demandedHomeQualityGoods(world, ctx, e, home);
  const qualitySource =
    demanded.size > 0 ? externalQuality.nearest(hereNode, owner, demanded, limit, avoid) : null;
  const source = nearerSource(world, hereNode, foodSource, qualitySource);
  if (source === null) return false; // nothing to hoard, so fall through to idling
  fetchFrom(world, ctx, terrain, e, settler, source, hereNode);
  return true;
}

/** The original searches one candidate set containing food and household goods. Reproduce its observable
 * nearest-source result; entity id breaks an exact distance tie. */
function nearerSource(
  world: World,
  from: { hx: number; hy: number },
  a: { store: Entity; goodType: number } | null,
  b: { store: Entity; goodType: number } | null,
): { store: Entity; goodType: number } | null {
  if (a === null) return b;
  if (b === null) return a;
  const rank = (source: { store: Entity }): readonly [number, number] => {
    const p = world.get(source.store, Position);
    const node = nodeOfPosition(p.x, p.y);
    return [Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy), source.store];
  };
  const ar = rank(a);
  const br = rank(b);
  return ar[0] < br[0] || (ar[0] === br[0] && ar[1] <= br[1]) ? a : b;
}
