import { DEFAULT_BASE_REPEAT_COUNTER } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  GroundDrop,
  HarvestFocus,
  MineDeposit,
  Position,
  Resource,
  SettlerProgress,
  Stockpile,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, cellAnchorNode, checkInvariants, fx, Simulation } from '../../src/index.js';
import { BARE_HANDS_WORK_FACTOR_PCT } from '../../src/systems/equipment/index.js';
import { anchorOnlyFootprint, atomicSystem, stampResourceFootprintData } from '../../src/systems/index.js';
import {
  EXPERIENCE_MASTERY_POINTS,
  EXPERIENCE_XP_PER_POINT,
  strokesPerUnit,
} from '../../src/systems/progression/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settleStrokeCadence } from '../fixtures/strokes.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * MINERAL DEPOSITS - SHRINK BY LEVEL, DROP ORE TO GROUND (historical plan phase 3, gathering Step 4). A mined
 * good (stone/iron/gold/clay) is a {@link MineDeposit}: the collector chips it ONE unit at a time, each
 * completed harvest atomic dropping one unit at the deposit's cell as a bare {@link GroundDrop} ore pile
 * (the same on-the-ground shape a felled trunk takes) - NOT onto the back - while the deposit stays,
 * draining by one, until its last unit is chipped, when the node is REMOVED (and `resourceDepleted`
 * fires). A collector then carries the ore off via the unchanged pickup/porter/delivery machinery.
 * Goods are conserved: a deposit of N units yields exactly N ore, no dupes or losses.
 *
 * The trivial DIRECT pickup (a mushroom - a bare node with no `MineDeposit`) is the counter-case: one
 * harvest lands the unit straight on the back and the node is removed.
 *
 * The calibration (deposit size + levels) comes from CONTENT (the stone good's `gathering.depositSize`/
 * `depositLevels`, OBSERVED - source basis), read here so the tests carry no magic literals.
 */

const STONE = 4; // fixture good: a MINED deposit (gathering.depositSize > 0)
const MUSHROOM = 5; // fixture good: the trivial direct pickup (no depositSize)
const MINER = 5; // fixture job allowed the stone harvest atomic (25)
const VIKING = 1;
const HARVEST_STONE = 25;
const HARVEST_MUSHROOM = 32;

// The deposit spec the sim stamps onto a mined node - read from the fixture, not hardcoded.
const STONE_GATHERING = testContent().goods.find((g) => g.id === 'stone')?.gathering;
const DEPOSIT_SIZE = STONE_GATHERING?.depositSize ?? 0;
const DEPOSIT_LEVELS = STONE_GATHERING?.depositLevels ?? 0;

/** A `width`×`height` CELL strip of grass, upsampled to the half-cell navigation lattice. */

/** A miner settler at integer tile (x,y): needs at 0, empty experience. */
function makeMiner(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: MINER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  return e;
}

/** A standing MINED stone deposit at (x,y): the deposit spec (size + levels) comes from content. */
function placeDeposit(sim: Simulation, x: number, y: number, units = DEPOSIT_SIZE): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: STONE, remaining: units, harvestAtomic: HARVEST_STONE });
  stampResourceFootprintData(sim.world, e, anchorOnlyFootprint());
  sim.world.add(e, MineDeposit, { initial: units, levels: DEPOSIT_LEVELS, strikes: 0 });
  return e;
}

/** Start (and immediately let complete, duration 1) a single harvest of `node` by `settler`. */
function harvestOnce(sim: Simulation, settler: Entity, node: Entity, good: number, atomic: number): void {
  addCurrentAtomic(sim.world, settler, {
    atomicId: atomic,
    duration: 1,
    effect: { kind: 'harvest', resource: node, goodType: good },
    targetEntity: node,
    targetTile: null,
  });
  atomicSystem(sim.world, ctxOf(sim));
}

/** Chip one unit off `deposit`: the fixture MINER's pairing has no track, so a unit costs the record's
 *  default strokes. A chip releases the miner at once, so every counted stroke starts its own atomic. */
function chipUnit(sim: Simulation, settler: Entity, deposit: Entity): void {
  for (let stroke = 0; stroke < DEFAULT_BASE_REPEAT_COUNTER; stroke++) {
    harvestOnce(sim, settler, deposit, STONE, HARVEST_STONE);
    settleStrokeCadence(sim, settler);
  }
}

