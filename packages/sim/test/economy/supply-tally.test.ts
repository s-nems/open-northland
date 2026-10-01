import { describe, expect, it } from 'vitest';
import { Carrying, SupplyRun } from '../../src/components/index.js';
import type { Entity, World } from '../../src/ecs/world.js';
import {
  collectInboundSupply,
  type InboundSupplyTally,
  releaseSupplyRun,
  stampSupplyRun,
} from '../../src/systems/stores/supply-tally.js';
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
    if (run.source !== null && !world.has(e, Carrying)) add(atSource, run.source, run.goodType, run.amount);
  }
  return { inbound: rowsOf(inbound), atSource: rowsOf(atSource) };
}

function expectScanned(world: World, tally: InboundSupplyTally): void {
  expect({ inbound: rowsOf(tally.inbound), atSource: rowsOf(tally.reservedAtSource) }).toEqual(
    scanned(world),
  );
}

describe('inbound supply tally', () => {
  it('matches a full scan at every collect across stamps, releases and outside changes', () => {
    const sim = mappedSim();
    const world = sim.world;
    const next = lcg(5);
    const places = Array.from({ length: PLACES }, () => world.create());
    let settlers = Array.from({ length: SETTLERS }, () => world.create());
    const pick = <T>(list: readonly T[]): T => list[next() % list.length] as T;
    const runOf = () => ({
      site: pick(places),
      goodType: next() % GOODS,
      amount: 1 + (next() % MAX_AMOUNT),
      source: next() % 3 === 0 ? null : pick(places),
    });
    let tally = collectInboundSupply(world);
    for (let round = 0; round < ROUNDS; round++) {
      // The planner's own folds, which the tally sees as they happen.
      for (let i = 0; i < OPERATIONS_PER_ROUND; i++) {
        const settler = pick(settlers);
        if (next() % 3 === 0) releaseSupplyRun(world, settler, tally);
        else stampSupplyRun(world, settler, tally, runOf());
      }
      expect(world.verifyCaches()).toEqual([]);
      // Changes outside the pass, which only the next collect counts.
      for (let i = 0; i < OPERATIONS_PER_ROUND; i++) {
        const settler = pick(settlers);
        switch (next() % 5) {
          case 0:
            world.add(settler, Carrying, { goodType: 0, amount: 1 });
            break;
          case 1:
            world.remove(settler, Carrying);
            break;
          case 2:
            world.remove(settler, SupplyRun);
            break;
          case 3:
            world.add(settler, SupplyRun, runOf());
            break;
          default:
            world.destroy(settler);
            settlers = settlers.map((e) => (e === settler ? world.create() : e));
        }
      }
      expect(world.verifyCaches()).toEqual([]);
      const collected = collectInboundSupply(world);
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
    const tally = collectInboundSupply(world);
    stampSupplyRun(world, settler, tally, { site, goodType: 1, amount: 2, source });
    expectScanned(world, tally);
    world.add(settler, Carrying, { goodType: 1, amount: 1 });
    expect(rowsOf(tally.reservedAtSource)).toEqual([[source, 1, 2]]);
    expectScanned(world, collectInboundSupply(world));
    releaseSupplyRun(world, settler, tally);
    expect(tally.inbound.size).toBe(0);
    expect(tally.reservedAtSource.size).toBe(0);
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
    const tally = collectInboundSupply(world);
    stampSupplyRun(world, settler, tally, { site, goodType: 1, amount: 2, source });
    expectScanned(world, collectInboundSupply(world));

    const run = world.mut(settler, SupplyRun);
    run.site = otherSite;
    run.source = otherSource;
    run.goodType = 2;
    run.amount = 3;

    expect(world.verifyCaches()).toEqual([]);
    expectScanned(world, collectInboundSupply(world));
    expect(rowsOf(tally.inbound)).toEqual([[otherSite, 2, 3]]);
    expect(world.verifyCaches()).toEqual([]);
  });
});
