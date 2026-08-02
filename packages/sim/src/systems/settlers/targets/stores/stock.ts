import {
  Building,
  GroundDrop,
  Position,
  Stockpile,
  sameSideAs,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { forEachRingOffset } from '../../../spatial/nodes.js';
import {
  buildingProduces,
  isYardHeap,
  MAX_GROUND_STACK,
  mayFetchGoodFrom,
  mergedRecipeOf,
  stockCapacity,
} from '../../../stores/index.js';
import type { YardTargets } from '../candidates.js';
import { type InteractionCellIndex, QUALIFIES } from '../cell-index.js';

// The AI planner's TARGET-SCAN layer: build the per-tick candidate lists and answer every "nearest X" / "may
// this settler staff that workplace" query the atomic planner asks. Split out of the planner
// (planner/system.ts keeps the sweep, drives/ladder.ts the drives) so each file is one job. Determinism:
// every scan walks the candidate lists in canonical (ascending entity-id) order with a Manhattan-distance +
// ascending-cell-id tie-break, so the winner never depends on store insertion history (goldens hold).

/**
 * The nearest store (typically a {@link Building} with a {@link Stockpile}, but a boat hull counts too)
 * that can stock `goodType` - i.e. its type declares a stock slot for that good and the slot is not
 * already full - by Manhattan distance from `here` with the shared ascending-cell-id tie-break. Returns
 * the store entity or null if none can take the good.
 *
 * A workplace that PRODUCES `goodType` (a recipe output) is never a delivery target for it - goods
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
  /** The hauler's owning player - never delivers into another player's store ({@link sameSideAs}). */
  owner: number | undefined,
  /** Skip EVERY store whose building type PRODUCES `goodType` - the haul-OUT mode. A carrier
   *  clearing a producer's output must deliver to STORAGE, never to another producer of the same
   *  good: with two farms and no nearer warehouse, per-entity exclusion of only the carrier's own
   *  farm made the sibling farm the "nearest store" and the wheat ping-ponged farm↔farm forever.
   *  Omit (false) for the ordinary "nearest capable store" pick - the farmer's reap gate counts its
   *  own farm's slot as a sink, and generic hauls may still top up a producer that CONSUMES the good. */
  excludeProducers = false,
  /** The hauler's signpost confinement - an out-of-area store is not a sink it knows the way to. */
  gate?: SpatialGate,
  /** The hauler's failed-goal veto ({@link unreachableGoalVeto}). */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  return (
    index.nearest(
      here,
      (e) => (canStoreGood(world, ctx, e, goodType, excludeProducers) ? QUALIFIES : null),
      gate,
      avoid,
      sameSideAs(world, owner),
    )?.entity ?? null
  );
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
  if (recipe !== undefined) {
    // A plain loop, not `.some(closure)`: the sink scans probe this per candidate per query.
    for (const output of recipe.outputs) {
      if (output.goodType === goodType) return false;
    }
  }
  const stock = world.get(entity, Stockpile);
  const have = stock.amounts.get(goodType) ?? 0;
  return have < stockCapacity(world, ctx, entity, goodType);
}

/**
 * The greatest Manhattan ring radius (in half-cell NODES) {@link nearestFreeYardNode} searches out from a
 * flag before giving up. A ring at half-cell distance `r` holds O(r) nodes; radius 32 (~16 tiles across) is
 * far more room than any single gatherer's yard needs - the bound only stops a pathological unbounded
 * search. Named approximation (the original's goods-yard extent is not decoded).
 */
const GOODS_YARD_MAX_RADIUS = 32;

