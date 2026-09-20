import { Carrying, SupplyRun } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Tick-local tallies of construction material committed by live {@link SupplyRun} errands. `inbound` is
 * keyed by destination site and `reservedAtSource` by the store the pickup leg is walking to. Every stamp
 * and release folds into both in lockstep, so a mid-pass read matches a full store scan.
 */
export interface InboundSupplyTally {
  readonly inbound: Map<Entity, Map<number, number>>;
  readonly reservedAtSource: SourceSupplyReservations;
}

/** Source-side subset used by the atomic pass. It is mutable so completed pickups update later pickups
 * in the same pass without rescanning every live construction run. */
export type SourceSupplyReservations = Map<Entity, Map<number, number>>;

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

/** Seed only the source-side reservation index for one atomic pass. */
export function collectSourceSupplyReservations(world: World): SourceSupplyReservations {
  const reservations: SourceSupplyReservations = new Map();
  for (const entity of world.query(SupplyRun)) {
    const run = world.get(entity, SupplyRun);
    if (sourceReservationIsLive(world, entity, run)) {
      addAmount(reservations, run.source, run.goodType, run.amount);
    }
  }
  return reservations;
}

/** Units of `goodType` inbound to `site`. */
export function inboundSupplyOf(tally: InboundSupplyTally, site: Entity, goodType: number): number {
  return tally.inbound.get(site)?.get(goodType) ?? 0;
}

/** Units of `goodType` already promised from `source` to construction pickups. */
export function reservedSourceSupplyOf(tally: InboundSupplyTally, source: Entity, goodType: number): number {
  return tally.reservedAtSource.get(source)?.get(goodType) ?? 0;
}

/** Units promised from a source in the atomic pass's shared reservation index. */
export function sourceSupplyReservationOf(
  reservations: SourceSupplyReservations,
  source: Entity,
  goodType: number,
): number {
  return reservations.get(source)?.get(goodType) ?? 0;
}

/** End one construction runner's source promise at its pickup attempt and return the released amount.
 * The destination promise stays live for a successful carrying leg and is reconciled on the next plan
 * after a failed pickup. */
export function releaseSourceSupplyReservation(
  world: World,
  entity: Entity,
  reservations: SourceSupplyReservations,
  source: Entity,
  goodType: number,
): number {
  const run = world.tryGet(entity, SupplyRun);
  if (
    run === undefined ||
    !sourceReservationIsLive(world, entity, run) ||
    run.source !== source ||
    run.goodType !== goodType
  ) {
    return 0;
  }
  addAmount(reservations, run.source, run.goodType, -run.amount);
  world.add(entity, SupplyRun, { ...run, source: null });
  return run.amount;
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
