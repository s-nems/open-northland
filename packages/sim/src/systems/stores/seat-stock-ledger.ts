import {
  Building,
  Carrying,
  Owner,
  Position,
  Signpost,
  Stockpile,
  Upgrading,
} from '../../components/index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import {
  anchorReaches,
  deriveSeatStockTotals,
  NEIGHBOUR_BUCKET_OFFSETS,
  reachBucketOf,
  type SeatStock,
  seatStockFrom,
} from './seat-stock.js';

/** An owned entity's units: its pile, the stock it keeps aside while upgrading, the unit in its hands. */
interface OwnedUnits {
  readonly player: number;
  readonly units: ReadonlyMap<number, number>;
}

/** An owned building or signpost standing on the map. */
interface Anchor {
  readonly player: number;
  readonly node: HalfCellNode;
  readonly bucket: number;
}

/** An unowned pile on the ground, and the seats whose anchors currently reach it. */
interface Heap {
  readonly node: HalfCellNode;
  readonly bucket: number;
  readonly units: ReadonlyMap<number, number>;
  seats: readonly number[];
}

/** Units by good, per seat. */
type SeatTotals = Map<number, Map<number, number>>;

/**
 * Every seat's {@link SeatStock}, kept across ticks per world so a read pays for the stores, anchors and
 * heaps that changed rather than a fold over the map. A heap's seats are re-tested when it changes and
 * when an anchor appears or leaves within reach. Heaps, buildings and signposts never move in place (a
 * relocation re-adds a component or re-creates the entity), so membership journals catch every move.
 */
class SeatStockLedger {
  private readonly ownedTotals: SeatTotals = new Map();
  private readonly heapTotals: SeatTotals = new Map();
  private readonly anchorBuckets = new Map<number, Map<Entity, Anchor>>();
  private readonly heapBuckets = new Map<number, Map<Entity, Heap>>();
  /** Buckets whose anchors changed since their neighbourhood's heaps were last re-tested. */
  private readonly staleBuckets = new Set<number>();
  /** Bumped by every change to the totals; a seat's snapshot is fresh while it matches. */
  private revision = 0;
  private readonly snapshots = new Map<number, { readonly revision: number; readonly stock: SeatStock }>();
  private readonly anchors: JournaledCaptures<Anchor>;
  private readonly heaps: JournaledCaptures<Heap>;
  private readonly owned: JournaledCaptures<OwnedUnits>;

  constructor(private readonly world: World) {
    // Anchors first: a heap takes its seats from the anchor index when it is applied.
    this.anchors = new JournaledCaptures(
      world,
      { membership: [Owner, Building, Signpost, Position], values: [Owner] },
      () => world.query(Owner),
      {
        capture: (e) => anchorOf(world, e),
        apply: (e, anchor) => {
          bucketOf(this.anchorBuckets, anchor.bucket).set(e, anchor);
          this.staleBuckets.add(anchor.bucket);
        },
        withdraw: (e, anchor) => {
          this.anchorBuckets.get(anchor.bucket)?.delete(e);
          this.staleBuckets.add(anchor.bucket);
        },
        clear: () => {
          for (const bucket of this.anchorBuckets.keys()) this.staleBuckets.add(bucket);
          this.anchorBuckets.clear();
        },
      },
    );
    this.heaps = new JournaledCaptures(
      world,
      { membership: [Stockpile, Owner, Position], values: [Stockpile] },
      () => world.query(Stockpile),
      {
        capture: (e) => heapOf(world, e),
        apply: (e, heap) => {
          bucketOf(this.heapBuckets, heap.bucket).set(e, heap);
          heap.seats = this.seatsReaching(heap.node);
          for (const seat of heap.seats) this.fold(this.heapTotals, seat, heap.units, 1);
        },
        withdraw: (e, heap) => {
          this.heapBuckets.get(heap.bucket)?.delete(e);
          for (const seat of heap.seats) this.fold(this.heapTotals, seat, heap.units, -1);
        },
        clear: () => {
          this.heapBuckets.clear();
          this.heapTotals.clear();
          this.revision++;
        },
      },
    );
    this.staleBuckets.clear();
    this.owned = new JournaledCaptures(
      world,
      {
        membership: [Owner, Stockpile, Upgrading, Carrying],
        values: [Owner, Stockpile, Upgrading, Carrying],
      },
      () => world.query(Owner),
      {
        capture: (e) => ownedUnitsOf(world, e),
        apply: (_, owned) => this.fold(this.ownedTotals, owned.player, owned.units, 1),
        withdraw: (_, owned) => this.fold(this.ownedTotals, owned.player, owned.units, -1),
        clear: () => {
          this.ownedTotals.clear();
          this.revision++;
        },
      },
    );
  }

  /** `world`'s ledger, caught up to its current stock. */
  static of(world: World): SeatStockLedger {
    let ledger = ledgers.get(world);
    if (ledger === undefined) {
      ledger = new SeatStockLedger(world);
      ledgers.set(world, ledger);
      world.registerCacheVerifier('seatStock', () => ledgers.get(world)?.verify() ?? []);
    } else ledger.catchUp();
    return ledger;
  }

  /** `player`'s figure as of the last catch-up, one object while nothing has changed since. */
  stock(player: number): SeatStock {
    const held = this.snapshots.get(player);
    if (held !== undefined && held.revision === this.revision) return held.stock;
    const stock = seatStockFrom(this.totalsOf(player));
    this.snapshots.set(player, { revision: this.revision, stock });
    return stock;
  }

