import {
  AiPlayer,
  Owner,
  RoadTraffic,
  type RoadTrafficState,
  Settler,
  Vehicle,
} from '../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

/** The side of the square of half-cell nodes one traffic bucket counts (authored): four cells a side,
 *  about the width of a work area, so one walk crosses a bucket in a handful of steps. */
export const TRAFFIC_BUCKET_NODES = 8;

/** Game ticks over which a bucket's count halves (authored): five minutes at 12 ticks a second, so a
 *  way the seat stopped walking cools off within a stretch of the game. */
export const TRAFFIC_HALF_LIFE_TICKS = 3600;

/** Past this many halvings every count a game can reach reads 0. */
const MAX_HALVINGS = 31;

/** A seat's counting for one tick: note that walker `e` stepped from `from` onto `to`. */
export type TrafficCounter = (e: Entity, from: NodeId, to: NodeId) => void;

/** Traffic buckets per row of the map's lattice. */
function bucketsPerRow(terrain: TerrainGraph): number {
  return Math.ceil(terrain.width / TRAFFIC_BUCKET_NODES);
}

function bucketOf(terrain: TerrainGraph, x: number, y: number): number {
  return Math.floor(y / TRAFFIC_BUCKET_NODES) * bucketsPerRow(terrain) + Math.floor(x / TRAFFIC_BUCKET_NODES);
}

const epochOf = (tick: number): number => Math.floor(tick / TRAFFIC_HALF_LIFE_TICKS);

/** `value` halved once per half-life between `from` and `to`, rounding down. */
function halved(value: number, from: number, to: number): number {
  const halvings = to - from;
  if (halvings <= 0) return value;
  return halvings > MAX_HALVINGS ? 0 : Math.floor(value / 2 ** halvings);
}

/** The off-road walks a bucket counts at `tick`, its halvings since it was last written applied. */
export function trafficWalksAt(traffic: DeepReadonly<RoadTrafficState>, tick: number): number {
  return halved(traffic.walks, traffic.epoch, epochOf(tick));
}

interface TrafficIndex {
  /** `RoadTraffic`'s membership generation this index matches. */
  generation: number;
  /** player -> bucket -> its entity. */
  readonly seats: Map<number, Map<number, Entity>>;
}

/** Derived per world: which entity holds each (seat, bucket). Rebuilt whenever the store's membership
 *  moved other than through this module, so it never answers from stale entities. */
const indexes = new WeakMap<World, TrafficIndex>();

function trafficIndex(world: World): TrafficIndex {
  const generation = world.componentGeneration(RoadTraffic);
  const held = indexes.get(world);
  if (held !== undefined && held.generation === generation) return held;
  const index: TrafficIndex = { generation, seats: new Map() };
  for (const e of world.query(RoadTraffic)) {
    const { player, bucket } = world.get(e, RoadTraffic);
    seatBuckets(index, player).set(bucket, e);
  }
  indexes.set(world, index);
  return index;
}

function seatBuckets(index: TrafficIndex, player: number): Map<number, Entity> {
  let buckets = index.seats.get(player);
  if (buckets === undefined) {
    buckets = new Map();
    index.seats.set(player, buckets);
  }
  return buckets;
}

/** Count one off-road walk of `player` entering `bucket` on node (`x`, `y`). */
function countWalk(world: World, player: number, bucket: number, x: number, y: number, tick: number): void {
  const index = trafficIndex(world);
  const buckets = seatBuckets(index, player);
  const epoch = epochOf(tick);
  const e = buckets.get(bucket);
  if (e === undefined) {
    const created = world.create();
    world.add(created, RoadTraffic, { player, bucket, walks: 1, sumX: x, sumY: y, epoch, retryTick: 0 });
    buckets.set(bucket, created);
    index.generation = world.componentGeneration(RoadTraffic);
    return;
  }
  const traffic = world.mut(e, RoadTraffic);
  const walks = halved(traffic.walks, traffic.epoch, epoch);
  // The sums shrink with the count, so their mean, the walks' average entry node, holds.
  traffic.sumX = scaledSum(traffic.sumX, walks, traffic.walks) + x;
  traffic.sumY = scaledSum(traffic.sumY, walks, traffic.walks) + y;
  traffic.walks = walks + 1;
  traffic.epoch = epoch;
}

/** `sum` over `was` walks scaled to `walks`; the product stays far inside the safe integer range. */
function scaledSum(sum: number, walks: number, was: number): number {
  return was === 0 ? 0 : Math.floor((sum * walks) / was);
}

/**
 * This tick's traffic counter, or null when no seat counts: a computer seat counts while its roadBuild
 * module runs, so a human seat, or a map without roads for the AI, pays nothing. A settler of such a seat
 * counts a step on land that enters another bucket off-road: a walk crossing the bucket, where a road
 * would serve it, not a man working inside one, and a road already under his feet needs nothing.
 */
