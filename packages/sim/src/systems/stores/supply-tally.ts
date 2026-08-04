import { SupplyRun } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Tick-local tally of construction material already committed by live {@link SupplyRun} errands, keyed
 * `site -> goodType -> sum`. Every stamp and release folds into it in lockstep, so a mid-pass read matches
 * what a full store scan would return; the sum is commutative, so store order never leaks into the result.
 */
export type InboundSupplyTally = Map<Entity, Map<number, number>>;

/** Seed the tally from every live SupplyRun - errands still in flight from earlier ticks. */
export function collectInboundSupply(world: World): InboundSupplyTally {
  const tally: InboundSupplyTally = new Map();
  for (const e of world.query(SupplyRun)) {
    const run = world.get(e, SupplyRun);
    addInbound(tally, run.site, run.goodType, run.amount);
  }
  return tally;
}

/** Units of `goodType` inbound to `site`. */
export function inboundSupplyOf(tally: InboundSupplyTally, site: Entity, goodType: number): number {
  return tally.get(site)?.get(goodType) ?? 0;
}

/** Stamp a settler's supply errand and fold its amount into the tally, so a settler planned later this
 *  tick already counts the unit as inbound. */
export function stampSupplyRun(
  world: World,
  entity: Entity,
  tally: InboundSupplyTally,
  run: { site: Entity; goodType: number; amount: number },
): void {
  world.add(entity, SupplyRun, run);
  addInbound(tally, run.site, run.goodType, run.amount);
}

/** Release a replanning settler's stale supply errand, the mirror of {@link stampSupplyRun}. */
export function releaseSupplyRun(world: World, entity: Entity, tally: InboundSupplyTally): void {
  const run = world.tryGet(entity, SupplyRun);
  if (run === undefined) return;
  addInbound(tally, run.site, run.goodType, -run.amount);
  world.remove(entity, SupplyRun);
}

/** Fold `delta` into the per-site, per-good count, pruning a slot that returns to zero so the tally stays
 *  the minimal set a fresh {@link collectInboundSupply} would build. */
function addInbound(tally: InboundSupplyTally, site: Entity, goodType: number, delta: number): void {
  let perGood = tally.get(site);
  if (perGood === undefined) {
    perGood = new Map();
    tally.set(site, perGood);
  }
  const next = (perGood.get(goodType) ?? 0) + delta;
  if (next === 0) perGood.delete(goodType);
  else perGood.set(goodType, next);
}
