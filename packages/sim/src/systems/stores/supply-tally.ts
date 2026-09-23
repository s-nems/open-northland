import { Carrying, SupplyRun } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Tick-local tallies of supply units committed by live {@link SupplyRun} errands. `inbound` is
 * keyed by destination site and `reservedAtSource` by the store the pickup leg is walking to. Every stamp
 * and release folds into both in lockstep, so a mid-pass read matches a full store scan.
 *
 * The source side only steers construction fetchers apart when they choose a store. The pickup itself
 * stays first come, first served: no other trade reads the reservation, so refusing a unit at the counter
 * would leave that settler retrying the same store until the promised builder arrived.
 */
export interface InboundSupplyTally {
  readonly inbound: Map<Entity, Map<number, number>>;
  readonly reservedAtSource: Map<Entity, Map<number, number>>;
}

/** Seed the tally from every live SupplyRun - errands still in flight from earlier ticks. */
export function collectInboundSupply(world: World): InboundSupplyTally {
  const tally: InboundSupplyTally = { inbound: new Map(), reservedAtSource: new Map() };
  for (const e of world.query(SupplyRun)) {
    const run = world.get(e, SupplyRun);
    addAmount(tally.inbound, run.site, run.goodType, run.amount);
    if (sourceReservationIsLive(world, e, run)) {
      addAmount(tally.reservedAtSource, run.source, run.goodType, run.amount);
    }
  }
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
    addAmount(tally.inbound, prior.site, prior.goodType, -prior.amount);
    if (sourceReservationIsLive(world, entity, prior)) {
      addAmount(tally.reservedAtSource, prior.source, prior.goodType, -prior.amount);
    }
  }
  world.add(entity, SupplyRun, run);
  addAmount(tally.inbound, run.site, run.goodType, run.amount);
  if (run.source !== null) addAmount(tally.reservedAtSource, run.source, run.goodType, run.amount);
}

/** Release a replanning settler's stale supply errand, the mirror of {@link stampSupplyRun}. */
export function releaseSupplyRun(world: World, entity: Entity, tally: InboundSupplyTally): void {
  const run = world.tryGet(entity, SupplyRun);
  if (run === undefined) return;
  addAmount(tally.inbound, run.site, run.goodType, -run.amount);
  if (sourceReservationIsLive(world, entity, run)) {
    addAmount(tally.reservedAtSource, run.source, run.goodType, -run.amount);
  }
  world.remove(entity, SupplyRun);
}

/** Fold `delta` into an entity's per-good count, pruning a slot that returns to zero so the tally stays
 *  the minimal set a fresh {@link collectInboundSupply} would build. */
function addAmount(
  tally: Map<Entity, Map<number, number>>,
  entity: Entity,
  goodType: number,
  delta: number,
): void {
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

type SupplyRunView = NonNullable<(typeof SupplyRun)['__value']>;

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
