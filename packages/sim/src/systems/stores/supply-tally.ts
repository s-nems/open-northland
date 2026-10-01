import { Carrying, SupplyRun } from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';

type SupplyRunView = NonNullable<(typeof SupplyRun)['__value']>;
type PerGoodTally = Map<Entity, Map<number, number>>;

/** The tally a logged pass delta folded into. */
const INBOUND_SIDE = 0;
const SOURCE_SIDE = 1;
/** Numbers per logged pass delta: side, entity, good, amount. */
const PASS_DELTA_STRIDE = 4;

/**
 * Tallies of supply units committed by live {@link SupplyRun} errands. `inbound` is keyed by destination
 * site and `reservedAtSource` by the store the pickup leg is walking to. Every stamp and release folds into
 * both in lockstep, so a mid-pass read matches a full store scan.
 *
 * The source side only steers construction fetchers apart when they choose a store. The pickup itself
 * stays first come, first served: no other trade reads the reservation, so refusing a unit at the counter
 * would leave that settler retrying the same store until the promised builder arrived.
 *
 * One tally per world, kept across passes: {@link collectInboundSupply} undoes the last pass's stamps and
 * releases, then recounts only the errands whose run or carry changed since, which leaves exactly what a
 * full scan would build.
 */
export class InboundSupplyTally {
  readonly inbound: PerGoodTally = new Map();
  readonly reservedAtSource: PerGoodTally = new Map();
  /** The run each errand was last counted with, and which of them held a live source reservation. */
  private readonly counted = new Map<Entity, SupplyRunView>();
  private readonly countedAtSource = new Set<Entity>();
  /** Stamp and release deltas since the last collect, {@link PASS_DELTA_STRIDE} numbers each, cut by
   *  count so the backing store survives. */
  private readonly passDeltas: number[] = [];
  private passDeltaLength = 0;
  private readonly recountEntity = (entity: Entity): void => this.recount(entity);

  constructor(
    private readonly world: World,
    private readonly changes: ChangeFeed,
  ) {
    this.rebuild();
  }

  /** Fold a stamp or release into the tally, logged so the next collect can undo it. */
  foldPassDelta(
    side: typeof INBOUND_SIDE | typeof SOURCE_SIDE,
    entity: Entity,
    goodType: number,
    delta: number,
  ): void {
    addAmount(side === INBOUND_SIDE ? this.inbound : this.reservedAtSource, entity, goodType, delta);
    const at = this.passDeltaLength;
    this.passDeltas[at] = side;
    this.passDeltas[at + 1] = entity;
    this.passDeltas[at + 2] = goodType;
    this.passDeltas[at + 3] = delta;
    this.passDeltaLength = at + PASS_DELTA_STRIDE;
  }

  /** Bring the tally to what a full scan of the live errands would build now. */
  refresh(): void {
    for (let at = this.passDeltaLength - PASS_DELTA_STRIDE; at >= 0; at -= PASS_DELTA_STRIDE) {
      const tally = this.passDeltas[at] === INBOUND_SIDE ? this.inbound : this.reservedAtSource;
      addAmount(
        tally,
        this.passDeltas[at + 1] as Entity,
        this.passDeltas[at + 2] ?? 0,
        -(this.passDeltas[at + 3] ?? 0),
      );
    }
    this.passDeltaLength = 0;
    if (this.changes.pending && this.changes.drain(this.recountEntity)) this.rebuild();
  }

  /** Mismatches between the tally, the counted runs and the world, for the cache verifier. */
  verify(): string[] {
    const pending = new Set<Entity>();
    if (this.changes.peek((entity) => pending.add(entity))) return [];
    for (const e of this.world.query(SupplyRun)) {
      if (pending.has(e)) continue;
      const run = this.world.get(e, SupplyRun);
      if (this.counted.get(e) !== run) return [`inbound supply: errand ${e} counted with a stale run`];
      if (sourceReservationIsLive(this.world, e, run) !== this.countedAtSource.has(e)) {
        return [`inbound supply: errand ${e} counted with a stale source reservation`];
      }
    }
    const inbound: PerGoodTally = new Map();
    const atSource: PerGoodTally = new Map();
    for (const [e, run] of this.counted) {
      if (!pending.has(e) && !this.world.has(e, SupplyRun))
        return [`inbound supply: ${e} counted without an errand`];
      addAmount(inbound, run.site, run.goodType, run.amount);
      if (run.source !== null && this.countedAtSource.has(e))
        addAmount(atSource, run.source, run.goodType, run.amount);
    }
    for (let at = 0; at < this.passDeltaLength; at += PASS_DELTA_STRIDE) {
      const tally = this.passDeltas[at] === INBOUND_SIDE ? inbound : atSource;
      addAmount(
        tally,
        this.passDeltas[at + 1] as Entity,
        this.passDeltas[at + 2] ?? 0,
        this.passDeltas[at + 3] ?? 0,
      );
    }
    if (!sameTally(inbound, this.inbound)) return ['inbound supply: site tally differs'];
    if (!sameTally(atSource, this.reservedAtSource)) return ['inbound supply: source tally differs'];
    return [];
  }

  private rebuild(): void {
    this.inbound.clear();
    this.reservedAtSource.clear();
    this.counted.clear();
    this.countedAtSource.clear();
    this.passDeltaLength = 0;
    for (const e of this.world.query(SupplyRun)) this.count(e);
  }

