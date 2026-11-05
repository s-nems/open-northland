import {
  anyStorageMinimum,
  Building,
  GroundDrop,
  keepsStorageMinimums,
  ownerOf,
  Palisade,
  Position,
  Stockpile,
  sameSideAs,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../../../context.js';
import { anchoredStanceCells, positionedStanceCells } from '../../../footprint/index.js';
import {
  accessibleStockAmounts,
  bankedSlot,
  buildingProduces,
  isStorehouseType,
  isYardHeap,
  MAX_GROUND_STACK,
  mayFetchGoodFrom,
  mergedRecipeOf,
  refillsOwnStock,
  type SupplyTally,
} from '../../../stores/index.js';
import type { TargetBands } from '../bands.js';
import type { YardTargets } from '../candidates.js';
import {
  ACCEPT_ALL,
  FILED_STRIDE,
  type InteractionCellIndex,
  type NearestByCell,
  nearBox,
  QUALIFIES,
  RING_MIN_BUCKETS,
} from '../cell-index.js';
import { FetchableStock } from './fetchable-stock.js';
import { minimumBoundOwner, storageLendable, storageSurplus } from './storage-reserve.js';
import { yardOffsets } from './yard-layout.js';

/**
 * The nearest store that can stock `goodType`, by Manhattan distance from `here` with the shared
 * ascending-cell-id tie-break, or null when none can take it. A boat hull counts as a store.
 *
 * A workplace that produces `goodType` is never a delivery target for it: goods are hauled out of a
 * producer to a store, never back into it, or a carrier would deposit its load where it picked it up
 * and livelock. A workplace consuming the good as an input, or a passive store, is a valid sink. A
 * construction site is not: see {@link canStoreGood}.
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
  ctx: ContentContext,
  entity: Entity,
  goodType: number,
  excludeProducers = false,
): boolean {
  return takesDeposits(world, entity) && acceptsGood(world, ctx, entity, goodType, excludeProducers);
}

/** {@link canStoreGood}'s good-independent rejects: whether `entity` is a store any deposit may land in. */
export function takesDeposits(world: World, entity: Entity): boolean {
  if (!world.has(entity, Stockpile) || !world.has(entity, Position)) return false;
  if (world.has(entity, GroundDrop) || world.has(entity, Palisade)) return false;
  if (isYardHeap(world, entity)) return false;
  // A site takes material only through the delivery rules that count inbound errands. As a general sink
  // it would accept a distant load against a bill line a nearer fetch already covers, and that fetch
  // would then stand down.
  return !world.has(entity, UnderConstruction);
}

/** {@link canStoreGood}'s per-good half, for a store {@link takesDeposits} already admitted. */
export function acceptsGood(
  world: World,
  ctx: ContentContext,
  entity: Entity,
  goodType: number,
  excludeProducers: boolean,
): boolean {
  const slot = bankedSlot(world, ctx, entity, goodType);
  if (excludeProducers && buildingProduces(world, ctx, entity).includes(slot.goodType)) return false;
  const recipe = mergedRecipeOf(world, ctx, entity);
  if (recipe !== undefined) {
    // A plain loop, not `.some(closure)`: the sink scans probe this per candidate per query.
    for (const output of recipe.outputs) {
      if (output.goodType === slot.goodType) return false;
    }
  } else if (
    refillsOwnStock(world, ctx, entity) &&
    buildingProduces(world, ctx, entity).includes(slot.goodType)
  ) {
    return false;
  }
  return (world.get(entity, Stockpile).amounts.get(slot.goodType) ?? 0) < slot.capacity;
}

/**
 * The nearest half-cell node around a gatherer's `flag` with room for another unit of `good`, so a
 * delivered load lands where the gatherer's feet are and heaps pack tile to tile. A tile has room when
 * it holds no heap or a heap of `good` below {@link MAX_GROUND_STACK}, and it must be walkable, outside
 * dynamic blocks, and in the gatherer's static component. The flag fills first, then the
 * six-neighbour yard order expands outwards.
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
  const flagNode = terrain.nodeAtClamped(nodeHxOfPosition(fp.x, fp.y), nodeHyOfPosition(fp.x, fp.y));
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
  let pastFailure = after === undefined;
  for (const offset of yardOffsets(cy)) {
    const x = cx + offset.hx;
    const y = cy + offset.hy;
    if (!terrain.inBounds(x, y)) continue;
    const node = terrain.nodeAt(x, y);
    if (!pastFailure) {
      if (node === after) pastFailure = true;
      continue;
    }
    if (usable(node)) return node;
  }
  return usable(here) ? here : null;
}

/**
 * Whether a loose pile is a source no fetcher can reach: it lies on a cell standing buildings make
 * unwalkable, or no unit can stand on or beside it, such as ore left on an exhausted deposit's cell that
 * neighbouring stones cover. The walk would path-fail and the settler re-pick the same nearest pile. A
 * trunk under a standing resource is judged by that resource's work cells, and a {@link Building} store is
 * never stranded by its own walls. `walls` is resolved once per scan.
 */
export function strandedPile(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  walls: ReadonlySet<NodeId>,
  entity: Entity,
): boolean {
  if (world.has(entity, Building)) return false;
  const p = world.get(entity, Position);
  if (walls.has(terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y)))) return true;
  return positionedStanceCells(world, ctx, terrain, entity).length === 0;
}

