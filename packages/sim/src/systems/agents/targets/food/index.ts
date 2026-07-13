import { BerryBush, Position, Stockpile, stockpileEntries } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { bushesNearNode } from '../../../berry-index.js';
import type { SystemContext } from '../../../context.js';
import { BERRY_FORAGE_RADIUS } from '../../../economy/berries.js';
import { manhattan } from '../../../spatial.js';
import { isFood } from '../../../stores/index.js';
import type { TargetCandidates } from '../candidates.js';
import { closer } from '../nearest.js';
import { interactionCell } from '../workplaces.js';

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that holds at least one unit of an
 * edible good ({@link isFood}), by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. Returns the store and the specific food good to eat, or null
 * if no reachable store holds food. The good within a store is chosen in canonical (ascending
 * goodType) order via {@link stockpileEntries} — never raw Map insertion order — so the choice never
 * depends on store insertion history. A producing workplace counts too (a settler eats the food it
 * makes); the eater consumes one unit on the `eat` atomic's completion (AtomicSystem).
 */
export function nearestFoodStore(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { store: Entity; goodType: number; dist: number; cell: NodeId } | null {
  let best: { store: Entity; goodType: number; dist: number; cell: NodeId } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Stockpile) || !world.has(e, Position)) continue;
    const stock = world.get(e, Stockpile);
    // Find the store's candidate food FIRST (its lowest-goodType stocked edible); only a store that
    // holds food pays for the interaction-cell + distance work (pure elision — same winner).
    let food: number | null = null;
    for (const [goodType, amount] of stockpileEntries(stock)) {
      if (amount <= 0 || !isFood(ctx, goodType)) continue;
      food = goodType;
      break; // this store's lowest-id food good is its candidate
    }
    if (food === null) continue;
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { store: e, goodType: food, dist, cell };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
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
export function nearestRipeBush(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { bush: Entity; dist: number; cell: NodeId } | null {
  const { x: hx, y: hy } = terrain.coordsOf(here);
  const candidates = bushesNearNode(world, hx, hy, BERRY_FORAGE_RADIUS + BUSH_INTERACTION_SLACK_NODES);
  let best: { bush: Entity; dist: number; cell: NodeId } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const bush = world.tryGet(e, BerryBush);
    if (bush === undefined || !bush.ripe) continue; // bare/regrowing — nothing to forage
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) continue; // walled off — leave it be
    const dist = manhattan(terrain, here, cell);
    if (dist > BERRY_FORAGE_RADIUS) continue; // beyond the forage reach (interim, pre-signpost limit)
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { bush: e, dist, cell };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/** A resolved food target for the eat drive: a store to eat a stocked/produced good FROM, or a wild
 *  {@link BerryBush} to forage. The union {@link nearestFood} returns so the drive dispatches the right
 *  atomic (`eat` vs `forage`). */
export type FoodTarget =
  | { readonly kind: 'store'; readonly store: Entity; readonly goodType: number }
  | { readonly kind: 'bush'; readonly bush: Entity };

/**
 * The nearest FOOD of any kind a hungry settler should head for — the eat drive's "find the nearest food"
 * primitive. It weighs the nearest food STORE ({@link nearestFoodStore}, sought UNBOUNDED — a settlement's
 * larder is always worth walking to) against the nearest ripe wild BUSH ({@link nearestRipeBush}, the
 * bounded {@link BERRY_FORAGE_RADIUS} fallback) with the ONE shared {@link closer} tie-break, so the winner
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
): FoodTarget | null {
  const store = nearestFoodStore(targets.stockpiles, world, ctx, terrain, here);
  const bush = nearestRipeBush(world, ctx, terrain, here);
  if (bush !== null && (store === null || closer(bush.dist, bush.cell, store.dist, store.cell))) {
    return { kind: 'bush', bush: bush.bush };
  }
  if (store !== null) return { kind: 'store', store: store.store, goodType: store.goodType };
  return null;
}