/** Every loose ore pile (a {@link GroundDrop}) in the world. */
function oreDrops(sim: Simulation): Entity[] {
  return [...sim.world.query(GroundDrop)];
}

/** Total materialised stone in the world: every stockpile's stone + every carried stone load. The
 *  conservation yardstick - a deposit of N units yields exactly N stone, no more, no less. */
function totalStone(sim: Simulation): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) total += sim.world.get(e, Stockpile).amounts.get(STONE) ?? 0;
  for (const e of sim.world.query(Carrying)) {
    const c = sim.world.get(e, Carrying);
    if (c.goodType === STONE) total += c.amount;
  }
  return total;
}

describe('mining - chipping a deposit', () => {
  it('a chip drops ONE ore pile at the deposit, drains it by one, and carries NOTHING on the back', () => {
    // A zeroed deposit spec would empty the node on the first chip and make the counts below vacuous.
    expect(DEPOSIT_SIZE).toBeGreaterThan(0);
    expect(DEPOSIT_LEVELS).toBeGreaterThan(0);
    const sim = new Simulation({ seed: 1, content: testContent() });
    const deposit = placeDeposit(sim, 4, 0);
    const miner = makeMiner(sim, 4, 0);

    chipUnit(sim, miner, deposit);

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

    for (let i = 0; i < DEPOSIT_SIZE - 1; i++) chipUnit(sim, miner, deposit);

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
      chipUnit(sim, miner, deposit);
      expect(sim.events.current().some((ev) => ev.kind === 'resourceDepleted')).toBe(false); // not yet
    }
    sim.events.clear();
    chipUnit(sim, miner, deposit); // the exhausting chip

    // The deposit is GONE - the planner never re-scans a spent deposit (the removal path Step 5 hooks).
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
      at: { hx: depositNode.hx, hy: depositNode.hy },
    });
  });

  it('a chip on an already-exhausted (gone) deposit yields nothing - the swing struck air (conserved)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const miner = makeMiner(sim, 0, 0);
    const gone = sim.world.create(); // never given a Resource - the deposit was removed already

    harvestOnce(sim, miner, gone, STONE, HARVEST_STONE);

    expect(sim.world.has(miner, Carrying)).toBe(false);
    expect(oreDrops(sim)).toHaveLength(0);
    expect(totalStone(sim)).toBe(0);
  });
});

