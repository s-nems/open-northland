import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  GroundDrop,
  MineDeposit,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, cellAnchorNode, checkInvariants, fx, Simulation } from '../../src/index.js';
import { atomicSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { clearComponentStores } from '../fixtures/stores.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * MINERAL DEPOSITS — SHRINK BY LEVEL, DROP ORE TO GROUND (historical plan phase 3, gathering Step 4). A mined
 * good (stone/iron/gold/clay) is a {@link MineDeposit}: the collector chips it ONE unit at a time, each
 * completed harvest atomic dropping one unit at the deposit's cell as a bare {@link GroundDrop} ore pile
 * (the same on-the-ground shape a felled trunk takes) — NOT onto the back — while the deposit stays,
 * draining by one, until its last unit is chipped, when the node is REMOVED (and `resourceDepleted`
 * fires). A collector then carries the ore off via the unchanged pickup/porter/delivery machinery.
 * Goods are conserved: a deposit of N units yields exactly N ore, no dupes or losses.
 *
 * The trivial DIRECT pickup (a mushroom — a bare node with no `MineDeposit`) is the counter-case: one
 * harvest lands the unit straight on the back and the node is removed.
 *
 * The calibration (deposit size + levels) comes from CONTENT (the stone good's `gathering.depositSize`/
 * `depositLevels`, OBSERVED — source basis), read here so the tests carry no magic literals.
 */

const STONE = 4; // fixture good: a MINED deposit (gathering.depositSize > 0)
const MUSHROOM = 5; // fixture good: the trivial direct pickup (no depositSize)
const MINER = 5; // fixture job allowed the stone harvest atomic (25)
const VIKING = 1;
const HARVEST_STONE = 25;
const HARVEST_MUSHROOM = 32;

// The deposit spec the sim stamps onto a mined node — read from the fixture, not hardcoded.
const STONE_GATHERING = testContent().goods.find((g) => g.id === 'stone')?.gathering;
const DEPOSIT_SIZE = STONE_GATHERING?.depositSize ?? 0;
const DEPOSIT_LEVELS = STONE_GATHERING?.depositLevels ?? 0;

beforeEach(clearComponentStores);

/** A `width`×`height` CELL strip of grass, upsampled to the half-cell navigation lattice. */

/** A miner settler at integer tile (x,y): needs at 0, empty experience. */
function makeMiner(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: MINER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

/** A standing MINED stone deposit at (x,y): the deposit spec (size + levels) comes from content. */
function placeDeposit(sim: Simulation, x: number, y: number, units = DEPOSIT_SIZE): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: STONE, remaining: units, harvestAtomic: HARVEST_STONE });
  sim.world.add(e, MineDeposit, { initial: units, levels: DEPOSIT_LEVELS });
  return e;
}

/** Start (and immediately let complete, duration 1) a single harvest of `node` by `settler`. */
function harvestOnce(sim: Simulation, settler: Entity, node: Entity, good: number, atomic: number): void {
  sim.world.add(settler, CurrentAtomic, {
    atomicId: atomic,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: 1,
    effect: { kind: 'harvest', resource: node, goodType: good },
    targetEntity: node,
    targetTile: null,
  });
  atomicSystem(sim.world, ctxOf(sim));
}

/** Every loose ore pile (a {@link GroundDrop}) in the world. */
function oreDrops(sim: Simulation): Entity[] {
  return [...sim.world.query(GroundDrop)];
}

/** Total materialised stone in the world: every stockpile's stone + every carried stone load. The
 *  conservation yardstick — a deposit of N units yields exactly N stone, no more, no less. */
function totalStone(sim: Simulation): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) total += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
  for (const e of sim.world.query(Carrying)) {
    const c = sim.world.get(e, Carrying);
    if (c.goodType === STONE) total += c.amount;
  }
  return total;
}

