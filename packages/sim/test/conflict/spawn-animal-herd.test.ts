import { beforeEach, describe, expect, it } from 'vitest';
import { Age, Health, HerdMember, MoveSpeed, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, cellAnchorNode, fx, nodeOfPosition } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for the `spawnAnimalHerd` command — the animal-PLACEMENT mechanic (plan Phase 4 "animals as
 * non-controllable tribes"): it puts a herd of creatures on the map, consuming the `herdParams` /
 * `animalHitpoints` read views. The fixture's BEAR (tribe 10) is a herd of `maximumGroupSize` 3 that
 * `searchForLeader`s, ranging `maximumDistanceToBirthPoint` 2, with `hitpoints_adult` 15000; the BEE
 * (tribe 11) is solitary (no group size, searchForLeader false). The VIKING (tribe 1) is a civilization
 * (no animaltypes record) — bad input for this command.
 *
 * Stores are module-level singletons shared across sims, so each test clears them first. The sim has no
 * terrain map, so the full `step()` schedule runs but the CombatSystem (which needs cells to measure
 * range) is inert — a spawned herd is placed, not immediately fighting.
 */

const BEAR = 10; // aggressive herd animal: group 3, searchForLeader, range 2, hitpointsAdult 15000; moveSpeed 8 + runSpeed 4
const BEE = 11; // solitary decorative animal: no group size, searchForLeader false, hitpointsAdult 200
const BOAR = 12; // passive-provokable: moveSpeed 8 but NO runSpeed (the walk-known/run-omitted case)
const VIKING = 1; // a civilization — no animaltypes record (bad input for spawnAnimalHerd)

function clearStores(): void {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  HerdMember.store.clear();
  Age.store.clear();
  MoveSpeed.store.clear();
}

beforeEach(clearStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** Enqueue a herd spawn at visual tile (x, y) — command coords are half-cell nodes, so anchor-convert. */
function spawnHerdAt(sim: Simulation, tribe: number, x: number, y: number): void {
  const n = cellAnchorNode(x, y);
  sim.enqueue({ kind: 'spawnAnimalHerd', tribe, x: n.hx, y: n.hy });
}

/** Every spawned creature, in canonical (ascending-id) order. */
function creatures(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Health, Position)].sort((a, b) => a - b);
}

