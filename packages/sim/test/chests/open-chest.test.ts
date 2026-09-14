import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Chest,
  CurrentAtomic,
  DeferredOrder,
  OpenChestOrder,
  Owner,
  Person,
  Position,
  Settler,
  Stockpile,
  Vehicle,
} from '../../src/components/index.js';
import type { SimEvent } from '../../src/core/events.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import {
  createChest,
  jobCanOpenChest,
  OPEN_CHEST_ATOMIC_ID,
  resolveChestReward,
} from '../../src/systems/chests/index.js';
import { resourceBlockedCells } from '../../src/systems/footprint/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * Opening a chest: the ordered settler walks to the chest's work cell, plays the open-chest clip, and the
 * chest's contents land - goods on the ground, a paper in the owner's list, settlers at the chest. The
 * contents table is keyed by the chest type a map authors on the placement.
 */

const P0 = 0;
const VIKING = 1;
const WOODCUTTER = 1;
const CIVILIST = 6;
const HERO = 45;
const SMALL_FOOD_POTION = 14; // fixture good `potion_food_small`
const SIMPLE_FOOD = 3;
const SHOES = 8;

/** The fixture's `viking_eat` clip: 5 ticks, not interruptible. */
const EAT_ATOMIC = 10;
const EAT_TICKS = 5;

const POTION_CHEST = 1;
const FOOD_CHEST = 20;
const SHOES_CHEST = 26;
const ANY_HOUSE_CHEST = 50;
const CIVILISTS_CHEST = 92;
const UNKNOWN_CHEST = 40;
/** The fixture's catchable cow: an owned one is an orderable `Settler` that is no person. */
const COW_TRIBE = 13;

function fresh(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassCellMap(16, 16) });
}

function spawn(sim: Simulation, jobType: number, x: number, y: number, player = P0): Entity {
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: player });
  sim.step();
  return [...sim.world.query(Settler)].sort((a, b) => a - b).at(-1) as Entity;
}

function blockedCells(sim: Simulation): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('a mapped sim');
  return resourceBlockedCells(sim.world, terrain).size;
}

function looseGoods(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building) || sim.world.has(e, Vehicle)) continue;
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

/** Step until the chest is gone (or the budget runs out); returns the events of every tick stepped. */
function stepUntilOpened(sim: Simulation, chest: Entity, budget = 400): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < budget && sim.world.isAlive(chest); t++) {
    sim.step();
    events.push(...sim.events.current());
  }
  return events;
}

describe('chest contents', () => {
  it('resolves the table through the content slugs, per chest kind', () => {
    const content = testContent();
    expect(resolveChestReward(content, 'wooden', POTION_CHEST)).toEqual({
      kind: 'goods',
      goodType: SMALL_FOOD_POTION,
      amount: 1,
    });
    expect(resolveChestReward(content, 'magical', POTION_CHEST)).toEqual({
      kind: 'goods',
      goodType: SMALL_FOOD_POTION,
      amount: 3,
    });
    expect(resolveChestReward(content, 'wooden', ANY_HOUSE_CHEST)).toEqual({
      kind: 'paper',
      paper: { kind: 'placeAny', param: 0 },
    });
    expect(resolveChestReward(content, 'wooden', CIVILISTS_CHEST)).toEqual({
      kind: 'settlers',
      jobType: CIVILIST,
      count: 3,
    });
    // A house the fixture does not carry, and an unassigned type, open empty.
    expect(resolveChestReward(content, 'wooden', 70)).toEqual({ kind: 'nothing' });
    expect(resolveChestReward(content, 'wooden', UNKNOWN_CHEST)).toEqual({ kind: 'nothing' });
  });

  it('a wooden chest takes any trade, a magical one the hero (or druid) only', () => {
    const content = testContent();
    expect(jobCanOpenChest(content, WOODCUTTER, 'wooden')).toBe(true);
    expect(jobCanOpenChest(content, null, 'wooden')).toBe(true);
    expect(jobCanOpenChest(content, WOODCUTTER, 'magical')).toBe(false);
    expect(jobCanOpenChest(content, HERO, 'magical')).toBe(true);
  });
});

