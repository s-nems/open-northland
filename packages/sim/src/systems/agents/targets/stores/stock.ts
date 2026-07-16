import {
  Building,
  GroundDrop,
  Position,
  Stockpile,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import {
  buildingProduces,
  isYardHeap,
  MAX_GROUND_STACK,
  mergedRecipeOf,
  stockCapacity,
} from '../../../stores/index.js';
import type { YardTargets } from '../candidates.js';
import type { InteractionCellIndex } from '../cell-index.js';

// The AI planner's TARGET-SCAN layer: build the per-tick candidate lists and answer every "nearest X"
// / "may this settler staff that workplace" query the atomic planner asks. Split out of ai.ts (which
// keeps the planner state-machine + drives + navigation) so each file is one job. Determinism: every
// scan walks the candidate lists in canonical (ascending entity-id) order with a Manhattan-distance +
// ascending-cell-id tie-break, so the winner never depends on store insertion history (goldens hold).

/**
 * The nearest store (typically a {@link Building} with a {@link Stockpile}, but a boat hull counts too)
 * that can stock `goodType` — i.e. its type declares a stock slot for that good and the slot is not
 * already full — by Manhattan distance from `here` with the shared ascending-cell-id tie-break. Returns
 * the store entity or null if none can take the good.
 *
 * A workplace that PRODUCES `goodType` (a recipe output) is never a delivery target for it — goods
 * are hauled *out* of a producer to a store, never back into it (otherwise a carrier would deposit
 * its load straight back where it picked it up and livelock). A workplace consuming the good as an
 * input, or a passive store, is a valid sink.
 */
export function nearestStoreFor(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  goodType: number,
  /** Skip EVERY store whose building type PRODUCES `goodType` — the haul-OUT mode. A carrier
   *  clearing a producer's output must deliver to STORAGE, never to another producer of the same
   *  good: with two farms and no nearer warehouse, per-entity exclusion of only the carrier's own
   *  farm made the sibling farm the "nearest store" and the wheat ping-ponged farm↔farm forever.
   *  Omit (false) for the ordinary "nearest capable store" pick — the farmer's reap gate counts its
   *  own farm's slot as a sink, and generic hauls may still top up a producer that CONSUMES the good. */
  excludeProducers = false,
): Entity | null {
  return index.nearest(here, (e) => canStoreGood(world, ctx, e, goodType, excludeProducers))?.entity ?? null;
}

/** Position-independent acceptance half of {@link nearestStoreFor}. Shared with the tick-local sink
 * memo so null probes do not repeat the full stockpile scan. Keep every gate here in the same order as
 * the former inline scan: this is a pure extraction, not a policy change. */
export function canStoreGood(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  goodType: number,
  excludeProducers = false,
): boolean {
  if (excludeProducers && buildingProduces(world, ctx, entity).includes(goodType)) return false;
  if (!world.has(entity, Stockpile) || !world.has(entity, Position)) return false;
  if (world.has(entity, GroundDrop)) return false;
  if (isYardHeap(world, entity)) return false;
  const recipe = mergedRecipeOf(world, ctx, entity);
  if (recipe?.outputs.some((output) => output.goodType === goodType)) return false;
  const stock = world.get(entity, Stockpile);
  const have = stock.amounts.get(goodType) ?? 0;
  return have < stockCapacity(world, ctx, entity, goodType);
}

/**
 * The greatest Manhattan ring radius (in half-cell NODES) {@link nearestFreeYardNode} searches out from a
 * flag before giving up. A ring at half-cell distance `r` holds O(r) nodes; radius 32 (~16 tiles across) is
 * far more room than any single gatherer's yard needs — the bound only stops a pathological unbounded
 * search. Named approximation (the original's goods-yard extent is not decoded).
 */
const GOODS_YARD_MAX_RADIUS = 32;

/**
 * The nearest HALF-CELL node around a gatherer's `flag` whose yard tile still has room for another unit of
 * `good` — the tile a flag-bound gatherer physically WALKS to and sets its load down on, so the goods land
 * where its feet are (never teleporting to a distant tile) and heaps pack TILE-TO-TILE on the half-cell
 * lattice. Spirals out from the flag's node in Manhattan rings; a tile has room when it holds no heap, or a
 * heap of `good` below {@link MAX_GROUND_STACK} (a tile holding a DIFFERENT good, or a full one, is skipped),
 * and it must be walkable, outside dynamic building/resource blocks, and in the gatherer's static connected
 * component. Within each ring candidates are ordered by node id. `after` resumes strictly after a failed
 * route, so dynamically enclosed candidates are rejected one at a time through the ordinary budgeted
 * pathfinder instead of freezing the gatherer or running an unbudgeted search here.
 *
 * Determinism: the tick-shared occupancy/block views are membership-only and each pick uses `(ring,nodeId)`.
 * Cost is one bounded ring walk per active delivery; the O(stockpiles + buildings) views are built once for
 * the whole planner tick in `collectTargets`.
 */
export function nearestFreeYardNode(
  yard: YardTargets,
  world: World,
  terrain: TerrainGraph,
  flag: Entity,
  good: number,
  here: NodeId,
  after?: NodeId,
): NodeId | null {
  const fp = world.get(flag, Position);
  const fn = nodeOfPosition(fp.x, fp.y);
  const flagNode = terrain.nodeAtClamped(fn.hx, fn.hy);
  const hasRoom = (node: NodeId): boolean => {
    const o = yard.occupied.get(node);
    return o === undefined || (o.good === good && o.fill < MAX_GROUND_STACK);
  };
  const component = terrain.componentOf(here);
  const usable = (node: NodeId): boolean =>
    terrain.isWalkable(node) &&
    !yard.blocked.has(node) &&
    terrain.componentOf(node) === component &&
    hasRoom(node);
  const { x: cx, y: cy } = terrain.coordsOf(flagNode);
  const afterRank = after === undefined ? null : terrain.coordsOf(after);
  const afterRadius = afterRank === null ? -1 : Math.abs(afterRank.x - cx) + Math.abs(afterRank.y - cy);
  for (let r = 0; r <= GOODS_YARD_MAX_RADIUS; r++) {
    let best: NodeId | null = null;
    for (let dy = -r; dy <= r; dy++) {
      const dxMag = r - Math.abs(dy); // the Manhattan ring |dx| + |dy| = r
      for (const dx of dxMag === 0 ? [0] : [-dxMag, dxMag]) {
        if (!terrain.inBounds(cx + dx, cy + dy)) continue;
        const node = terrain.nodeAt(cx + dx, cy + dy);
        if (r < afterRadius || (r === afterRadius && after !== undefined && node <= after)) continue;
        if (usable(node) && (best === null || node < best)) best = node;
      }
    }
    if (best !== null) return best;
  }
  return usable(here) ? here : null;
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that HOLDS at least one unit of
 * `goodType` — a SOURCE to fetch from, by Manhattan distance from `here`, ascending-cell-id tie-break,
 * scanned in canonical entity-id order. A construction site is **excluded** (it is a delivery sink, not a
 * source — a builder never strips the material it just delivered), but a warehouse or a loose ground pile
 * that holds the good is fair game. Returns the source store or null if none holds the good. The counter
 * to {@link nearestStoreFor} (which finds a store that can TAKE a good); the builder drive uses it to fetch
 * a construction material its site is short on.
 */
export function nearestStoreHolding(
  index: InteractionCellIndex,
  world: World,
  here: NodeId,
  goodType: number,
): Entity | null {
  // The stockpile index holds every Stockpile+Position candidate (construction sites among them), so the
  // accept just excludes sites and stores that don't hold the good.
  return (
    index.nearest(
      here,
      (e) =>
        !world.has(e, UnderConstruction) && // a site is a sink, never a source to strip
        (world.get(e, Stockpile).amounts.get(goodType) ?? 0) > 0,
    )?.entity ?? null
  );
}