describe('spawnAnimalHerd command', () => {
  it('places a herd of maximumGroupSize creatures of the animal tribe, each with a Health pool', () => {
    const sim = fresh();
    spawnHerdAt(sim, BEAR, 5, 5);
    sim.step();

    const herd = creatures(sim);
    expect(herd).toHaveLength(3); // maximumGroupSize 3
    for (const e of herd) {
      const s = sim.world.get(e, Settler);
      expect(s.tribe).toBe(BEAR);
      expect(s.jobType).toBeNull(); // an animal isn't born into a trade
      // HP is stamped from animaltypes hitpoints_adult (15000), full pool.
      expect(sim.world.get(e, Health)).toEqual({ hitpoints: 15000, max: 15000 });
      expect(sim.world.has(e, Age)).toBe(false); // spawned adult — no growth bookkeeping
    }
    // One settlerBorn announced per creature for render/audio.
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerBorn')).toHaveLength(3);
  });

  it('scatters the herd within maximumDistanceToBirthPoint (no two stacked, all in range)', () => {
    const sim = fresh();
    spawnHerdAt(sim, BEAR, 5, 5); // birth node (11,10) — cell (5,5)'s anchor
    sim.step();

    const herd = creatures(sim);
    const nodes = herd.map((e) => {
      const p = sim.world.get(e, Position);
      return nodeOfPosition(p.x, p.y);
    });
    const keys = nodes.map((n) => `${n.hx},${n.hy}`);
    expect(new Set(keys).size).toBe(herd.length); // no two creatures share a node
    // The leader sits ON the birth node; every member is within the range-2 birth-point radius —
    // herd ranges are consumed as half-cell NODE distances (the scatter offsets apply in node space).
    expect(keys).toContain('11,10');
    for (const n of nodes) {
      expect(Math.abs(n.hx - 11)).toBeLessThanOrEqual(2);
      expect(Math.abs(n.hy - 10)).toBeLessThanOrEqual(2);
    }
  });

  it('designates a leader for a searchForLeader animal: the lowest-id member, recorded on every member', () => {
    const sim = fresh();
    spawnHerdAt(sim, BEAR, 5, 5);
    sim.step();

    const herd = creatures(sim);
    const leader = herd[0]; // lowest id — the first created
    expect(leader).toBeDefined();
    for (const e of herd) {
      expect(sim.world.has(e, HerdMember)).toBe(true);
      expect(sim.world.get(e, HerdMember).leader).toBe(leader); // all point at the one leader
    }
    // The leader's HerdMember is self-referential (marks "I am the leader" without a second flag).
    expect(sim.world.get(leader as Entity, HerdMember).leader).toBe(leader);
  });

  it('stamps each creature a MoveSpeed from movespeed/runspeed (the bear walks ONE/8, runs ONE/4)', () => {
    const sim = fresh();
    spawnHerdAt(sim, BEAR, 5, 5);
    sim.step();

    const herd = creatures(sim);
    expect(herd).toHaveLength(3);
    for (const e of herd) {
      const speed = sim.world.get(e, MoveSpeed);
      // movespeed 8 -> walks ONE/8 tile/tick (a larger movespeed is a slower step).
      expect(speed.perTick).toBe(fx.div(ONE, fx.fromInt(8)));
      // runspeed 4 -> the (faster) run gait ONE/4, recorded for the deferred flee/charge drive.
      expect(speed.runPerTick).toBe(fx.div(ONE, fx.fromInt(4)));
    }
  });

  it('stamps runPerTick null for an animal with a movespeed but no runspeed (the boar)', () => {
    const sim = fresh();
    spawnHerdAt(sim, BOAR, 4, 4);
    sim.step();

    const herd = creatures(sim);
    expect(herd.length).toBeGreaterThan(0);
    for (const e of herd) {
      const speed = sim.world.get(e, MoveSpeed);
      expect(speed.perTick).toBe(fx.div(ONE, fx.fromInt(8))); // walk pace known
      expect(speed.runPerTick).toBeNull(); // no runspeed -> run gait omitted
    }
  });

  it('a solitary animal (searchForLeader false) spawns one creature with NO HerdMember', () => {
    const sim = fresh();
    spawnHerdAt(sim, BEE, 2, 3);
    sim.step();

    const herd = creatures(sim);
    expect(herd).toHaveLength(1); // no group size -> one creature
    const bee = herd[0] as Entity;
    expect(sim.world.get(bee, Settler).tribe).toBe(BEE);
    expect(sim.world.get(bee, Health)).toEqual({ hitpoints: 200, max: 200 });
    expect(sim.world.has(bee, HerdMember)).toBe(false); // solitary — no leader to follow
    expect(sim.world.has(bee, MoveSpeed)).toBe(false); // no movespeed in its record -> walks the default
    const p = sim.world.get(bee, Position);
    expect([fx.toInt(p.x), fx.toInt(p.y)]).toEqual([2, 3]); // sits on the birth node (tile (2,3)'s anchor)
  });

  it('skips a non-animal tribe (a civilization — no animaltypes record), still logging the command', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnAnimalHerd', tribe: VIKING, x: 0, y: 0 });
    expect(() => sim.step()).not.toThrow();

    expect(creatures(sim)).toHaveLength(0); // nothing spawned — the viking has no herd params
    expect(sim.commands.log).toHaveLength(1); // but recorded for faithful replay
  });

  it('two same-seed runs spawn the same herd (deterministic — no RNG)', () => {
    const run = (): string => {
      clearStores();
      const sim = fresh(7);
      spawnHerdAt(sim, BEAR, 4, 6);
      sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
