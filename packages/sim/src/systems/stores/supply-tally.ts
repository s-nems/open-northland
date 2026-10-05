import { PickupClaim, SupplyRun } from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Component, DeepReadonly, Entity, World } from '../../ecs/world.js';

type SupplyRunView = NonNullable<(typeof SupplyRun)['__value']>;
type PickupClaimView = NonNullable<(typeof PickupClaim)['__value']>;
type PerGoodTally = Map<Entity, Map<number, number>>;

/** One counted errand, copied so an in-place write to the component cannot change what the undo
 *  subtracts. `place` is the destination of a supply run or the source of a pickup claim. */
interface CountedErrand {
  readonly place: Entity;
  readonly goodType: number;
  readonly amount: number;
}

/** One side of the tally: the per-place totals one errand component's live values build, and what each
 *  errand was counted with. */
class TallySide<V extends { readonly goodType: number; readonly amount: number }> {
  readonly totals: PerGoodTally = new Map();
  private readonly counted = new Map<Entity, CountedErrand>();

  constructor(
    private readonly world: World,
    private readonly component: Component<V>,
    private readonly placeOf: (value: DeepReadonly<V>) => Entity,
  ) {}

  rebuild(): void {
    this.totals.clear();
    this.counted.clear();
    for (const e of this.world.query(this.component)) this.count(e);
  }

  recount(entity: Entity): void {
    const prior = this.counted.get(entity);
    if (prior !== undefined) {
      addAmount(this.totals, prior.place, prior.goodType, -prior.amount);
      this.counted.delete(entity);
    }
    this.count(entity);
  }

  /** Mismatches between this side and a full scan, skipping `pending` entities the feed still holds and
   *  adding the pass deltas folded in since the last collect. */
  verify(name: string, pending: ReadonlySet<Entity>, passDeltas: PerGoodTally): string[] {
    for (const e of this.world.query(this.component)) {
      if (pending.has(e)) continue;
      const value = this.world.get(e, this.component);
      const counted = this.counted.get(e);
      if (
        counted === undefined ||
        counted.place !== this.placeOf(value) ||
        counted.goodType !== value.goodType ||
        counted.amount !== value.amount
      ) {
        return [`${name}: errand ${e} counted with a stale value`];
      }
    }
    const scan: PerGoodTally = new Map();
    for (const [e, errand] of this.counted) {
      if (!pending.has(e) && !this.world.has(e, this.component))
        return [`${name}: ${e} counted without an errand`];
      addAmount(scan, errand.place, errand.goodType, errand.amount);
    }
    for (const [place, perGood] of passDeltas)
      for (const [goodType, amount] of perGood) addAmount(scan, place, goodType, amount);
    return sameTally(scan, this.totals) ? [] : [`${name}: tally differs from a scan`];
  }

  private count(entity: Entity): void {
    const value = this.world.tryGet(entity, this.component);
    if (value === undefined) return;
    const errand = { place: this.placeOf(value), goodType: value.goodType, amount: value.amount };
    this.counted.set(entity, errand);
    addAmount(this.totals, errand.place, errand.goodType, errand.amount);
  }
}

/** The side a logged pass delta folded into. */
const INBOUND_SIDE = 0;
const SOURCE_SIDE = 1;
type Side = typeof INBOUND_SIDE | typeof SOURCE_SIDE;
/** Numbers per logged pass delta: side, place, good, amount. */
const PASS_DELTA_STRIDE = 4;

/**
 * Tallies of supply units committed by live errands. `inbound` is keyed by the destination of each
 * {@link SupplyRun}; the source side by the store or pile each {@link PickupClaim} walks to. Every stamp
 * and release folds in at once, so a mid-pass read matches a full scan.
 *
 * The source side steers fetchers apart when they choose where to take a good from: a unit one settler
 * is walking to is not offered to the next. The pickup itself stays first come, first served. A claim
 * ends with the pickup, with the settler's next re-plan, or with the order that diverts it, so nothing
 * stays promised to a settler that gave the walk up.
 *
 * One tally per world, kept across passes: {@link collectSupplyTally} undoes the last pass's stamps and
 * releases, then recounts only the errands whose component changed since, which leaves exactly what a
 * full scan would build.
 */
export class SupplyTally {
  private readonly inboundSide: TallySide<SupplyRunView>;
  private readonly sourceSide: TallySide<PickupClaimView>;
  /** Stamp and release deltas since the last collect, {@link PASS_DELTA_STRIDE} numbers each, cut by
   *  count so the backing store survives. */
  private readonly passDeltas: number[] = [];
  private passDeltaLength = 0;
  private readonly recountEntity = (entity: Entity): void => {
    this.inboundSide.recount(entity);
    this.sourceSide.recount(entity);
  };

  constructor(
    private readonly world: World,
    private readonly changes: ChangeFeed,
  ) {
    this.inboundSide = new TallySide(world, SupplyRun, (run) => run.site);
    this.sourceSide = new TallySide(world, PickupClaim, (claim) => claim.source);
    this.rebuild();
  }

  /** Units of each good committed to each destination by live supply runs. */
  get inbound(): ReadonlyMap<Entity, ReadonlyMap<number, number>> {
    return this.inboundSide.totals;
  }

  /** Units of `goodType` inbound to `site`. */
  inboundOf(site: Entity, goodType: number): number {
    return this.inboundSide.totals.get(site)?.get(goodType) ?? 0;
  }

  /** Whether any live errand is bringing material to `site`. */
  hasInbound(site: Entity): boolean {
    return this.inboundSide.totals.has(site);
  }

  /** Units of each good promised out of each source by live pickup claims. */
  get reservedAtSource(): ReadonlyMap<Entity, ReadonlyMap<number, number>> {
    return this.sourceSide.totals;
  }