describe("mining - strokes per unit come from the miner's track", () => {
  const WOOD = 1;
  const WOODCUTTER = 1; // fixture job with a wood track (typeId 1) that omits `baserepeatcounter`
  const WOOD_TRACK = 1;
  const HARVEST_WOOD = 24; // the woodcutter's stroke-counted chop clip
  const WOOD_TRACK_STROKES =
    testContent().jobExperience.find((t) => t.typeId === WOOD_TRACK)?.baseRepeatCounter ?? 0;
  const MASTERY_XP = EXPERIENCE_MASTERY_POINTS * EXPERIENCE_XP_PER_POINT;
  const MASTERY_PCT = 100;

  /** A woodcutter with `xp` on its wood track and a WOOD-typed deposit (the markers, not the good, decide
   *  the harvest shape, so a wood deposit is legal and reads the wood track). */
  const trainedMinerScene = (units: number, xp: number) => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const miner = makeMiner(sim, 0, 0);
    setSettlerJob(sim.world, miner, WOODCUTTER);
    sim.world.mut(miner, SettlerProgress).experience.set(WOOD_TRACK, xp);
    const node = sim.world.create();
    sim.world.add(node, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(node, Resource, { goodType: WOOD, remaining: units, harvestAtomic: HARVEST_WOOD });
    stampResourceFootprintData(sim.world, node, anchorOnlyFootprint());
    sim.world.add(node, MineDeposit, { initial: units, levels: DEPOSIT_LEVELS, strikes: 0 });
    return { sim, miner, node };
  };

  it('banks strokes on the node counter across the cadence and frees one unit on the last', () => {
    const needed = strokesPerUnit(WOOD_TRACK_STROKES, MASTERY_PCT, BARE_HANDS_WORK_FACTOR_PCT);
    expect(needed).toBeLessThan(WOOD_TRACK_STROKES); // mastery saves strokes
    const { sim, miner, node } = trainedMinerScene(4, MASTERY_XP);
    for (let stroke = 1; stroke < needed; stroke++) {
      harvestOnce(sim, miner, node, WOOD, HARVEST_WOOD);
      settleStrokeCadence(sim, miner);
      expect(sim.world.get(node, MineDeposit).strikes).toBe(stroke);
      expect(sim.world.get(miner, HarvestFocus).node).toBe(node); // released mid-unit, the node remembered
    }
    expect(oreDrops(sim)).toHaveLength(0);

    harvestOnce(sim, miner, node, WOOD, HARVEST_WOOD);
    expect(sim.world.get(node, MineDeposit).strikes).toBe(0);
    expect(sim.world.get(node, Resource).remaining).toBe(3);
    expect(oreDrops(sim)).toHaveLength(1);
    expect(sim.world.has(miner, CurrentAtomic)).toBe(false); // the extracting stroke releases at once
    expect(sim.world.has(miner, HarvestFocus)).toBe(false);
  });

  it('re-reads the count at every stroke, so mastery earned mid-unit frees the unit at once', () => {
    const masterNeeds = strokesPerUnit(WOOD_TRACK_STROKES, MASTERY_PCT, BARE_HANDS_WORK_FACTOR_PCT);
    const { sim, miner, node } = trainedMinerScene(4, 0);
    for (let stroke = 0; stroke < masterNeeds; stroke++) {
      harvestOnce(sim, miner, node, WOOD, HARVEST_WOOD);
      settleStrokeCadence(sim, miner);
    }
    expect(sim.world.get(node, MineDeposit).strikes).toBe(masterNeeds);
    expect(oreDrops(sim)).toHaveLength(0);
    sim.world.mut(miner, SettlerProgress).experience.set(WOOD_TRACK, MASTERY_XP);
    harvestOnce(sim, miner, node, WOOD, HARVEST_WOOD);
    expect(oreDrops(sim)).toHaveLength(1);
  });
});

describe('mining - the mushroom direct-pickup variant', () => {
  it('a bare node (no MineDeposit) yields one unit onto the back, is removed, and emits resourceDepleted', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A single mushroom: a bare Resource of one unit, no MineDeposit - the trivial direct pickup.
    const node = sim.world.create();
    sim.world.add(node, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(node, Resource, { goodType: MUSHROOM, remaining: 1, harvestAtomic: HARVEST_MUSHROOM });
    stampResourceFootprintData(sim.world, node, anchorOnlyFootprint());
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

describe('mining - end-to-end through the real schedule', () => {
  it('a miner chips a deposit dry, delivers every unit to the store, and the node is gone; goods conserved', () => {
    // Strip: miner@0, a stone deposit@3, a warehouse store@4 (a real typed store - a delivery sink must
    // be a Building/Vehicle, never a bare loose pile).
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(6, 1) });
    const miner = makeMiner(sim, 0, 0);
    placeDeposit(sim, 3, 0);
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(4), y: fx.fromInt(0) });
    sim.world.add(store, Building, { buildingType: 7, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map<number, number>() });

    let maxStone = 0;
    const violations: string[] = [];
    // The stances a unit's chips are struck from: the miner holds its stance between the chips of one
    // unit, so each set has one member.
    const stancesPerUnit: Set<string>[] = [];
    let unitStances = new Set<string>();
    let dropsSeen = 0;
    for (let i = 0; i < 900; i++) {
      sim.step();
      maxStone = Math.max(maxStone, totalStone(sim));
      if (sim.world.tryGet(miner, CurrentAtomic)?.effect.kind === 'harvest') {
        const p = sim.world.get(miner, Position);
        unitStances.add(`${p.x},${p.y}`);
      }
      const drops = oreDrops(sim).length;
      if (drops > dropsSeen) {
        stancesPerUnit.push(unitStances);
        unitStances = new Set<string>();
      }
      dropsSeen = drops;
      if (violations.length === 0) {
        const v = checkInvariants(sim.world, sim.content, CORE_INVARIANTS);
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
    // …and the miner chipped every unit from one stance, without a walk between its strokes.
    expect(stancesPerUnit).toHaveLength(DEPOSIT_SIZE);
    expect(stancesPerUnit.map((s) => s.size)).toEqual(new Array(DEPOSIT_SIZE).fill(1));
  });
});