/**
 * The nearest HALF-CELL node around a gatherer's `flag` whose yard tile still has room for another unit of
 * `good` - the tile a flag-bound gatherer physically WALKS to and sets its load down on, so the goods land
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
  /** The gatherer's signpost confinement - a yard tile outside its allowed area is never a drop spot
   *  (the flag itself was placed inside the area, so in practice this trims only the yard's far fringe). */
  gate?: SpatialGate,
): NodeId | null {
  const fp = world.get(flag, Position);
  const flagNode = terrain.nodeAtClamped(nodeHxOfPosition(fp.x, fp.y), nodeHyOfPosition(fp.y));
  const hasRoom = (node: NodeId): boolean => {
    const o = yard.occupied.get(node);
    return o === undefined || (o.good === good && o.fill < MAX_GROUND_STACK);
  };
  const component = terrain.componentOf(here);
  const usable = (node: NodeId): boolean =>
    terrain.isWalkable(node) &&
    !yard.blocked.has(node) &&
    terrain.componentOf(node) === component &&
    (gate === undefined || gate.allowsNode(node)) &&
    hasRoom(node);
  const { x: cx, y: cy } = terrain.coordsOf(flagNode);
  const afterRank = after === undefined ? null : terrain.coordsOf(after);
  const afterRadius = afterRank === null ? -1 : Math.abs(afterRank.x - cx) + Math.abs(afterRank.y - cy);
  // One visitor for the whole spiral (not one per ring): `best` resets per ring, so the first ring
  // with a usable tile still wins before a farther ring is probed.
  let best: NodeId | null = null;
  let ring = 0;
  const visit = (dx: number, dy: number): void => {
    if (!terrain.inBounds(cx + dx, cy + dy)) return;
    const node = terrain.nodeAt(cx + dx, cy + dy);
    if (ring < afterRadius || (ring === afterRadius && after !== undefined && node <= after)) return;
    if (usable(node) && (best === null || node < best)) best = node;
  };
  for (let r = 0; r <= GOODS_YARD_MAX_RADIUS; r++) {
    best = null;
    ring = r;
    forEachRingOffset(r, visit);
    if (best !== null) return best;
  }
  return usable(here) ? here : null;
}

/**
 * Whether a loose pile lies on a cell standing buildings make unwalkable - an unreachable SOURCE no
 * fetcher should commit to: its stand is inside the walls, so the walk path-fails, the settler strands,
 * re-picks the same geometrically-nearest pile, and loops. The footprint goods eviction keeps this rare
 * (a placement displaces the piles it covers), so the filter is the safety net for the leftovers (a
 * boxed-in pile the eviction could not land). Scoped to building walls only: a trunk under a
 * still-STANDING resource is legitimate - its interaction cell resolves to the resource's work cell -
 * and a {@link Building} store is never buried by its own walls (its stand is the door). `walls` is the
 * memoized {@link buildingBlockedCells} set, resolved once per scan by the callers.
 */
export function buriedUnderBuilding(
  world: World,
  terrain: TerrainGraph,
  walls: ReadonlySet<NodeId>,
  entity: Entity,
): boolean {
  if (world.has(entity, Building)) return false;
  const p = world.get(entity, Position);
  return walls.has(terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y)));
}

/**
 * The nearest store (a {@link Stockpile} on a positioned entity) that HOLDS at least one unit of
 * `goodType` and may be stripped of it - a SOURCE to fetch from, by Manhattan distance from `here`,
 * ascending-cell-id tie-break, scanned in canonical entity-id order. Excluded: a construction site (a
 * delivery sink, not a source - a builder never strips the material it just delivered), a loose pile
 * buried under a building's walls ({@link buriedUnderBuilding} - an unreachable stand would strand the
 * fetcher), and a workshop's own input reserve ({@link mayFetchGoodFrom}). A warehouse, a reachable
 * ground pile, and a producer's finished shelf are fair game. Returns the source store or null if none
 * yields the good. The counter to
 * {@link nearestStoreFor} (which finds a store that can TAKE a good); the builder drive uses it to fetch
 * a construction material its site is short on, and the equip/grant errands to fetch a wearable.
 */
export function nearestStoreHolding(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  goodType: number,
  /** The fetcher's owning player - never fetches from another player's store ({@link sameSideAs}). */
  owner: number | undefined,
  gate?: SpatialGate,
  /** The fetcher's failed-goal veto ({@link unreachableGoalVeto}). */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  // The stockpile index holds every Stockpile+Position candidate (construction sites among them), so the
  // accept just excludes sites, stores that don't hold the good or may not yield it, and buried piles.
  // `gate` is the fetcher's signpost confinement: a store standing outside its allowed area is not a
  // source it knows the way to.
  const walls = buildingBlockedCells(world, ctx, terrain);
  return (
    index.nearest(
      here,
      (e) =>
        !world.has(e, UnderConstruction) && // a site is a sink, never a source to strip
        (world.get(e, Stockpile).amounts.get(goodType) ?? 0) > 0 &&
        mayFetchGoodFrom(world, ctx, e, goodType) &&
        !buriedUnderBuilding(world, terrain, walls, e)
          ? QUALIFIES
          : null,
      gate,
      avoid,
      sameSideAs(world, owner),
    )?.entity ?? null
  );
}
