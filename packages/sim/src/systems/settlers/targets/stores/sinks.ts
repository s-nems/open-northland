import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Palisade,
  Position,
  RoadSite,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../../components/index.js';
import { JournaledCaptures } from '../../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { ContentContext } from '../../../context.js';
import { edibleClassOf } from '../../../readviews/food.js';
import { slottedGoods } from '../../../stores/index.js';
import { acceptsGood, canStoreGood, takesDeposits } from './stock.js';

/** The goods one store accepts, per producer mode; `storage` is the subset left with producers excluded.
 *  Refilled in place when its store is re-captured, so a stock change allocates no new lists. */
interface SinkCapture {
  readonly ordinary: number[];
  readonly storage: number[];
}

const NO_SINKS: ReadonlySet<Entity> = new Set();

/**
 * Per good, the stores {@link canStoreGood} accepts it into, in both producer modes. Kept across ticks
 * per world, so a tick pays for the stores whose stock or structure changed rather than a filter over
 * every stockpile per good asked.
 */
export class StoreSinks {
  private readonly ordinary = new Map<number, Set<Entity>>();
  private readonly storage = new Map<number, Set<Entity>>();
  private readonly captures: JournaledCaptures<SinkCapture>;
  /** The store whose withdrawal is held back until its re-capture is applied, its goods in the
   *  `withdrawn*` lists: a stock write re-captures a store that mostly accepts what it did, and taking it
   *  out of every good's set to put it back makes each set rebuild its table. */
  private withdrawn: Entity | null = null;

  private constructor(
    private readonly world: World,
    readonly content: ContentContext,
  ) {
    this.captures = new JournaledCaptures(
      world,
      {
        membership: [
          Stockpile,
          Position,
          Building,
          Palisade,
          RoadSite,
          GroundDrop,
          DeliveryFlag,
          UnderConstruction,
          Upgrading,
        ],
        values: [Stockpile, Building],
      },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e, spent) => sinkCaptureOf(world, content, e, spent),
        // Indexed: every stock write replays a store's capture, and a for-of here costs an iterator
        // result per good.
        apply: (e, c) => {
          if (this.withdrawn === e) {
            this.withdrawn = null;
            refile(this.ordinary, e, withdrawnOrdinary, c.ordinary);
            refile(this.storage, e, withdrawnStorage, c.storage);
            return;
          }
          this.settleWithdrawn();
          const { ordinary, storage } = c;
          for (let i = 0; i < ordinary.length; i++) membersOf(this.ordinary, ordinary[i] as number).add(e);
          for (let i = 0; i < storage.length; i++) membersOf(this.storage, storage[i] as number).add(e);
        },
        withdraw: (e, c) => {
          this.settleWithdrawn();
          this.withdrawn = e;
          hold(withdrawnOrdinary, c.ordinary);
          hold(withdrawnStorage, c.storage);
        },
        clear: () => {
          this.withdrawn = null;
          this.ordinary.clear();
          this.storage.clear();
        },
      },
    );
  }

  /** `world`'s ledger, caught up to its current stores. */
  static of(world: World, ctx: ContentContext): StoreSinks {
    let ledger = ledgers.get(world);
    if (ledger === undefined || ledger.content.content !== ctx.content) {
      if (ledger === undefined) {
        world.registerCacheVerifier('storeSinks', () => ledgers.get(world)?.verify() ?? []);
      }
      ledger = new StoreSinks(world, { content: ctx.content });
      ledgers.set(world, ledger);
    } else {
      ledger.catchUp();
    }
    return ledger;
  }

  private catchUp(): void {
    this.captures.catchUp();
    this.settleWithdrawn();
  }

  /** Take the held-back store out of its goods' sets: its re-capture found it accepts nothing. */
  private settleWithdrawn(): void {
    const e = this.withdrawn;
    if (e === null) return;
    this.withdrawn = null;
    unfile(this.ordinary, e, withdrawnOrdinary);
    unfile(this.storage, e, withdrawnStorage);
  }

  /** The stores accepting `goodType`, in no particular order. The live set: read it, never keep it past
   *  the next catch-up. */
  sinks(goodType: number, excludeProducers: boolean): ReadonlySet<Entity> {
    return (excludeProducers ? this.storage : this.ordinary).get(goodType) ?? NO_SINKS;
  }

  private verify(): string[] {
    this.catchUp();
    const { world, content } = this;
    const stores = world.canonicalQuery(Stockpile, Position);
    const problems: string[] = [];
    for (const excludeProducers of [false, true]) {
      for (const good of content.content.goods) {
        const fresh = stores.filter((e) => canStoreGood(world, content, e, good.typeId, excludeProducers));
        const held = this.sinks(good.typeId, excludeProducers);
        if (fresh.length !== held.size || fresh.some((e) => !held.has(e))) {
          problems.push(
            `storeSinks of good ${good.typeId} (excludeProducers ${excludeProducers}) disagree with a fresh store scan`,
          );
        }
      }
    }
    return problems;
  }
}

const ledgers = new WeakMap<World, StoreSinks>();