  /** Whether any live pickup claim names `source`. */
  hasClaims(source: Entity): boolean {
    return this.sourceSide.totals.has(source);
  }

  /** Units of `goodType` already promised out of `source` to settlers walking to it. */
  reservedAt(source: Entity, goodType: number): number {
    return this.sourceSide.totals.get(source)?.get(goodType) ?? 0;
  }

  /** Stamp a settler's supply run, folded in so a settler planned later this pass counts it as inbound. */
  stampSupplyRun(entity: Entity, run: SupplyRunView): void {
    this.releaseSupplyRun(entity);
    this.world.add(entity, SupplyRun, run);
    this.foldPassDelta(INBOUND_SIDE, run.site, run.goodType, run.amount);
  }

  /** Release a replanning settler's stale supply run, the mirror of {@link stampSupplyRun}. */
  releaseSupplyRun(entity: Entity): void {
    const run = this.world.tryGet(entity, SupplyRun);
    if (run === undefined) return;
    this.foldPassDelta(INBOUND_SIDE, run.site, run.goodType, -run.amount);
    this.world.remove(entity, SupplyRun);
  }

  /** Stamp a settler's pickup claim, folded in so a settler planned later this pass sees the units as
   *  promised away from the source. */
  stampPickupClaim(entity: Entity, claim: PickupClaimView): void {
    this.releasePickupClaim(entity);
    this.world.add(entity, PickupClaim, claim);
    this.foldPassDelta(SOURCE_SIDE, claim.source, claim.goodType, claim.amount);
  }

  /** Release a replanning settler's stale pickup claim, the mirror of {@link stampPickupClaim}. */
  releasePickupClaim(entity: Entity): void {
    const claim = this.world.tryGet(entity, PickupClaim);
    if (claim === undefined) return;
    this.foldPassDelta(SOURCE_SIDE, claim.source, claim.goodType, -claim.amount);
    this.world.remove(entity, PickupClaim);
  }

  /** Release both of a settler's errands at a re-plan; a drive that still wants one re-stamps it. */
  releaseErrands(entity: Entity): void {
    this.releaseSupplyRun(entity);
    this.releasePickupClaim(entity);
  }

  /** Bring the tally to what a full scan of the live errands would build now. */
  refresh(): void {
    for (let at = this.passDeltaLength - PASS_DELTA_STRIDE; at >= 0; at -= PASS_DELTA_STRIDE) {
      addAmount(
        this.sideTotals(this.passDeltas[at] as Side),
        this.passDeltas[at + 1] as Entity,
        this.passDeltas[at + 2] ?? 0,
        -(this.passDeltas[at + 3] ?? 0),
      );
    }
    this.passDeltaLength = 0;
    if (this.changes.pending && this.changes.drain(this.recountEntity)) this.rebuild();
  }

  /** Mismatches between the tally, the counted errands and the world, for the cache verifier. */
  verify(): string[] {
    const pending = new Set<Entity>();
    if (this.changes.peek((entity) => pending.add(entity))) return [];
    const deltas: [PerGoodTally, PerGoodTally] = [new Map(), new Map()];
    for (let at = 0; at < this.passDeltaLength; at += PASS_DELTA_STRIDE) {
      addAmount(
        deltas[this.passDeltas[at] as Side],
        this.passDeltas[at + 1] as Entity,
        this.passDeltas[at + 2] ?? 0,
        this.passDeltas[at + 3] ?? 0,
      );
    }
    const inbound = this.inboundSide.verify('inbound supply', pending, deltas[INBOUND_SIDE]);
    return inbound.length > 0
      ? inbound
      : this.sourceSide.verify('pickup claims', pending, deltas[SOURCE_SIDE]);
  }

  private foldPassDelta(side: Side, place: Entity, goodType: number, delta: number): void {
    addAmount(this.sideTotals(side), place, goodType, delta);
    const at = this.passDeltaLength;
    this.passDeltas[at] = side;
    this.passDeltas[at + 1] = place;
    this.passDeltas[at + 2] = goodType;
    this.passDeltas[at + 3] = delta;
    this.passDeltaLength = at + PASS_DELTA_STRIDE;
  }

  private sideTotals(side: Side): PerGoodTally {
    return side === INBOUND_SIDE ? this.inboundSide.totals : this.sourceSide.totals;
  }

  private rebuild(): void {
    this.passDeltaLength = 0;
    this.inboundSide.rebuild();
    this.sourceSide.rebuild();
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

/** Fold `delta` into a place's per-good count, pruning a slot that returns to zero so the tally stays
 *  the minimal set a full scan would build. */
function addAmount(tally: PerGoodTally, place: Entity, goodType: number, delta: number): void {
  let perGood = tally.get(place);
  if (perGood === undefined) {
    perGood = new Map();
    tally.set(place, perGood);
  }
  const next = (perGood.get(goodType) ?? 0) + delta;
  if (next === 0) perGood.delete(goodType);
  else perGood.set(goodType, next);
  if (perGood.size === 0) tally.delete(place);
}

const talliesByWorld = new WeakMap<World, SupplyTally>();

/** The world's tally, brought up to every live errand, those still in flight from earlier ticks included.
 *  The same instance each call, so a tally from an earlier collect reads the current errands too. */
export function collectSupplyTally(world: World): SupplyTally {
  const held = talliesByWorld.get(world);
  if (held !== undefined) {
    held.refresh();
    return held;
  }
  const tally = new SupplyTally(
    world,
    world.watchChanges([SupplyRun, PickupClaim], [SupplyRun, PickupClaim]),
  );
  talliesByWorld.set(world, tally);
  world.registerCacheVerifier('supplyTally', () => tally.verify());
  return tally;
}
