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

/** The goods one store accepts, per producer mode; `storage` is the subset left with producers excluded. */
interface SinkCapture {
  readonly ordinary: readonly number[];
  readonly storage: readonly number[];
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
        capture: (e) => sinkCaptureOf(world, content, e),
        apply: (e, c) => {
          for (const good of c.ordinary) membersOf(this.ordinary, good).add(e);
          for (const good of c.storage) membersOf(this.storage, good).add(e);
        },
        withdraw: (e, c) => {
          for (const good of c.ordinary) this.ordinary.get(good)?.delete(e);
          for (const good of c.storage) this.storage.get(good)?.delete(e);
        },
        clear: () => {
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
      ledger.captures.catchUp();
    }
    return ledger;
  }

  /** The stores accepting `goodType`, in no particular order. The live set: read it, never keep it past
   *  the next catch-up. */
  sinks(goodType: number, excludeProducers: boolean): ReadonlySet<Entity> {
    return (excludeProducers ? this.storage : this.ordinary).get(goodType) ?? NO_SINKS;
  }

  private verify(): string[] {
    this.captures.catchUp();
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

function sinkCaptureOf(world: World, ctx: ContentContext, e: Entity): SinkCapture | null {
  if (!takesDeposits(world, e)) return null;
  const ordinary: number[] = [];
  const storage: number[] = [];
  for (const good of depositCandidates(world, ctx, e)) {
    if (!acceptsGood(world, ctx, e, good, false)) continue;
    ordinary.push(good);
    if (acceptsGood(world, ctx, e, good, true)) storage.push(good);
  }
  return ordinary.length === 0 ? null : { ordinary, storage };
}

/** Every good a deposit may shelve in one of `store`'s slots: a slotted good, or a dish whose edible form
 *  is slotted, the two ways {@link bankedSlot} resolves a nonzero slot. */
function depositCandidates(world: World, ctx: ContentContext, store: Entity): Set<number> {
  const goods = new Set<number>();
  for (const slot of slottedGoods(world, ctx, store)) {
    goods.add(slot);
    for (const good of edibleClassOf(ctx.content, slot)) goods.add(good);
  }
  return goods;
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