  catchUp(): void {
    this.anchors.catchUp();
    this.heaps.catchUp();
    this.owned.catchUp();
    this.reseatStaleHeaps();
  }

  private totalsOf(player: number): Map<number, number> {
    const totals = new Map(this.ownedTotals.get(player));
    for (const [good, units] of this.heapTotals.get(player) ?? []) {
      totals.set(good, (totals.get(good) ?? 0) + units);
    }
    return totals;
  }

  /** The seats with an anchor in reach of `node`, each once. */
  private seatsReaching(node: HalfCellNode): number[] {
    const seats: number[] = [];
    const key = reachBucketOf(node.hx, node.hy);
    for (const offset of NEIGHBOUR_BUCKET_OFFSETS) {
      const bucket = this.anchorBuckets.get(key + offset);
      if (bucket === undefined) continue;
      for (const anchor of bucket.values()) {
        if (!seats.includes(anchor.player) && anchorReaches(anchor.node, node)) seats.push(anchor.player);
      }
    }
    return seats;
  }

  /** Re-test the heaps around every bucket whose anchors changed, moving a heap's units between seats. */
  private reseatStaleHeaps(): void {
    if (this.staleBuckets.size === 0) return;
    const around = new Set<number>();
    for (const bucket of this.staleBuckets) {
      for (const offset of NEIGHBOUR_BUCKET_OFFSETS) around.add(bucket + offset);
    }
    this.staleBuckets.clear();
    for (const bucket of around) {
      for (const heap of this.heapBuckets.get(bucket)?.values() ?? []) {
        const seats = this.seatsReaching(heap.node);
        if (sameSeats(seats, heap.seats)) continue;
        for (const seat of heap.seats) this.fold(this.heapTotals, seat, heap.units, -1);
        heap.seats = seats;
        for (const seat of seats) this.fold(this.heapTotals, seat, heap.units, 1);
      }
    }
  }

  private fold(totals: SeatTotals, player: number, units: ReadonlyMap<number, number>, sign: 1 | -1): void {
    let seat = totals.get(player);
    if (seat === undefined) {
      seat = new Map();
      totals.set(player, seat);
    }
    for (const [good, amount] of units) seat.set(good, (seat.get(good) ?? 0) + sign * amount);
    this.revision++;
  }

  private verify(): string[] {
    this.catchUp();
    const players = new Set([...this.ownedTotals.keys(), ...this.heapTotals.keys()]);
    for (const e of this.world.query(Owner)) players.add(this.world.get(e, Owner).player);
    const errors: string[] = [];
    for (const player of players) {
      const live = this.totalsOf(player);
      const fresh = deriveSeatStockTotals(this.world, player);
      for (const good of new Set([...live.keys(), ...fresh.keys()])) {
        if ((live.get(good) ?? 0) !== (fresh.get(good) ?? 0)) {
          errors.push(`seatStock of player ${player}, good ${good}, disagrees with a fresh fold`);
        }
      }
    }
    return errors;
  }
}

const ledgers = new WeakMap<World, SeatStockLedger>();

/**
 * `player`'s {@link SeatStock} as the world stands. Derived read-state, never hashed: the modules of one
 * seat's decision, and the seats deciding on one tick, share one catch-up of the ledger.
 */
export function seatStockOf(world: World, player: number): SeatStock {
  return SeatStockLedger.of(world).stock(player);
}

/**
 * Catch `world`'s ledger up, when a read has created one. Run every tick: the journals keep a bounded
 * window, and a busy map writes more than it between one cluster of seat turns and the next, which
 * would cost that cluster's first read a rebuild.
 */
export function catchUpSeatStock(world: World): void {
  ledgers.get(world)?.catchUp();
}

function anchorOf(world: World, e: Entity): Anchor | null {
  const player = world.tryGet(e, Owner)?.player;
  if (player === undefined || !(world.has(e, Building) || world.has(e, Signpost))) return null;
  const p = world.tryGet(e, Position);
  if (p === undefined) return null;
  const node = nodeOfPosition(p.x, p.y);
  return { player, node, bucket: reachBucketOf(node.hx, node.hy) };
}

function heapOf(world: World, e: Entity): Heap | null {
  if (world.has(e, Owner)) return null;
  const stock = world.tryGet(e, Stockpile);
  const p = world.tryGet(e, Position);
  if (stock === undefined || p === undefined) return null;
  const node = nodeOfPosition(p.x, p.y);
  return { node, bucket: reachBucketOf(node.hx, node.hy), units: new Map(stock.amounts), seats: [] };
}

function ownedUnitsOf(world: World, e: Entity): OwnedUnits | null {
  const player = world.tryGet(e, Owner)?.player;
  if (player === undefined) return null;
  const pile = world.tryGet(e, Stockpile)?.amounts;
  const saved = world.tryGet(e, Upgrading)?.savedStock;
  const carried = world.tryGet(e, Carrying);
  if (pile === undefined && saved === undefined && carried === undefined) return null;
  const units = new Map(pile);
  for (const [good, amount] of saved ?? []) units.set(good, (units.get(good) ?? 0) + amount);
  if (carried !== undefined) units.set(carried.goodType, (units.get(carried.goodType) ?? 0) + carried.amount);
  return { player, units };
}

function bucketOf<T>(buckets: Map<number, Map<Entity, T>>, key: number): Map<Entity, T> {
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = new Map();
    buckets.set(key, bucket);
  }
  return bucket;
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((seat) => b.includes(seat));
}