describe('the openChest order', () => {
  it('walks the settler to the chest, plays the open-chest clip, and heaps the goods beside it', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, { kind: 'wooden', contents: FOOD_CHEST, x: 16, y: 16 });
    expect(blockedCells(sim)).toBe(1); // the stand-in footprint: its own cell
    const opener = spawn(sim, WOODCUTTER, 6, 6);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: opener, chest }));
    sim.step();
    expect(sim.world.has(opener, OpenChestOrder)).toBe(true);
    let sawClip = false;
    const events: SimEvent[] = [];
    for (let t = 0; t < 400 && sim.world.isAlive(chest); t++) {
      sim.step();
      events.push(...sim.events.current());
      if (sim.world.tryGet(opener, CurrentAtomic)?.atomicId === OPEN_CHEST_ATOMIC_ID) sawClip = true;
    }
    expect(sawClip).toBe(true);
    expect(sim.world.isAlive(chest)).toBe(false);
    expect(sim.world.has(opener, OpenChestOrder)).toBe(false);
    expect(blockedCells(sim)).toBe(0); // the cell is free again
    expect(looseGoods(sim, SIMPLE_FOOD)).toBe(30);
    expect(events.find((e) => e.kind === 'chestOpened')).toEqual({
      kind: 'chestOpened',
      chest,
      at: { hx: 16, hy: 16 },
    });
    // The opener stood on a work cell next to the chest, never on it.
    const p = sim.world.get(opener, Position);
    expect(nodeOfPosition(p.x, p.y)).not.toEqual({ hx: 16, hy: 16 });
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a paper chest puts the paper in the opener player’s list and announces it', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'magical',
      contents: ANY_HOUSE_CHEST,
      x: 10,
      y: 10,
    });
    const hero = spawn(sim, HERO, 6, 6);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: hero, chest }));
    const events = stepUntilOpened(sim, chest);
    expect(sim.world.isAlive(chest)).toBe(false);
    expect(sim.papers(P0)).toEqual([{ kind: 'placeAny', param: 0 }]);
    expect(events.find((e) => e.kind === 'paperFound')).toEqual({
      kind: 'paperFound',
      player: P0,
      paper: { kind: 'placeAny', param: 0 },
      chest,
      at: { hx: 10, hy: 10 },
    });
  });

  it('a settlers chest stands up three civilists for the opener’s player', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: CIVILISTS_CHEST,
      x: 10,
      y: 10,
    });
    const opener = spawn(sim, WOODCUTTER, 6, 6);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: opener, chest }));
    stepUntilOpened(sim, chest);
    const settlers = [...sim.world.query(Settler)];
    expect(settlers).toHaveLength(4);
    const recruits = settlers.filter((e) => e !== opener);
    for (const e of recruits) {
      expect(sim.world.get(e, Settler).jobType).toBe(CIVILIST);
      expect(sim.world.get(e, Owner).player).toBe(P0);
    }
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a hero opens a magical chest, and it holds more of the same', () => {
    const sim = fresh();
    const magical = createChest(sim.world, sim.content, {
      kind: 'magical',
      contents: SHOES_CHEST,
      x: 10,
      y: 10,
    });
    const hero = spawn(sim, HERO, 6, 6);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: hero, chest: magical }));
    sim.step();
    expect(sim.world.has(hero, OpenChestOrder)).toBe(true);
    stepUntilOpened(sim, magical);
    expect(sim.world.isAlive(magical)).toBe(false);
    expect(looseGoods(sim, SHOES)).toBe(9);
  });

  it('a magical chest refuses a plain trade, and a child refuses any chest', () => {
    const sim = fresh();
    const magical = createChest(sim.world, sim.content, {
      kind: 'magical',
      contents: SHOES_CHEST,
      x: 10,
      y: 10,
    });
    const wooden = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: SHOES_CHEST,
      x: 20,
      y: 10,
    });
    const woodcutter = spawn(sim, WOODCUTTER, 6, 6);
    const child = spawn(sim, WOODCUTTER, 6, 12);
    sim.world.add(child, Age, { ticks: 0 });
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: woodcutter, chest: magical }));
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: child, chest: wooden }));
    sim.step();
    expect(sim.world.has(woodcutter, OpenChestOrder)).toBe(false);
    expect(sim.world.has(child, OpenChestOrder)).toBe(false);
    for (let t = 0; t < 60; t++) sim.step();
    expect(sim.world.isAlive(magical)).toBe(true);
    expect(sim.world.isAlive(wooden)).toBe(true);
    expect(looseGoods(sim, SHOES)).toBe(0);
  });

  it('owned livestock is no opener, and a fight order or a trade change drops the walk', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: SHOES_CHEST,
      x: 10,
      y: 10,
    });
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: COW_TRIBE, x: 20, y: 20, count: 1 });
    sim.step();
    const cow = [...sim.world.query(Settler)].find((e) => !sim.world.has(e, Person)) as Entity;
    sim.world.add(cow, Owner, { player: P0 });
    const woodcutter = spawn(sim, WOODCUTTER, 26, 26);
    const enemy = spawn(sim, WOODCUTTER, 26, 6, 1);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: cow, chest }));
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: woodcutter, chest }));
    sim.step();
    expect(sim.world.has(cow, OpenChestOrder)).toBe(false);
    expect(sim.world.has(woodcutter, OpenChestOrder)).toBe(true);
    sim.enqueue(playerCommand(P0, { kind: 'attackUnit', entity: woodcutter, target: enemy }));
    sim.step();
    expect(sim.world.has(woodcutter, OpenChestOrder)).toBe(false);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: woodcutter, chest }));
    sim.step();
    expect(sim.world.has(woodcutter, OpenChestOrder)).toBe(true);
    sim.enqueue(playerCommand(P0, { kind: 'setJob', entity: woodcutter, jobType: CIVILIST }));
    sim.step();
    expect(sim.world.has(woodcutter, OpenChestOrder)).toBe(false);
    expect(sim.world.isAlive(chest)).toBe(true);
  });

  it('runs after the player order retires the walk and before the planner could re-task the opener', () => {
    const names = SYSTEM_ORDER.map((s) => s.name);
    expect(names.indexOf('playerOrder')).toBeLessThan(names.indexOf('chestOrder'));
    expect(names.indexOf('chestOrder')).toBeLessThan(names.indexOf('planner'));
  });

  it('two settlers sent to one chest: the second finds it gone and returns to autonomy', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: SHOES_CHEST,
      x: 10,
      y: 10,
    });
    const near = spawn(sim, WOODCUTTER, 6, 8);
    const far = spawn(sim, WOODCUTTER, 26, 26);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: near, chest }));
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: far, chest }));
    stepUntilOpened(sim, chest);
    expect(looseGoods(sim, SHOES)).toBe(6);
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.world.has(far, OpenChestOrder)).toBe(false);
    expect([...sim.world.query(Chest)]).toEqual([]);
    expect(looseGoods(sim, SHOES)).toBe(6); // opened once
  });

  it('parks behind a meal and re-dispatches the tick the meal ends; a fresh walk order supersedes it', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: SHOES_CHEST,
      x: 10,
      y: 10,
    });
    const opener = spawn(sim, WOODCUTTER, 6, 6);
    sim.world.add(opener, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: EAT_TICKS,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: opener, chest }));
    sim.step();
    expect(sim.world.has(opener, OpenChestOrder)).toBe(false); // parked, not started
    expect(sim.world.get(opener, DeferredOrder).command.kind).toBe('openChest');
    sim.run(EAT_TICKS - 1);
    expect(sim.world.has(opener, DeferredOrder)).toBe(false);
    expect(sim.world.has(opener, OpenChestOrder)).toBe(true); // re-dispatched as the meal ended

    // A walk order ends the chest errand: the settler goes where it was sent and the chest stands.
    sim.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: opener, x: 4, y: 4 }));
    sim.step();
    expect(sim.world.has(opener, OpenChestOrder)).toBe(false);
    for (let t = 0; t < 200; t++) sim.step();
    expect(sim.world.isAlive(chest)).toBe(true);
  });

  it('a chest of a type the table does not know opens empty, and the order still retires', () => {
    const sim = fresh();
    const chest = createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: UNKNOWN_CHEST,
      x: 10,
      y: 10,
    });
    const opener = spawn(sim, WOODCUTTER, 6, 6);
    sim.enqueue(playerCommand(P0, { kind: 'openChest', entity: opener, chest }));
    stepUntilOpened(sim, chest);
    expect(sim.world.isAlive(chest)).toBe(false);
    expect(sim.papers(P0)).toEqual([]);
    expect([...sim.world.query(Settler)]).toHaveLength(1);
  });
});