describe('mining — chipping a deposit', () => {
  it('the fixture pins a real deposit spec (size + levels both positive)', () => {
    expect(DEPOSIT_SIZE).toBeGreaterThan(0);
    expect(DEPOSIT_LEVELS).toBeGreaterThan(0);
  });

  it('a chip drops ONE ore pile at the deposit, drains it by one, and carries NOTHING on the back', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const deposit = placeDeposit(sim, 4, 0);
    const miner = makeMiner(sim, 4, 0);

    harvestOnce(sim, miner, deposit, STONE, HARVEST_STONE);

    // The deposit stays, one unit lighter.
    expect(sim.world.has(deposit, Resource)).toBe(true);
    expect(sim.world.get(deposit, Resource).remaining).toBe(DEPOSIT_SIZE - 1);
    // A mined unit lands on the GROUND (not the back) as an ore pile at the deposit's cell.
    expect(sim.world.has(miner, Carrying)).toBe(false);
    const drops = oreDrops(sim);
    expect(drops).toHaveLength(1);
    const ore = drops[0] as Entity;
    expect(sim.world.get(ore, Stockpile).amounts.get(STONE)).toBe(1);
    expect(fx.toInt(sim.world.get(ore, Position).x)).toBe(4);
    // Conserved: one unit off the deposit is one unit on the ground.
    expect(totalStone(sim)).toBe(1);
  });

  it('each chip drops a fresh ore pile; the deposit survives every chip but its last', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const deposit = placeDeposit(sim, 3, 0);
    const miner = makeMiner(sim, 3, 0);

    for (let i = 0; i < DEPOSIT_SIZE - 1; i++) harvestOnce(sim, miner, deposit, STONE, HARVEST_STONE);

    // Chipped size-1 times: one unit still in the deposit, the rest lying as ore.
    expect(sim.world.has(deposit, Resource)).toBe(true);
    expect(sim.world.get(deposit, Resource).remaining).toBe(1);
    expect(oreDrops(sim)).toHaveLength(DEPOSIT_SIZE - 1);
    expect(totalStone(sim)).toBe(DEPOSIT_SIZE - 1); // conserved: nothing carried, all on the ground
  });

  it('the last chip removes the deposit and emits resourceDepleted; the whole size lies as ore', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const deposit = placeDeposit(sim, 2, 0);
    const miner = makeMiner(sim, 2, 0);

    for (let i = 0; i < DEPOSIT_SIZE - 1; i++) {
      sim.events.clear();
      harvestOnce(sim, miner, deposit, STONE, HARVEST_STONE);
      expect(sim.events.current().some((ev) => ev.kind === 'resourceDepleted')).toBe(false); // not yet
    }
    sim.events.clear();
    harvestOnce(sim, miner, deposit, STONE, HARVEST_STONE); // the exhausting chip

    // The deposit is GONE — the planner never re-scans a spent deposit (the removal path Step 5 hooks).
    expect(sim.world.has(deposit, Resource)).toBe(false);
    expect(sim.world.has(deposit, MineDeposit)).toBe(false);
    // Exactly the deposit's size lies as ore piles, conserved (no dupes/losses across the whole drain).
    expect(oreDrops(sim)).toHaveLength(DEPOSIT_SIZE);
    expect(totalStone(sim)).toBe(DEPOSIT_SIZE);
    // The exhausting chip announced the removal at the deposit's node (half-cell coords).
    const depositNode = cellAnchorNode(2, 0);
    const depleted = sim.events.current().filter((ev) => ev.kind === 'resourceDepleted');
    expect(depleted).toHaveLength(1);
    expect(depleted[0]).toMatchObject({
      kind: 'resourceDepleted',
      node: deposit,
      goodType: STONE,
      at: { x: depositNode.hx, y: depositNode.hy },
    });
  });

  it('a chip on an already-exhausted (gone) deposit yields nothing — the swing struck air (conserved)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const miner = makeMiner(sim, 0, 0);
    const gone = sim.world.create(); // never given a Resource — the deposit was removed already

    harvestOnce(sim, miner, gone, STONE, HARVEST_STONE);

    expect(sim.world.has(miner, Carrying)).toBe(false);
    expect(oreDrops(sim)).toHaveLength(0);
    expect(totalStone(sim)).toBe(0);
  });
});

describe('mining — the mushroom direct-pickup variant', () => {
  it('a bare node (no MineDeposit) yields one unit onto the back, is removed, and emits resourceDepleted', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A single mushroom: a bare Resource of one unit, no MineDeposit — the trivial direct pickup.
    const node = sim.world.create();
    sim.world.add(node, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(node, Resource, { goodType: MUSHROOM, remaining: 1, harvestAtomic: HARVEST_MUSHROOM });
    const picker = makeMiner(sim, 1, 0);
    sim.events.clear();

    harvestOnce(sim, picker, node, MUSHROOM, HARVEST_MUSHROOM);

    // The unit went straight onto the back (no ground stage), and the node vanished.
    expect(sim.world.get(picker, Carrying)).toEqual({ goodType: MUSHROOM, amount: 1 });
    expect(oreDrops(sim)).toHaveLength(0); // direct pickup drops nothing on the ground
    expect(sim.world.has(node, Resource)).toBe(false);
    const depleted = sim.events.current().filter((ev) => ev.kind === 'resourceDepleted');
    expect(depleted).toHaveLength(1);
    expect(depleted[0]).toMatchObject({ kind: 'resourceDepleted', node, goodType: MUSHROOM });
  });
});

describe('mining — end-to-end through the real schedule', () => {
  it('a miner chips a deposit dry, delivers every unit to the store, and the node is gone; goods conserved', () => {
    // Strip: miner@0, a stone deposit@3, a warehouse store@4 (a real typed store — a delivery sink must
    // be a Building/Vehicle, never a bare loose pile).
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(6, 1) });
    makeMiner(sim, 0, 0);
    placeDeposit(sim, 3, 0);
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(4), y: fx.fromInt(0) });
    sim.world.add(store, Building, { buildingType: 7, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map<number, number>() });

    let maxStone = 0;
    const violations: string[] = [];
    for (let i = 0; i < 900; i++) {
      sim.step();
      maxStone = Math.max(maxStone, totalStone(sim));
      if (violations.length === 0) {
        const v = checkInvariants(sim.world, CORE_INVARIANTS);
        if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
      }
    }

    // The store holds exactly the deposit's whole size…
    expect(sim.world.get(store, Stockpile).amounts.get(STONE)).toBe(DEPOSIT_SIZE);
    // …the deposit is gone, and every ore pile was collected + reaped…
    expect([...sim.world.query(Resource)]).toHaveLength(0);
    expect(oreDrops(sim)).toHaveLength(0);
    // …goods were conserved throughout: total stone never exceeded the deposit's size (no dupes), and all
    // of it ended in the store.
    expect(maxStone).toBe(DEPOSIT_SIZE);
    expect(totalStone(sim)).toBe(DEPOSIT_SIZE);
    expect(violations).toEqual([]);
  });
});
