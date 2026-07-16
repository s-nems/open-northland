import { BerryBush, Stockpile, stockpileEntries } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { bushesNearNode } from '../../berry-index.js';
import type { SystemContext } from '../../context.js';
import { BERRY_FORAGE_RADIUS } from '../../economy/berries.js';
import type { SpatialGate } from '../../node-metric.js';
import { manhattan } from '../../spatial.js';
import { isFood } from '../../stores/index.js';
import type { TargetCandidates } from './candidates.js';
import { type InteractionCellIndex, nearestByCell } from './cell-index.js';
import { closer } from './nearest.js';
import { interactionCell } from './workplaces.js';

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that holds at least one unit of an
 * edible good ({@link isFood}), by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. Returns the store and the specific food good to eat, or null
 * if no reachable store holds food. The good within a store is chosen in canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order — so the choice never
 * depends on store insertion history. A producing workplace counts too (a settler eats the food it
 * makes); the eater consumes one unit on the `eat` atomic's completion (AtomicSystem).
 */
function nearestFoodStore(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  gate?: SpatialGate,
): { store: Entity; goodType: number; dist: number; cell: NodeId } | null {
  const winner = index.nearest(here, (e) => storedFoodGood(world, ctx, e) !== null, gate);
  if (winner === null) return null;
  const goodType = storedFoodGood(world, ctx, winner.entity);
  return goodType === null
    ? null
    : { store: winner.entity, goodType, dist: winner.distance, cell: winner.cell };
}

/** A store's candidate food good: its lowest-goodType stocked edible ({@link isFood}), or null when it holds
 *  none. Canonical (ascending goodType via {@link stockpileEntries}) so the choice never depends on Map
 *  insertion history; side-effect-free, so the ring may re-evaluate it on the fallback scan. */
function storedFoodGood(world: World, ctx: SystemContext, entity: Entity): number | null {
  for (const [goodType, amount] of stockpileEntries(world.get(entity, Stockpile))) {
    if (amount <= 0 || !isFood(ctx, goodType)) continue;
    return goodType; // this store's lowest-id food good is its candidate
  }
  return null;
}

/**
 * The extra reach (half-cell nodes) a {@link bushesNearNode} query adds over {@link BERRY_FORAGE_RADIUS}
 * so the region box is a provable SUPERSET of the true "interaction cell within radius" set. A bush is
 * non-blocking, so its interaction cell IS its anchor unless a resource footprint overlaps the tile, in
 * which case `positionedInteractionCell` picks an immediate walkable neighbour (≤2 nodes off) — this
 * covers that displacement, so the cellDist filter below still picks the same winner as a full scan.
 */
const BUSH_INTERACTION_SLACK_NODES = 2;

/**
 * The nearest RIPE {@link BerryBush} a hungry settler could forage, by Manhattan distance from `here`
 * with the shared ascending-cell-id tie-break — the eat drive's WILD-FOOD fallback ({@link nearestFood}).
 * Only a bush that currently holds fruit (`ripe`), lies within {@link BERRY_FORAGE_RADIUS} of the settler,
 * and is REACHABLE (same terrain component as `here`, the same gate {@link nearestHarvestableFor} applies
 * so a settler never latches onto a bush across an uncrossable river) qualifies. Returns the bush + its
 * distance/cell (so {@link nearestFood} can weigh it against a store), or null if none is in reach.
 *
 * Scans only the bushes NEAR the settler ({@link bushesNearNode}, the region index) rather than every bush
 * on the map — a decoded map spawns tens of thousands, and this runs per hungry settler, so a full scan is
 * the golden-rule-6 per-entity-loop trap. The region box (widened by {@link BUSH_INTERACTION_SLACK_NODES})
 * is a provable superset of the radius disc, and the filter/rank loop is unchanged, so the winner is
 * identical to a full scan. Determinism: the candidate list is ascending-id and the pick is canonical.
 */
function nearestRipeBush(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  gate?: SpatialGate,
): { bush: Entity; dist: number; cell: NodeId } | null {
  const { x: hx, y: hy } = terrain.coordsOf(here);
  const candidates = bushesNearNode(world, hx, hy, BERRY_FORAGE_RADIUS + BUSH_INTERACTION_SLACK_NODES);
  const best = nearestByCell(terrain, candidates, here, (e) => {
    const bush = world.tryGet(e, BerryBush);
    if (bush === undefined || !bush.ripe) return null; // bare/regrowing — nothing to forage
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) return null; // walled off — leave it be
    if (manhattan(terrain, here, cell) > BERRY_FORAGE_RADIUS) return null; // beyond forage reach (flat radius)
    if (gate !== undefined && !gate.allowsNode(cell)) return null; // outside the settler's signpost area
    return cell;
  });
  return best === null ? null : { bush: best.entity, dist: best.distance, cell: best.cell };
}

/** A resolved food target for the eat drive: a store to eat a stocked/produced good FROM, or a wild
 *  {@link BerryBush} to forage. The union {@link nearestFood} returns so the drive dispatches the right
 *  atomic (`eat` vs `forage`). */
export type FoodTarget =
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number }
  | { readonly kind: 'bush'; readonly bush: Entity };

/**
 * The nearest FOOD of any kind a hungry settler should head for — the eat drive's "find the nearest food"
 * primitive. It weighs the nearest food STORE ({@link nearestFoodStore}) against the nearest ripe wild BUSH
 * ({@link nearestRipeBush}, the bounded {@link BERRY_FORAGE_RADIUS} fallback) with the ONE shared
 * {@link closer} tie-break, so the winner
 * is whichever is genuinely nearer — an equal-distance tie is broken by the lower interaction-cell id (so a
 * bush CAN win a distance tie when its cell id is lower; the pick stays deterministic, cell ids being
 * position-derived). Returns null when neither is in reach.
 *
 * The wild bush is a FALLBACK in practice (a settled larder is usually the nearer food), but the choice is
 * pure nearest-food, not "bush only if no store" — a settler beside a berry patch eats the berries rather
 * than trek to a distant granary. With no bushes near the settler the bush scan is O(0) and the result is
 * exactly {@link nearestFoodStore}'s, so every existing eat golden holds.
 */
export function nearestFood(
  targets: TargetCandidates,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  gate?: SpatialGate,
): FoodTarget | null {
  const store = nearestFoodStore(targets.stockpileCells, world, ctx, here, gate);
  const bush = nearestRipeBush(world, ctx, terrain, here, gate);
  if (bush !== null && (store === null || closer(bush.dist, bush.cell, store.dist, store.cell))) {
    return { kind: 'bush', bush: bush.bush };
  }
  if (store !== null) return { kind: 'store', store: store.store, goodType: store.goodType };
  return null;
}