  private recount(entity: Entity): void {
    const prior = this.counted.get(entity);
    if (prior !== undefined) {
      addAmount(this.inbound, prior.site, prior.goodType, -prior.amount);
      if (prior.source !== null && this.countedAtSource.has(entity)) {
        addAmount(this.reservedAtSource, prior.source, prior.goodType, -prior.amount);
      }
      this.counted.delete(entity);
      this.countedAtSource.delete(entity);
    }
    this.count(entity);
  }

  private count(entity: Entity): void {
    const run = this.world.tryGet(entity, SupplyRun);
    if (run === undefined) return;
    this.counted.set(entity, run);
    addAmount(this.inbound, run.site, run.goodType, run.amount);
    if (sourceReservationIsLive(this.world, entity, run)) {
      this.countedAtSource.add(entity);
      addAmount(this.reservedAtSource, run.source, run.goodType, run.amount);
    }
  }
}

function sameTally(a: PerGoodTally, b: PerGoodTally): boolean {
  if (a.size !== b.size) return false;
  for (const [entity, perGood] of a) {
    const other = b.get(entity);
    if (other === undefined || other.size !== perGood.size) return false;
    for (const [goodType, amount] of perGood) if (other.get(goodType) !== amount) return false;
  }
  return true;
}

const talliesByWorld = new WeakMap<World, InboundSupplyTally>();

/** The world's tally, brought up to every live SupplyRun - errands still in flight from earlier ticks.
 *  The same instance each call, so a tally from an earlier collect reads the current errands too. */
export function collectInboundSupply(world: World): InboundSupplyTally {
  const held = talliesByWorld.get(world);
  if (held !== undefined) {
    held.refresh();
    return held;
  }
  const tally = new InboundSupplyTally(world, world.watchChanges([SupplyRun, Carrying], [SupplyRun]));
  talliesByWorld.set(world, tally);
  world.registerCacheVerifier('inboundSupplyTally', () => tally.verify());
  return tally;
}

/** Units of `goodType` inbound to `site`. */
export function inboundSupplyOf(tally: InboundSupplyTally, site: Entity, goodType: number): number {
  return tally.inbound.get(site)?.get(goodType) ?? 0;
}

/** Whether any live errand is bringing material to `site`. */
export function hasInboundSupply(tally: InboundSupplyTally, site: Entity): boolean {
  return tally.inbound.has(site);
}

/** Units of `goodType` already promised from `source` to construction pickups. */
export function reservedSourceSupplyOf(tally: InboundSupplyTally, source: Entity, goodType: number): number {
  return tally.reservedAtSource.get(source)?.get(goodType) ?? 0;
}

/** Stamp a settler's supply errand and fold its amount into the tally, so a settler planned later this
 *  tick already counts the unit as inbound. */
export function stampSupplyRun(
  world: World,
  entity: Entity,
  tally: InboundSupplyTally,
  run: { site: Entity; goodType: number; amount: number; source: Entity | null },
): void {
  const prior = world.tryGet(entity, SupplyRun);
  if (prior !== undefined) {
    tally.foldPassDelta(INBOUND_SIDE, prior.site, prior.goodType, -prior.amount);
    if (sourceReservationIsLive(world, entity, prior)) {
      tally.foldPassDelta(SOURCE_SIDE, prior.source, prior.goodType, -prior.amount);
    }
  }
  world.add(entity, SupplyRun, run);
  tally.foldPassDelta(INBOUND_SIDE, run.site, run.goodType, run.amount);
  if (run.source !== null) tally.foldPassDelta(SOURCE_SIDE, run.source, run.goodType, run.amount);
}

/** Release a replanning settler's stale supply errand, the mirror of {@link stampSupplyRun}. */
export function releaseSupplyRun(world: World, entity: Entity, tally: InboundSupplyTally): void {
  const run = world.tryGet(entity, SupplyRun);
  if (run === undefined) return;
  tally.foldPassDelta(INBOUND_SIDE, run.site, run.goodType, -run.amount);
  if (sourceReservationIsLive(world, entity, run)) {
    tally.foldPassDelta(SOURCE_SIDE, run.source, run.goodType, -run.amount);
  }
  world.remove(entity, SupplyRun);
}

/** Fold `delta` into an entity's per-good count, pruning a slot that returns to zero so the tally stays
 *  the minimal set a full scan would build. */
function addAmount(tally: PerGoodTally, entity: Entity, goodType: number, delta: number): void {
  let perGood = tally.get(entity);
  if (perGood === undefined) {
    perGood = new Map();
    tally.set(entity, perGood);
  }
  const next = (perGood.get(goodType) ?? 0) + delta;
  if (next === 0) perGood.delete(goodType);
  else perGood.set(goodType, next);
  if (perGood.size === 0) tally.delete(entity);
}

/** Source stock is promised only until it reaches the settler's hands. The destination promise remains
 *  live for the carrying leg, but counting the source then would subtract the same unit twice. */
function sourceReservationIsLive(
  world: World,
  entity: Entity,
  run: SupplyRunView,
): run is SupplyRunView & {
  source: Entity;
} {
  return run.source !== null && !world.has(entity, Carrying);
}