/** {@link strandedPile} for a pile on `anchor` that is neither a {@link Building} nor a {@link GroundDrop}. */
export function strandedPlainPile(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  walls: ReadonlySet<NodeId>,
  anchor: NodeId,
): boolean {
  return walls.has(anchor) || anchoredStanceCells(world, ctx, terrain, anchor).length === 0;
}

/** Units of `goodType` at `store` not yet promised to a settler walking to it, and no more than its
 *  owner's storage minimum lets go. */
export function unclaimedStockOf(
  world: World,
  ctx: ContentContext,
  supply: SupplyTally | undefined,
  store: Entity,
  goodType: number,
): number {
  const unclaimed =
    (accessibleStockAmounts(world, store)?.get(goodType) ?? 0) - (supply?.reservedAt(store, goodType) ?? 0);
  return Math.min(unclaimed, storageLendable(world, ctx, store, goodType, supply));
}

/** A good filter admitting the goods `store` may give up beyond what walkers claimed there and its
 *  owner's storage minimum holds back, or undefined when neither binds, so a scan over such a store
 *  builds no closure. */
export function unclaimedGoodsAt(
  world: World,
  ctx: ContentContext,
  supply: SupplyTally | undefined,
  store: Entity,
): ((goodType: number) => boolean) | undefined {
  if (supply?.hasClaims(store) !== true && !storehouseKeepsMinimums(world, ctx, store)) return undefined;
  return (goodType) => unclaimedStockOf(world, ctx, supply, store, goodType) > 0;
}

/**
 * The nearest store that holds at least one unit of `goodType` and may be stripped of it, by Manhattan
 * distance from `here` with an ascending-cell-id tie-break, or null. The counter to
 * {@link nearestStoreFor}, which finds a store that can take a good. A from-scratch construction site,
 * a pile buried under a building's walls, and a workshop's own input reserve are excluded. An upgrade
 * site keeps its ordinary inventory available while its separate construction hold stays protected.
 * A store whose units of the good are all claimed by settlers walking to it is skipped: a claim steers
 * the choice, never the pickup.
 */
