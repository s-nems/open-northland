import {
  BerryBush,
  GOODS_SEARCH_RANGE_NODES,
  ownerOf,
  sameSideAs,
  type UnreachableGoal,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween } from '../../../nav/halfcell.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import { intersectReach, reachBox } from '../../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { lowestStockedFood } from '../../family/food-sources.js';
import { builtHomeType, HOME_ERRAND_RANGE_NODES, homeUsedBy, isHome } from '../../family/households.js';
import { routeRegions } from '../../footprint/index.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import type { SupplyTally } from '../../stores/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import type { TargetCandidates } from './candidates.js';
import { type NearestByCell, nearerOf, type Qualified } from './cell-index.js';
import { unclaimedGoodsAt } from './stores/stock.js';
import { interactionCell } from './workplaces.js';

/**
 * A store's candidate food good: its lowest-goodType stocked edible, or null when it holds none or has
 * no `Stockpile` at all. Canonical order, and side-effect-free so the ring may re-evaluate it on
 * the fallback scan.
 *
 * Edibility is judged on the good's edible form, since consuming a stocked dish is itself the
 * conversion. The returned type is the raw one, which is what comes off the shelf. The family's
 * {@link lowestStockedFood} is the same pick; a store with no shelf at all answers null.
 *
 * Given `claims`, a good whose every unit here is claimed by a settler walking to take it is passed over.
 */
export function storedFoodGood(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  claims?: SupplyTally,
): number | null {
  const unclaimed = claims === undefined ? undefined : unclaimedGoodsAt(world, ctx, claims, entity);
  return lowestStockedFood(world, ctx.content, entity, unclaimed);
}

/**
 * The door a home errand walks in by, or null when it is barred: on other land than the settler, outside
 * its signpost area, a goal the settler's routes just failed to reach (`memo`, see
 * {@link unreachableGoals}), such as a house walled in by later building, or beyond
 * {@link HOME_ERRAND_RANGE_NODES}. A home rung takes the whole tick, so looping on a barred door would pin
 * the settler at the top of its need bar for good.
 */
export function homeErrandDoor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  home: Entity,
  here: NodeId,
  limit: SpatialGate | null,
  memo: readonly UnreachableGoal[] | null,
): NodeId | null {
  const door = interactionCell(world, ctx, terrain, home, here);
  if (terrain.componentOf(door) !== terrain.componentOf(here)) return null;
  if (limit !== null && !limit.allowsNode(door)) return null;
  if (isUnreachableGoal(memo, door)) return null;
  if (hexNodeDistance(terrain, here, door) > HOME_ERRAND_RANGE_NODES) return null;
  return door;
}

/**
 * A ripe bush strictly inside this many map points counts as a meal at hand that competes with the stores
 * by distance, compared strictly like the original's search ranges. Approximation: the size of the
 * original's bio search range, 10; its food search applies no such radius and lets every fruit bush in
 * its reach compete.
 */
export const BUSH_AT_HAND_NODES = 10;

/** The nodes strictly inside `range` map points of `here`: the original's search ranges as a plain disc,
 *  with no terrain flood. Hex distance never exceeds Manhattan distance, so the disc widened by the asked
 *  radius bounds `mayAllowNear`. */
function hexDisc(terrain: TerrainGraph, here: NodeId, range: number): SpatialGate {
  const hx = terrain.xOf(here);
  const hy = terrain.yOf(here);
  return {
    bounds: reachBox(terrain, hx, hy, range),
    allowsNode: (node) => hexDistanceBetween(hx, hy, terrain.xOf(node), terrain.yOf(node)) < range,
    mayAllowNear: (x, y, radius) => hexDistanceBetween(hx, hy, x, y) < range + radius,
  };
}

/** Source-specific serving details; the walk, confinement and reachability are shared. */
type Meal =
  | { readonly kind: 'store'; readonly goodType: number; readonly atHome: boolean }
  | { readonly kind: 'bush' };

const RIPE_BUSH: Qualified<Meal> = { payload: { kind: 'bush' } };

/** Where a hungry settler eats: a store to take a stocked good off, or a wild bush to forage, with the
 *  cell the walk ends at. A meal at home is served indoors. */
export type MealTarget = (
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number; readonly atHome: boolean }
  | { readonly kind: 'bush'; readonly bush: Entity }
) & { readonly cell: NodeId };