export function trafficCounter(world: World, ctx: SystemContext): TrafficCounter | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  let seats: Set<number> | null = null;
  for (const e of world.query(AiPlayer)) {
    const seat = world.get(e, AiPlayer);
    if (!seat.modules.roadBuild) continue;
    seats ??= new Set();
    seats.add(seat.player);
  }
  if (seats === null) return null;
  const counting = seats;
  const tick = ctx.tick;
  return (e, from, to) => {
    const x = terrain.xOf(to);
    const y = terrain.yOf(to);
    const bucket = bucketOf(terrain, x, y);
    if (bucket === bucketOf(terrain, terrain.xOf(from), terrain.yOf(from))) return;
    if (terrain.isRoad(to) || !terrain.isWalkable(to)) return;
    const player = world.tryGet(e, Owner)?.player;
    if (player === undefined || !counting.has(player)) return;
    if (!world.has(e, Settler) || world.has(e, Vehicle)) return;
    countWalk(world, player, bucket, x, y, tick);
  };
}

/** A bucket the seat walks enough to pave from: its entity, its count and where its walks entered on
 *  average. */
export interface HotTraffic {
  readonly entity: Entity;
  readonly walks: number;
  readonly centre: HalfCellNode;
}

/**
 * The seat's busiest bucket at `tick` counting at least `minWalks` and not waiting out a retry, ties to
 * the lower bucket index; null when none does. One pass over the seat's buckets, which also drops those
 * that cooled to nothing, so the list holds only the ground the seat walked within a few half-lives.
 */
export function hottestTraffic(
  world: World,
  player: number,
  tick: number,
  minWalks: number,
): HotTraffic | null {
  const index = trafficIndex(world);
  const buckets = index.seats.get(player);
  if (buckets === undefined) return null;
  let best: { e: Entity; walks: number; bucket: number } | null = null;
  const cold: Entity[] = [];
  for (const [bucket, e] of buckets) {
    const traffic = world.get(e, RoadTraffic);
    const walks = trafficWalksAt(traffic, tick);
    if (walks === 0) {
      if (traffic.retryTick <= tick) cold.push(e);
      continue;
    }
    if (walks < minWalks || traffic.retryTick > tick) continue;
    if (best === null || walks > best.walks || (walks === best.walks && bucket < best.bucket)) {
      best = { e, walks, bucket };
    }
  }
  if (cold.length > 0) {
    // By id: the index's order differs between a restored world and one that ran on, the teardown's must not.
    cold.sort((a, b) => a - b);
    for (const e of cold) {
      buckets.delete(world.get(e, RoadTraffic).bucket);
      world.destroy(e);
    }
    index.generation = world.componentGeneration(RoadTraffic);
  }
  if (best === null) return null;
  const { sumX, sumY, walks } = world.get(best.e, RoadTraffic);
  return {
    entity: best.e,
    walks: best.walks,
    centre: { hx: Math.floor(sumX / walks), hy: Math.floor(sumY / walks) },
  };
}

/** Leave `traffic`'s bucket out of the road decision until `retryTick`. */
export function deferTraffic(world: World, traffic: Entity, retryTick: number): void {
  world.mut(traffic, RoadTraffic).retryTick = retryTick;
}

/** Forget `traffic`'s count as of `tick`: a road answered it, so only walks from now on count again. */
export function clearTraffic(world: World, traffic: Entity, tick: number): void {
  const value = world.mut(traffic, RoadTraffic);
  value.walks = 0;
  value.sumX = 0;
  value.sumY = 0;
  value.epoch = epochOf(tick);
}

/**
 * Forget the counts of `player`'s buckets that `nodes` cross and of the buckets around them, as of
 * `tick`, all but `keep`'s: walks that near a new road will take it, so only those that still go
 * off-road count toward the next one. At most nine buckets per node, over the nodes one route places.
 */
export function clearTrafficAround(
  world: World,
  terrain: TerrainGraph,
  player: number,
  nodes: readonly NodeId[],
  tick: number,
  keep: Entity,
): void {
  const buckets = trafficIndex(world).seats.get(player);
  if (buckets === undefined) return;
  const perRow = bucketsPerRow(terrain);
  const rows = Math.ceil(terrain.height / TRAFFIC_BUCKET_NODES);
  const cleared = new Set<number>();
  for (const node of nodes) {
    const bx = Math.floor(terrain.xOf(node) / TRAFFIC_BUCKET_NODES);
    const by = Math.floor(terrain.yOf(node) / TRAFFIC_BUCKET_NODES);
    for (let y = Math.max(0, by - 1); y <= Math.min(rows - 1, by + 1); y++) {
      for (let x = Math.max(0, bx - 1); x <= Math.min(perRow - 1, bx + 1); x++) {
        const bucket = y * perRow + x;
        if (cleared.has(bucket)) continue;
        cleared.add(bucket);
        const e = buckets.get(bucket);
        if (e !== undefined && e !== keep && world.get(e, RoadTraffic).walks > 0)
          clearTraffic(world, e, tick);
      }
    }
  }
}