export function nearestStoreHolding(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  /** The fetcher's owning player. It never fetches from another player's store. */
  owner: number | undefined,
  /** Live pickup claims: a store whose whole stock of the good is promised to walkers is passed over. */
  supply: SupplyTally,
  /** The fetcher's signpost confinement: an out-of-area store is not a source it knows the way to. */
  gate?: SpatialGate,
  /** The fetcher's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  if (sideLendsNone(bands, world, owner, goodType)) return null;
  // An empty band answers null whatever the gate, so its goods limit is never asked.
  if (!bands.holding(goodType).hasCandidates()) return null;
  return nearestStoreHoldingWithin(
    bands,
    world,
    here,
    goodType,
    owner,
    supply,
    bands.goodsGate(here, owner, gate),
    avoid,
  );
}

/** {@link nearestStoreHolding} under `goodsGate`, the fetcher's gate already met with the goods-search
 *  limit at `here` ({@link TargetBands.goodsGate}), for a caller that reads that gate once for many goods.
 *  An owned fetcher's field is first narrowed to the side's lending stores filed near the gate, as
 *  {@link storeHoldingMayLieIn} tests them, and a few are scanned exactly instead of sweeping every ring
 *  of the gate: such a search mostly finds nothing. */
export function nearestStoreHoldingWithin(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  owner: number | undefined,
  supply: SupplyTally,
  goodsGate: SpatialGate | undefined,
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  if (sideLendsNone(bands, world, owner, goodType)) return null;
  const holders = bands.holding(goodType);
  if (!holders.hasCandidates()) return null;
  if (owner === undefined) {
    return nearestHolderIn(bands, holders, world, here, goodType, owner, supply, goodsGate, avoid);
  }
  const filed = storesFiledNear(holders, owner, goodsGate);
  // Mostly none: the stock lies outside the gate, and the search ends before its filter is made.
  if (filed === 0) return null;
  const lends = holdsUnclaimed(world, bands.ctx, supply, goodType);
  const count = keepLenders(filed, lends);
  if (count === 0) return null;
  // Past the ring search's own linear threshold its rings answer, with the identical winner.
  if (count > RING_MIN_BUCKETS) {
    return nearestHolderIn(bands, holders, world, here, goodType, owner, supply, goodsGate, avoid);
  }
  sortAscending(narrowedField, count);
  return holders.nearestAmong(narrowedField, count, here, lends, goodsGate, avoid)?.entity ?? null;
}

/** The stores {@link nearestStoreHolding} weighs for an owned fetcher, ranked as {@link
 *  InteractionCellIndex.rankedAmong} ranks them: under a further `avoid`, `firstUnvetoed` of the ranking is
 *  that search's winner under both, for a fetcher that asks it again under many. */
export function storesHoldingRanked(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  owner: number,
  supply: SupplyTally,
  gate?: SpatialGate,
  avoid?: (cell: NodeId) => boolean,
): readonly NearestByCell[] {
  if (sideLendsNone(bands, world, owner, goodType)) return [];
  const holders = bands.holding(goodType);
  if (!holders.hasCandidates()) return [];
  const goodsGate = bands.goodsGate(here, owner, gate);
  const filed = storesFiledNear(holders, owner, goodsGate);
  if (filed === 0) return [];
  const lends = holdsUnclaimed(world, bands.ctx, supply, goodType);
  const count = keepLenders(filed, lends);
  // The ranking orders by entity id too, so the field needs no sort.
  return holders.rankedAmong(narrowedField, count, here, lends, goodsGate, avoid);
}

/** Keep the first `count` stores of {@link narrowedField} that `lends` passes, in order, and return how
 *  many those are. */
function keepLenders(count: number, lends: (store: Entity) => typeof QUALIFIES | null): number {
  const near = narrowedField;
  let lenders = 0;
  for (let i = 0; i < count; i++) {
    const store = near[i] as Entity;
    if (lends(store) !== null) near[lenders++] = store;
  }
  return lenders;
}

/** {@link storesFiledNear}'s list, reused at a count rather than a length, so its storage stays put. */
const narrowedField: Entity[] = [];

/** Fill {@link narrowedField} with `owner`'s side's stores filed near enough to `area` to be reached in it,
 *  as {@link storeHoldingMayLieIn} tests them, and return their count: every store a search under `area`
 *  could pick is among them. */
function storesFiledNear(
  holders: InteractionCellIndex,
  owner: number,
  area: SpatialGate | undefined,
): number {
  const filed = holders.filedOnSide(owner);
  const slack = holders.filedSlack;
  const bounded = area?.mayAllowNear !== undefined;
  const box = area?.bounds;
  let count = 0;
  for (let i = 0; i < filed.length; i += FILED_STRIDE) {
    const x = filed[i + 1] as number;
    const y = filed[i + 2] as number;
    // No allowed node lies within `slack` of a node that far off the gate's box: the cheap test first.
    if (box !== undefined && !nearBox(box, x, y, slack)) continue;
    if (bounded && area?.mayAllowNear?.(x, y, slack) !== true) continue;
    narrowedField[count++] = filed[i] as Entity;
  }
  return count;
}

/** Sort the first `count` ids of `list` ascending in place, by insertion: a short run. */
function sortAscending(list: Entity[], count: number): void {
  for (let i = 1; i < count; i++) {
    const e = list[i] as Entity;
    let j = i - 1;
    while (j >= 0 && (list[j] as Entity) > e) {
      list[j + 1] = list[j] as Entity;
      j--;
    }
    list[j + 1] = e;
  }
}

function nearestHolderIn(
  bands: TargetBands,
  holders: InteractionCellIndex,
  world: World,
  here: NodeId,
  goodType: number,
  owner: number | undefined,
  supply: SupplyTally,
  goodsGate: SpatialGate | undefined,
  avoid: ((cell: NodeId) => boolean) | undefined,
): Entity | null {
  return (
    holders.nearest(
      here,
      holdsUnclaimed(world, bands.ctx, supply, goodType),
      goodsGate,
      avoid,
      sameSideAs(world, owner),
    )?.entity ?? null
  );
}

/**
 * Whether {@link nearestStoreHolding} may find a store of one good inside `area`, the search's goods gate,
 * or anywhere for none: false proves the search finds none, since no store of the fetcher's side filed
 * near enough to the area to be reached in it lends a unit now. The side's filed stores are kept until
 * the band changes, so an area costs one test per such store, and a store's stock only for one near it,
 * where a missed search sweeps every ring.
 */
export function storeHoldingMayLieIn(
  bands: TargetBands,
  world: World,
  goodType: number,
  owner: number,
  supply: SupplyTally,
  area: SpatialGate | undefined,
): boolean {
  if (sideLendsNone(bands, world, owner, goodType)) return false;
  const holders = bands.holding(goodType);
  if (!holders.hasCandidates()) return false;
  const filed = holders.filedOnSide(owner);
  const slack = holders.filedSlack;
  const bounded = area?.mayAllowNear !== undefined;
  let lends: ((store: Entity) => typeof QUALIFIES | null) | undefined;
  for (let i = 0; i < filed.length; i += FILED_STRIDE) {
    if (bounded && area?.mayAllowNear?.(filed[i + 1] as number, filed[i + 2] as number, slack) !== true) {
      continue;
    }
    lends ??= holdsUnclaimed(world, bands.ctx, supply, goodType);
    if (lends(filed[i] as Entity) !== null) return true;
  }
  return false;
}

/** {@link nearestStoreHolding} with no signpost or goods-search gate, over `owner`'s own stores alone:
 *  the store a fetcher would reach if nothing guided it, asked only to tell work beyond the signposts from
 *  no work at all. */
export function nearestStoreHoldingAnywhere(
  bands: TargetBands,
  world: World,
  here: NodeId,
  goodType: number,
  owner: number | undefined,
  supply: SupplyTally,
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  if (sideLendsNone(bands, world, owner, goodType)) return null;
  return (
    bands
      .holding(goodType)
      .nearest(
        here,
        holdsUnclaimed(world, bands.ctx, supply, goodType),
        undefined,
        avoid,
        ownedBy(world, owner),
      )?.entity ?? null
  );
}

/** Whether no store on `owner`'s side, its own or an unowned one, lends a unit of `goodType` past its
 *  storage minimum, so {@link holdsUnclaimed} admits none of them and a search would sweep the band for
 *  nothing. An unowned fetcher keeps the search. */
function sideLendsNone(
  bands: TargetBands,
  world: World,
  owner: number | undefined,
  goodType: number,
): boolean {
  return owner !== undefined && !FetchableStock.of(world, bands.ctx).exceeds(owner, goodType, 0);
}

/** Only `owner`'s own stores: a neutral pile is nobody's to reach with signposts, so a cut-off verdict
 *  never rests on one lying at the far end of the map. Owner ruling. */
function ownedBy(world: World, owner: number | undefined): (store: Entity) => boolean {
  return (store) => ownerOf(world, store) === owner;
}

/** Whether `store` is a storehouse whose owner keeps any storage minimum. */
function storehouseKeepsMinimums(world: World, ctx: ContentContext, store: Entity): boolean {
  if (!anyStorageMinimum(world)) return false;
  const type = world.tryGet(store, Building)?.buildingType;
  return (
    type !== undefined &&
    isStorehouseType(ctx.content, type) &&
    keepsStorageMinimums(world, ownerOf(world, store))
  );
}

/** A band accept admitting a store that still lends `goodType` beyond the walkers' claims and its owner's
 *  minimum. The minimum's surplus is the same for every storehouse of one owner, so a scan rejecting a
 *  run of them sums the owner's claims once. */
function holdsUnclaimed(
  world: World,
  ctx: ContentContext,
  supply: SupplyTally,
  goodType: number,
): (store: Entity) => typeof QUALIFIES | null {
  let surplusByOwner: Map<number, number> | undefined;
  return (store) => {
    const held =
      (accessibleStockAmounts(world, store)?.get(goodType) ?? 0) - supply.reservedAt(store, goodType);
    if (held <= 0) return null;
    const owner = minimumBoundOwner(world, ctx, store, goodType);
    if (owner === undefined) return QUALIFIES;
    surplusByOwner ??= new Map();
    let surplus = surplusByOwner.get(owner);
    if (surplus === undefined) {
      surplus = storageSurplus(world, ctx, owner, goodType, supply);
      surplusByOwner.set(owner, surplus);
    }
    return surplus > 0 ? QUALIFIES : null;
  };
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
  return (
    unclaimedStockOf(world, ctx, undefined, store, goodType) > 0 &&
    mayFetchGoodFrom(world, ctx, store, goodType) &&
    !strandedPile(world, ctx, terrain, walls, store)
  );
}