/**
 * The meal a hungry settler heads for, in the order the original serves the need, or null when nothing
 * in its walking area feeds it:
 *
 * 1. Its own family larder, when its door lies within {@link HOME_ERRAND_RANGE_NODES}. Original
 *    behavior: the home comes before any other food, on the need's first attempt and off its two food
 *    slots. Project rule: on every attempt, a door the last walk failed on being skipped, and off the
 *    larder's lowest stocked edible. Owner's rule: not beyond the walk range (see the constant), so a
 *    settler working far from home eats near its work.
 * 2. The nearest of its own side's stocked food outside a home - a storehouse, a kitchen's loaves, a
 *    farm's meat, a pile on the ground - inside the goods search reach ({@link goodsSearchLimitAt}: the
 *    original's local search and the signposts it finds), and a ripe bush within {@link BUSH_AT_HAND_NODES}.
 *    Every home is skipped. Project rule: without signpost navigation the other goods searches run
 *    unbounded, while the reach here stays the original's range as a plain disc, so the bush rule below
 *    holds in every mode.
 * 3. The nearest ripe bush inside that reach, when no stocked food is. Owner's rule: the original ranks
 *    every fruit bush with the stores by distance; here only a bush at hand does, so a town eats from
 *    its stores before its settlers wander into the woods around it.
 * 4. Failing those, the nearest meal of any kind in the whole walking area, the far home included.
 *    Project rule: the original tried the home first at any distance its walk or signposts reached, and
 *    past its reach fails the need; here a meal still inside the walk reach is taken instead, a far
 *    larder on the same terms as a store.
 *
 * Project rule: each search ranks by Manhattan distance, then cell and entity id, where the original
 * takes the first hit of its resistance-weighted flood. Other families' larders and another player's
 * stocks stay private; a bush is anyone's.
 */
export function chooseMeal(
  targets: TargetCandidates,
  world: World,
  ctx: SystemContext,
  supply: SupplyTally,
  terrain: TerrainGraph,
  here: NodeId,
  eater: Entity,
  gate?: SpatialGate,
): MealTarget | null {
  const memo = unreachableGoals(world, ctx, eater);
  const component = terrain.componentOf(here);
  const regions = routeRegions(world, ctx, terrain);
  const blocked = (cell: NodeId): boolean =>
    terrain.componentOf(cell) !== component || !regions.standable(cell) || regions.unroutable(here, cell);
  const avoid = (cell: NodeId): boolean => blocked(cell) || isUnreachableGoal(memo, cell);
  const home = homeUsedBy(world, ctx, eater);
  /** The unclaimed edible the eater's own built larder serves, or null. */
  const larderGood = (source: Entity): number | null =>
    source !== home || builtHomeType(world, ctx, source) === undefined
      ? null
      : storedFoodGood(world, ctx, source, supply);
  const larder = (source: Entity): Qualified<Meal> | null => {
    const goodType = larderGood(source);
    return goodType === null ? null : { payload: { kind: 'store', goodType, atHome: true } };
  };
  if (home !== undefined) {
    const door = homeErrandDoor(world, ctx, terrain, home, here, gate ?? null, memo);
    if (door !== null && (door === here || !blocked(door))) {
      const goodType = larderGood(home);
      if (goodType !== null) return { kind: 'store', store: home, goodType, atHome: true, cell: door };
    }
  }

  const stocked = (source: Entity): Qualified<Meal> | null => {
    if (isHome(world, ctx, source)) return null;
    const goodType = storedFoodGood(world, ctx, source, supply);
    return goodType === null ? null : { payload: { kind: 'store', goodType, atHome: false } };
  };
  const ripe = (source: Entity): Qualified<Meal> | null =>
    world.tryGet(source, BerryBush)?.stage === 'ripe' ? RIPE_BUSH : null;
  const anyMeal = (source: Entity): Qualified<Meal> | null =>
    ripe(source) ?? (isHome(world, ctx, source) ? larder(source) : stocked(source));

  const owner = ownerOf(world, eater);
  const onSide = sameSideAs(world, owner);
  const nearest = (accept: (e: Entity) => Qualified<Meal> | null, within?: SpatialGate) =>
    targets.mealCells.nearest(here, accept, within, avoid, onSide);
  const reach =
    goodsSearchLimitAt(world, ctx.content, terrain, owner, terrain.xOf(here), terrain.yOf(here)) ??
    hexDisc(terrain, here, GOODS_SEARCH_RANGE_NODES);
  const near = intersectReach(gate, reach);
  const atHand = intersectReach(gate, hexDisc(terrain, here, BUSH_AT_HAND_NODES));
  const winner: NearestByCell<Meal> | null =
    nearerOf(nearest(stocked, near), nearest(ripe, atHand)) ?? nearest(ripe, near) ?? nearest(anyMeal, gate);
  if (winner === null) return null;
  const { entity, cell, payload } = winner;
  return payload.kind === 'bush' ? { kind: 'bush', bush: entity, cell } : { ...payload, store: entity, cell };
}
