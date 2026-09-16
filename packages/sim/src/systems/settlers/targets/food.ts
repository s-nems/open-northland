import {
  BerryBush,
  Building,
  ownerOf,
  Residence,
  Stockpile,
  sameSideAs,
  stockpileEntries,
  type UnreachableGoal,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { BERRY_FORAGE_RADIUS } from '../../economy/berries.js';
import { reservedFoodUnits, storedFoodUnits } from '../../family/households.js';
import { exportedGoodForm, isFood } from '../../readviews/index.js';
import { bushesNearNode } from '../../spatial/bushes.js';
import { closer, manhattan } from '../../spatial/metric.js';
import { accessibleStockAmounts } from '../../stores/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import type { TargetCandidates } from './candidates.js';
import { type InteractionCellIndex, nearestByCell, qualifiedGood } from './cell-index.js';
import { interactionCell } from './workplaces.js';

/**
 * The nearest store holding an edible good, by Manhattan distance from `here` with an ascending-cell-id
 * tie-break, with the specific good to eat, or null when no reachable store holds food. A producing
 * workplace counts too, so a settler may eat the food it makes.
 *
 * A store in another static component or on the eater's failed-goal `memo` is skipped, so a hungry
 * settler walks to the second, reachable larder instead of looping beside the first.
 */
function nearestFoodStore(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  eater: Entity,
  memo: readonly UnreachableGoal[] | null,
  gate?: SpatialGate,
): { store: Entity; goodType: number; dist: number; cell: NodeId } | null {
  const home = world.tryGet(eater, Residence)?.home ?? null;
  const component = terrain.componentOf(here);
  const avoid = (cell: NodeId): boolean =>
    terrain.componentOf(cell) !== component || isUnreachableGoal(memo, cell);
  const winner = index.nearest(
    here,
    (e) => qualifiedGood(edibleFoodGoodFor(world, ctx, e, home)),
    gate,
    avoid,
    sameSideAs(world, ownerOf(world, eater)), // a settler eats from its own player's larder
  );
  return winner === null
    ? null
    : { store: winner.entity, goodType: winner.payload, dist: winner.distance, cell: winner.cell };
}

/**
 * The food good `eater` may eat from `store`, or null. Beyond {@link storedFoodGood}'s "holds an
 * edible", a home larder feeds only its own residents, and the resident share stops at the home's
 * {@link reservedFoodUnits}, the child fund nobody eats.
 */
function edibleFoodGoodFor(
  world: World,
  ctx: SystemContext,
  store: Entity,
  eaterHome: Entity | null,
): number | null {
  const building = world.tryGet(store, Building);
  if (
    building !== undefined &&
    contentIndex(ctx.content).buildings.get(building.buildingType)?.kind === 'home'
  ) {
    if (store !== eaterHome) return null; // another family's larder
    if (storedFoodUnits(world, ctx, store) <= reservedFoodUnits(world, store)) return null; // all reserved
  }
  return storedFoodGood(world, ctx, store);
}

/**
 * A store's candidate food good: its lowest-goodType stocked edible, or null when it holds none or has
 * no {@link Stockpile} at all. Canonical order, and side-effect-free so the ring may re-evaluate it on
 * the fallback scan.
 *
 * Edibility is judged on the good's edible form, since consuming a stocked dish is itself the
 * conversion. The returned type is the raw one, which is what comes off the shelf.
 */
export function storedFoodGood(world: World, ctx: SystemContext, entity: Entity): number | null {
  const stock = accessibleStockAmounts(world, entity);
  if (stock === undefined) return null; // no shelf at all - the caller need not pre-check
  for (const [goodType, amount] of stockpileEntries({ amounts: stock })) {
    if (amount <= 0) continue;
    if (!isFood(ctx, exportedGoodForm(ctx, goodType))) continue;
    return goodType;
  }
  return null;
}

/**
 * Extra reach (half-cell nodes) a {@link bushesNearNode} query adds over {@link BERRY_FORAGE_RADIUS} so
 * the region box is a provable superset of the "interaction cell within radius" set. A bush is
 * non-blocking, so its interaction cell is its anchor unless a resource footprint overlaps the tile, in
 * which case the cell moves to an immediate walkable neighbour, at most two nodes off.
 */
const BUSH_INTERACTION_SLACK_NODES = 2;

/**
 * The nearest ripe {@link BerryBush} within {@link BERRY_FORAGE_RADIUS} a hungry settler could forage,
 * with its distance and cell so {@link nearestFood} can weigh it against a store, or null. A bush in
 * another terrain component is skipped, so a settler never latches onto one across an uncrossable river.
 *
 * Only the bushes near the settler are scanned: a decoded map spawns tens of thousands and this runs per
 * hungry settler. The widened region box is a superset of the radius disc, so the winner is identical.
 */
function nearestRipeBush(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  memo: readonly UnreachableGoal[] | null,
  gate?: SpatialGate,
): { bush: Entity; dist: number; cell: NodeId } | null {
  const { x: hx, y: hy } = terrain.coordsOf(here);
  const candidates = bushesNearNode(world, hx, hy, BERRY_FORAGE_RADIUS + BUSH_INTERACTION_SLACK_NODES);
  // No same-side gate: a wild BerryBush is a neutral map feature foraged in place, so any settler may
  // pick it, unlike an owned store's larder.
  const best = nearestByCell(terrain, candidates, here, (e) => {
    const bush = world.tryGet(e, BerryBush);
    if (bush === undefined || bush.stage !== 'ripe') return null; // bare or blooming
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) return null; // walled off
    if (cell !== here && isUnreachableGoal(memo, cell)) return null; // a goal this eater's route just failed on
    if (manhattan(terrain, here, cell) > BERRY_FORAGE_RADIUS) return null; // beyond forage reach
    if (gate !== undefined && !gate.allowsNode(cell)) return null; // outside the settler's signpost area
    return { cell, payload: null };
  });
  return best === null ? null : { bush: best.entity, dist: best.distance, cell: best.cell };
}

/** A resolved food target: a store to eat a stocked good from, or a wild bush to forage. The drive
 *  dispatches `eat` or `forage` off the kind. */
type FoodTarget =
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number }
  | { readonly kind: 'bush'; readonly bush: Entity };

/**
 * The nearest food of any kind a hungry settler should head for, or null when neither a store nor a ripe
 * bush is in reach. Store and bush are weighed by the one shared `(distance, cell-id)` tie-break, so a
 * bush can win an equal-distance tie: the choice is pure nearest-food, not "bush only if no store".
 */
export function nearestFood(
  targets: TargetCandidates,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  eater: Entity,
  gate?: SpatialGate,
): FoodTarget | null {
  const memo = unreachableGoals(world, ctx, eater); // shared by both halves
  const store = nearestFoodStore(targets.stockpileCells, world, ctx, terrain, here, eater, memo, gate);
  const bush = nearestRipeBush(world, ctx, terrain, here, memo, gate);
  if (bush !== null && (store === null || closer(bush.dist, bush.cell, store.dist, store.cell))) {
    return { kind: 'bush', bush: bush.bush };
  }
  if (store !== null) return { kind: 'store', store: store.store, goodType: store.goodType };
  return null;
}