function sinkCaptureOf(
  world: World,
  ctx: ContentContext,
  e: Entity,
  spent: SinkCapture | undefined,
): SinkCapture | null {
  if (!takesDeposits(world, e)) return null;
  const capture = spent ?? { ordinary: [], storage: [] };
  const { ordinary, storage } = capture;
  // Written over the held lists and cut after: emptying a list first frees its storage, which the next
  // push reserves again.
  let taken = 0;
  let stored = 0;
  depositCandidates(world, ctx, e);
  for (let i = 0; i < candidateCount; i++) {
    const good = candidates[i] as number;
    if (!acceptsGood(world, ctx, e, good, false)) continue;
    if (taken < ordinary.length) ordinary[taken] = good;
    else ordinary.push(good);
    taken++;
    if (!acceptsGood(world, ctx, e, good, true)) continue;
    if (stored < storage.length) storage[stored] = good;
    else storage.push(good);
    stored++;
  }
  if (ordinary.length !== taken) ordinary.length = taken;
  if (storage.length !== stored) storage.length = stored;
  return taken === 0 ? null : capture;
}

/** {@link depositCandidates}' scratch list and its length: a capture reads it to the end before the next
 *  fills it. */
const candidates: number[] = [];
let candidateCount = 0;
/** The fill each good was last listed by, so a good is listed once without a set. */
const listedBy: number[] = [];
let fill = 0;

function listCandidate(good: number): void {
  if (listedBy[good] === fill) return;
  listedBy[good] = fill;
  candidates[candidateCount++] = good;
}

/** List in {@link candidates} every good a deposit may shelve in one of `store`'s slots: a slotted good,
 *  or a dish whose edible form is slotted, the two ways {@link bankedSlot} resolves a nonzero slot. */
function depositCandidates(world: World, ctx: ContentContext, store: Entity): void {
  fill++;
  candidateCount = 0;
  for (const slot of slottedGoods(world, ctx, store)) {
    listCandidate(slot);
    const dishes = edibleClassOf(ctx.content, slot);
    for (let i = 0; i < dishes.length; i++) listCandidate(dishes[i] as number);
  }
}

/** A good list kept across calls: `goods` only grows, since emptying a list frees its storage. */
interface HeldGoods {
  readonly goods: number[];
  count: number;
}

/** The goods of the store whose withdrawal {@link StoreSinks} holds back. */
const withdrawnOrdinary: HeldGoods = { goods: [], count: 0 };
const withdrawnStorage: HeldGoods = { goods: [], count: 0 };

function hold(into: HeldGoods, from: readonly number[]): void {
  for (let i = 0; i < from.length; i++) into.goods[i] = from[i] as number;
  into.count = from.length;
}

/** Take `e` out of the set of every good in `was`. */
function unfile(byGood: Map<number, Set<Entity>>, e: Entity, was: HeldGoods): void {
  for (let i = 0; i < was.count; i++) byGood.get(was.goods[i] as number)?.delete(e);
}

/** Move `e` from the sets of the goods in `was` to those in `now`, touching only the sets that differ. */
function refile(byGood: Map<number, Set<Entity>>, e: Entity, was: HeldGoods, now: readonly number[]): void {
  if (sameGoods(was, now)) return;
  for (let i = 0; i < was.count; i++) {
    const good = was.goods[i] as number;
    if (!now.includes(good)) byGood.get(good)?.delete(e);
  }
  for (let i = 0; i < now.length; i++) {
    const good = now[i] as number;
    if (!holds(was, good)) membersOf(byGood, good).add(e);
  }
}

function holds(held: HeldGoods, good: number): boolean {
  for (let i = 0; i < held.count; i++) if (held.goods[i] === good) return true;
  return false;
}

function sameGoods(was: HeldGoods, now: readonly number[]): boolean {
  if (was.count !== now.length) return false;
  for (let i = 0; i < now.length; i++) if (was.goods[i] !== now[i]) return false;
  return true;
}

function membersOf(byGood: Map<number, Set<Entity>>, good: number): Set<Entity> {
  let members = byGood.get(good);
  if (members === undefined) {
    members = new Set();
    byGood.set(good, members);
  }
  return members;
}

/** Tick-local memo for the position-independent question "can any store accept this good?", frozen at
 * its first answer for the pass. Actual nearest-store picks still use {@link nearestStoreFor}; this only
 * replaces repeated null probes, so it cannot change a winner. */
export class SinkAvailability {
  private readonly ordinary = new Map<number, boolean>();
  private readonly storageOnly = new Map<number, boolean>();

  constructor(
    private readonly world: World,
    private readonly ctx: ContentContext,
  ) {}

  has(goodType: number, excludeProducers = false): boolean {
    const memo = excludeProducers ? this.storageOnly : this.ordinary;
    const known = memo.get(goodType);
    if (known !== undefined) return known;
    const available = StoreSinks.of(this.world, this.ctx).sinks(goodType, excludeProducers).size > 0;
    memo.set(goodType, available);
    return available;
  }
}
