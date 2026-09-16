import { Building, GroundDrop, Position, Stockpile, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../spatial/metric.js';
import {
  accessibleStockAmounts,
  bankedSlot,
  buildingProduces,
  isYardHeap,
  MAX_GROUND_STACK,
  mayFetchGoodFrom,
  mergedRecipeOf,
} from '../../../stores/index.js';
import type { TargetBands } from '../bands.js';
import type { YardTargets } from '../candidates.js';
import { ACCEPT_ALL } from '../cell-index.js';

/**
 * The nearest store that can stock `goodType`, by Manhattan distance from `here` with the shared
 * ascending-cell-id tie-break, or null when none can take it. A boat hull counts as a store.
 *
 * A workplace that produces `goodType` is never a delivery target for it: goods are hauled out of a
 * producer to a store, never back into it, or a carrier would deposit its load where it picked it up
 * and livelock. A workplace consuming the good as an input, or a passive store, is a valid sink.
 */
export function nearestStoreFor(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  /** The hauler's owning player. It never delivers into another player's store. */
  owner: number | undefined,
  /** Skip every store whose building type produces `goodType`, the haul-out mode: a carrier clearing a
   *  producer's output must deliver to storage, or two producers of the same good ping-pong it between
   *  them. Omitted, a producer that consumes the good is still a valid sink. */
  excludeProducers = false,
  /** The hauler's signpost confinement: an out-of-area store is not a sink it knows the way to. */
  gate?: SpatialGate,
  /** The hauler's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  return (
    bands
      .sinksFor(goodType, excludeProducers)
      .nearest(here, ACCEPT_ALL, gate, avoid, sameSideAs(world, owner))?.entity ?? null
  );
}

/** Position-independent acceptance half of {@link nearestStoreFor}, shared with the tick-local sink memo.
 *
 * The good gates judge the {@link bankedSlot}, the slot the deposit would land in, so a store that banks
 * a raw dish as its edible is a sink the routing can see and the producer rules hold against the form
 * that lands. The structural rejects come first because resolving the slot costs a capacity lookup. */
export function canStoreGood(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  goodType: number,
  excludeProducers = false,
): boolean {
  if (!world.has(entity, Stockpile) || !world.has(entity, Position)) return false;
  if (world.has(entity, GroundDrop)) return false;
  if (isYardHeap(world, entity)) return false;
  const slot = bankedSlot(world, ctx, entity, goodType);
  if (excludeProducers && buildingProduces(world, ctx, entity).includes(slot.goodType)) return false;
  const recipe = mergedRecipeOf(world, ctx, entity);
  if (recipe !== undefined) {
    // A plain loop, not `.some(closure)`: the sink scans probe this per candidate per query.
    for (const output of recipe.outputs) {
      if (output.goodType === slot.goodType) return false;
    }
  }
  return (world.get(entity, Stockpile).amounts.get(slot.goodType) ?? 0) < slot.capacity;
}

/**
 * Greatest Manhattan ring radius (half-cell nodes) {@link nearestFreeYardNode} searches out from a flag
 * before giving up, about 16 visual tiles across. Approximation: the original's goods-yard extent is not
 * decoded, and the bound only stops a pathological unbounded search.
 */
const GOODS_YARD_MAX_RADIUS = 32;

/**
 * The nearest half-cell node around a gatherer's `flag` with room for another unit of `good`, so a
 * delivered load lands where the gatherer's feet are and heaps pack tile to tile. A tile has room when
 * it holds no heap or a heap of `good` below {@link MAX_GROUND_STACK}, and it must be walkable, outside
 * dynamic blocks, and in the gatherer's static component. Candidates are ordered by `(ring, node id)`.
 * `after` resumes strictly after a failed route, so an enclosed candidate is rejected one at a time
 * through the budgeted pathfinder rather than by an unbudgeted search here.
 */
export function nearestFreeYardNode(
  yard: YardTargets,
  world: World,
  terrain: TerrainGraph,
  flag: Entity,
  good: number,
  here: NodeId,
  after?: NodeId,
  /** The gatherer's signpost confinement: a yard tile outside its allowed area is never a drop spot. */
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
  for (let r = 0; r <= GOODS_YARD_MAX_RADIUS; r++) {
    let best: NodeId | null = null;
    const offsets = ringOffsetCount(r);
    for (let i = 0; i < offsets; i++) {
      const x = cx + ringOffsetDx(r, i);
      const y = cy + ringOffsetDy(r, i);
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (r < afterRadius || (r === afterRadius && after !== undefined && node <= after)) continue;
      if (usable(node) && (best === null || node < best)) best = node;
    }
    if (best !== null) return best;
  }
  return usable(here) ? here : null;
}

/**
 * Whether a loose pile lies on a cell standing buildings make unwalkable, making it a source no fetcher
 * can reach: the walk path-fails, the settler strands and re-picks the same nearest pile. Scoped to
 * building walls only, since a trunk under a standing resource resolves to that resource's work cell and
 * a {@link Building} store is never buried by its own walls. `walls` is resolved once per scan.
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
 * The nearest store that holds at least one unit of `goodType` and may be stripped of it, by Manhattan
 * distance from `here` with an ascending-cell-id tie-break, or null. The counter to
 * {@link nearestStoreFor}, which finds a store that can take a good. A from-scratch construction site,
 * a pile buried under a building's walls, and a workshop's own input reserve are excluded. An upgrade
 * site keeps its ordinary inventory available while its separate construction hold stays protected.
 */
export function nearestStoreHolding(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  /** The fetcher's owning player. It never fetches from another player's store. */
  owner: number | undefined,
  /** The fetcher's signpost confinement: an out-of-area store is not a source it knows the way to. */
  gate?: SpatialGate,
  /** The fetcher's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  return (
    bands.holding(goodType).nearest(here, ACCEPT_ALL, gate, avoid, sameSideAs(world, owner))?.entity ?? null
  );
}

/**
 * Whether `store` is a source this good can be fetched from: {@link nearestStoreHolding}'s accept minus
 * the spatial gate and the owner axis, so a caller asking only whether such a source exists asks the
 * same question the walk will. Cheapest test first, since most stores hold none of the good.
 */
export function storeYieldsGood(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  walls: ReadonlySet<NodeId>,
  store: Entity,
  goodType: number,
): boolean {
  const stock = accessibleStockAmounts(world, store);
  return (
    (stock?.get(goodType) ?? 0) > 0 &&
    mayFetchGoodFrom(world, ctx, store, goodType) &&
    !buriedUnderBuilding(world, terrain, walls, store)
  );
}
