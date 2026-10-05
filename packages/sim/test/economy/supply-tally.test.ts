import { describe, expect, it } from 'vitest';
import { PickupClaim, SupplyRun } from '../../src/components/index.js';
import type { Entity, World } from '../../src/ecs/world.js';
import { collectSupplyTally, type SupplyTally } from '../../src/systems/stores/supply-tally.js';
import { mappedSim } from '../footprint/resource-footprint/support.js';

const ROUNDS = 60;
const OPERATIONS_PER_ROUND = 12;
const SETTLERS = 16;
const PLACES = 5;
const GOODS = 3;
const MAX_AMOUNT = 3;

/** A deterministic integer stream for the fixtures (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

type Rows = Array<[Entity, number, number]>;

function rowsOf(tally: ReadonlyMap<Entity, ReadonlyMap<number, number>>): Rows {
  const rows: Rows = [];
  for (const [entity, perGood] of tally)
    for (const [good, amount] of perGood) rows.push([entity, good, amount]);
  return rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The tallies a full scan of the live errands builds. */
function scanned(world: World): { inbound: Rows; atSource: Rows } {
  const inbound = new Map<Entity, Map<number, number>>();
  const atSource = new Map<Entity, Map<number, number>>();
  const add = (tally: Map<Entity, Map<number, number>>, entity: Entity, good: number, amount: number) => {
    const perGood = tally.get(entity) ?? new Map<number, number>();
    perGood.set(good, (perGood.get(good) ?? 0) + amount);
    tally.set(entity, perGood);
  };
  for (const e of world.query(SupplyRun)) {
    const run = world.get(e, SupplyRun);
    add(inbound, run.site, run.goodType, run.amount);
  }
  for (const e of world.query(PickupClaim)) {
    const claim = world.get(e, PickupClaim);
    add(atSource, claim.source, claim.goodType, claim.amount);
  }
  return { inbound: rowsOf(inbound), atSource: rowsOf(atSource) };
}

function expectScanned(world: World, tally: SupplyTally): void {
  expect({ inbound: rowsOf(tally.inbound), atSource: rowsOf(tally.reservedAtSource) }).toEqual(
    scanned(world),
  );
}

describe('supply tally', () => {
  it('matches a full scan at every collect across stamps, releases and outside changes', () => {
    const sim = mappedSim();
    const world = sim.world;
    const next = lcg(5);
    const places = Array.from({ length: PLACES }, () => world.create());
    let settlers = Array.from({ length: SETTLERS }, () => world.create());
    const pick = <T>(list: readonly T[]): T => list[next() % list.length] as T;
    const runOf = () => ({ site: pick(places), goodType: next() % GOODS, amount: 1 + (next() % MAX_AMOUNT) });
    const claimOf = () => ({
      source: pick(places),
      goodType: next() % GOODS,
      amount: 1 + (next() % MAX_AMOUNT),
    });
    let tally = collectSupplyTally(world);
    for (let round = 0; round < ROUNDS; round++) {
      // The planner's own folds, which the tally sees as they happen.
      for (let i = 0; i < OPERATIONS_PER_ROUND; i++) {
        const settler = pick(settlers);
        switch (next() % 5) {
          case 0:
            tally.releaseSupplyRun(settler);
            break;
          case 1:
            tally.releasePickupClaim(settler);
            break;
          case 2:
            tally.releaseErrands(settler);
            break;
          case 3:
            tally.stampSupplyRun(settler, runOf());
            break;
          default:
            tally.stampPickupClaim(settler, claimOf());
        }
      }
      expect(world.verifyCaches()).toEqual([]);
      // Changes outside the pass, which only the next collect counts.
      for (let i = 0; i < OPERATIONS_PER_ROUND; i++) {
        const settler = pick(settlers);
        switch (next() % 5) {
          case 0:
            world.remove(settler, SupplyRun);
            break;
          case 1:
            world.add(settler, SupplyRun, runOf());
            break;
          case 2:
            world.remove(settler, PickupClaim);
            break;
          case 3:
            world.add(settler, PickupClaim, claimOf());
            break;
          default:
            world.destroy(settler);
            settlers = settlers.map((e) => (e === settler ? world.create() : e));
        }
      }
      expect(world.verifyCaches()).toEqual([]);
      const collected = collectSupplyTally(world);
      expect(collected).toBe(tally);
      tally = collected;
      expectScanned(world, tally);
      expect(world.verifyCaches()).toEqual([]);
    }
  });

  it('folds a stamp so a later read in the same pass counts it', () => {
    const sim = mappedSim();
    const world = sim.world;
    const [site, source, settler] = [world.create(), world.create(), world.create()];
    const tally = collectSupplyTally(world);
    tally.stampSupplyRun(settler, { site, goodType: 1, amount: 2 });
    tally.stampPickupClaim(settler, { source, goodType: 1, amount: 2 });
    expect(tally.inboundOf(site, 1)).toBe(2);
    expect(tally.reservedAt(source, 1)).toBe(2);
    expectScanned(world, tally);
    // The pickup effect ends the claim outside the pass; the run stays until the next re-plan.
    world.remove(settler, PickupClaim);
    expect(tally.reservedAt(source, 1)).toBe(2);
    expect(collectSupplyTally(world).reservedAt(source, 1)).toBe(0);
    expect(tally.inboundOf(site, 1)).toBe(2);
    tally.releaseErrands(settler);
    expect(tally.inbound.size).toBe(0);
    expect(tally.reservedAt(source, 1)).toBe(0);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('undoes an errand rewritten in place by the values it was counted with', () => {
    const sim = mappedSim();
    const world = sim.world;
    const [site, otherSite, source, otherSource, settler] = [
      world.create(),
      world.create(),
      world.create(),
      world.create(),
      world.create(),
    ];
    const tally = collectSupplyTally(world);
    tally.stampSupplyRun(settler, { site, goodType: 1, amount: 2 });
    tally.stampPickupClaim(settler, { source, goodType: 1, amount: 2 });
    expectScanned(world, collectSupplyTally(world));

    const run = world.mut(settler, SupplyRun);
    run.site = otherSite;
    run.goodType = 2;
    run.amount = 3;
    const claim = world.mut(settler, PickupClaim);
    claim.source = otherSource;
    claim.goodType = 2;
    claim.amount = 3;

    expect(world.verifyCaches()).toEqual([]);
    expectScanned(world, collectSupplyTally(world));
    expect(rowsOf(tally.inbound)).toEqual([[otherSite, 2, 3]]);
    expect(tally.reservedAt(source, 1)).toBe(0);
    expect(tally.reservedAt(otherSource, 2)).toBe(3);
    expect(world.verifyCaches()).toEqual([]);
  });
});
