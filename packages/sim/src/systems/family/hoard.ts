import type { BuildingType, ContentSet } from '@open-northland/data';
import {
  Building,
  Carrying,
  ownerOf,
  Position,
  Residence,
  Settler,
  Stockpile,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { homeWareStock } from '../../inspect/home-capacity.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { isFood } from '../readviews/index.js';
import { startDrop } from '../settlers/atomics/start.js';
import { hasRoom } from '../settlers/drives/economy/store-policy.js';
import { liftLostWalk } from '../settlers/lost-way.js';
import { unreachableCellVeto } from '../settlers/targets/index.js';
import { unreachableGoals } from '../settlers/unreachable-goals.js';
import { landReachAt, type NavigationLimit } from '../signposts/index.js';
import type { SupplyTally } from '../stores/index.js';
import { deliverHome, fetchFrom, HAUL_LIFT_UNITS } from './food-haul.js';
import type { ExternalFoodIndex } from './food-search.js';
import {
  demandedHomeQualityGoods,
  homeQualityAllowed,
  homeQualityUse,
  homeQualityValue,
} from './home-quality.js';
import { builtHomeType, storedFoodUnits } from './households.js';
import type { ExternalQualityIndex } from './quality-search.js';

/**
 * The housewife's hoarding drive - a woman with a home hauls food into its larder and the configured
 * durable household wares into its quality pools.
 */

/**
 * Maybe task the idle adult woman `e` with one hoarding step, returning true when it took her for this
 * tick. `limit` is her signpost confinement (null when unlimited, when her land bounds her instead): a
 * home outside her reach suspends the drive entirely, and a source outside it is invisible.
 */
export function planWomanHoard(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  externalFood: ExternalFoodIndex,
  externalQuality: ExternalQualityIndex,
  /** Live pickup claims: the trip she sets out on claims the unit she will lift. */
  supply: SupplyTally,
  limit: NavigationLimit | null,
): boolean {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined) return false;
  const homeType = builtHomeType(world, ctx, home);
  if (homeType === undefined) return false;
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  // Her signpost area, else her own land: a home or a source across water is out of her reach.
  const reach =
    terrain === undefined
      ? null
      : (limit ?? landReachAt(terrain, terrain.nodeAtClamped(hereNode.hx, hereNode.hy)));
  if (reach !== null && terrain !== undefined) {
    const inode = interactionNode(world, ctx, home);
    if (inode !== null && !reach.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return false;
  }
  const settler = world.get(e, Settler);
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
    const level = world.get(home, Building).level;
    const qualityRoom =
      quality !== undefined &&
      level >= quality.minimumHomeLevel &&
      homeQualityValue(world, home, quality.effect) < homeWareStock(quality, level).capacity;
    if (!qualityRoom && (!world.has(home, Stockpile) || !hasRoom(world, ctx, home, load.goodType)))
      return false;
    deliverHome(world, ctx, terrain, e, settler, home, hereNode);
    return true;
  }
  const owner = ownerOf(world, e);
  // A source she provably cannot walk to is no source. The failed-goal memo alone holds a few cells for
  // under a minute, so among more buried piles than that she would walk at them for good.
  const avoid =
    terrain === undefined
      ? undefined
      : unreachableCellVeto(world, ctx, terrain, e, terrain.nodeAtClamped(hereNode.hx, hereNode.hy));
  const larderFull = storedFoodUnits(world, ctx, home) >= larderCapacity(ctx, homeType);
  const foodSource = larderFull ? null : externalFood.nearest(hereNode, owner, home, reach, avoid);
  const demanded = demandedHomeQualityGoods(world, ctx, e, home);
  const qualitySource =
    demanded.size > 0 ? externalQuality.nearest(hereNode, owner, demanded, reach, avoid) : null;
  const source = nearerSource(world, hereNode, foodSource, qualitySource);
  if (source === null) {
    // No walk is left for her to be lost on, unless the one she just failed is what hides her source.
    if (unreachableGoals(world, ctx, e) === null) liftLostWalk(world, e);
    return false; // nothing to hoard, so fall through to idling
  }
  supply.stampPickupClaim(e, { source: source.store, goodType: source.goodType, amount: HAUL_LIFT_UNITS });
  fetchFrom(world, ctx, terrain, e, settler, source, hereNode);
  return true;
}

/** The food units a home type's larder slots hold, kept per content set and building type. */
const larderCapacities = new WeakMap<ContentSet, Map<BuildingType, number>>();

function larderCapacity(ctx: SystemContext, homeType: BuildingType): number {
  let byType = larderCapacities.get(ctx.content);
  if (byType === undefined) {
    byType = new Map();
    larderCapacities.set(ctx.content, byType);
  }
  let capacity = byType.get(homeType);
  if (capacity === undefined) {
    capacity = 0;
    for (const slot of homeType.stock) if (isFood(ctx, slot.goodType)) capacity += slot.capacity;
    byType.set(homeType, capacity);
  }
  return capacity;
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
  const da = distanceTo(world, from, a.store);
  const db = distanceTo(world, from, b.store);
  return da < db || (da === db && a.store <= b.store) ? a : b;
}

function distanceTo(world: World, from: { hx: number; hy: number }, store: Entity): number {
  const p = world.get(store, Position);
  return Math.abs(nodeHxOfPosition(p.x, p.y) - from.hx) + Math.abs(nodeHyOfPosition(p.x, p.y) - from.hy);
}
