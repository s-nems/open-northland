import { describe, expect, it } from 'vitest';
import {
  DraughtAnimal,
  FarmAnimal,
  Health,
  Livestock,
  MoveGoal,
  Owner,
  Position,
  Settler,
  StayPoint,
  Vehicle,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import type { HalfCellNode } from '../../src/nav/halfcell.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import {
  createVehicle,
  DRAUGHT_BREEDING_PAIR,
  DRAUGHT_RECRUIT_CADENCE_TICKS,
  draughtAnimalSystem,
  harnessVehicle,
  pickDraughtAnimal,
  removeVehicle,
} from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The draught animal of docs/formats/VEHICLES.md "Lifecycle": the ox-less cart waits under
 * `waitsForAnimal`, recruits the nearest of its owner's animals past a breeding pair on the door's
 * continent, the animal walks over and is consumed, and the cart becomes the ox cart in place. A goto on
 * the waiting cart raises `vehicleNoAnimal`.
 */

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const CART_NO_OX = 6;
const OXCART = 2;
/** The societies fixture's catchable cow, the fixture cart's `draggingAnimalTribe`. */
const COW = 13;
const COW_HP = 1000;
const MAP_CELLS = 16;
const GRASS = 0;
const WATER = 1;
/** The cart stands here; the herd spawns along the row to its east. */
const CART: HalfCellNode = { hx: 6, hy: 8 };
/** Ticks enough for a cow a dozen nodes off to reach the cart under the default pace. */
const WALK_LIMIT = 400;

function sim(map: TerrainMap = grassCellMap(MAP_CELLS, MAP_CELLS)): Simulation {
  return new Simulation({ seed: 5, content: testContent(), map });
}

/** The left half grass, the right half open water, at cell resolution. */
function shoreMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = MAP_CELLS / 2; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function cart(s: Simulation, owner = P0, at = CART): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType: CART_NO_OX,
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    owner,
  });
  if (e === null) throw new Error('the fixture lacks the ox-less cart');
  return e;
}

/** A claimed cow on the node, or a wild one for a null owner. */
function cow(s: Simulation, hx: number, hy: number, owner: number | null = P0): Entity {
  const e = settlerAt(s, { jobType: null, tribe: COW, position: positionOfNode(hx, hy) });
  s.world.add(e, Health, { hitpoints: COW_HP, max: COW_HP });
  s.world.add(e, Livestock, {});
  s.world.add(e, StayPoint, { cell: s.terrain?.nodeAtClamped(hx, hy) ?? 0 });
  if (owner !== null) s.world.add(e, Owner, { player: owner });
  return e;
}

function doorOf(s: Simulation, vehicle: Entity): NodeId {
  const p = s.world.get(vehicle, Position);
  const at = nodeOfPosition(p.x, p.y);
  if (s.terrain === undefined) throw new Error('mapless');
  return s.terrain.nodeAtClamped(at.hx, at.hy);
}

function pick(s: Simulation, vehicle: Entity): Entity | null {
  if (s.terrain === undefined) throw new Error('mapless');
  return pickDraughtAnimal(s.world, s.terrain, vehicle, COW, doorOf(s, vehicle));
}

function refusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'vehicleMoveRefused' ? [`${ev.entity}:${ev.reason}`] : []));
}

/** Step until the cart is harnessed, returning the ticks taken. */
function untilHarnessed(s: Simulation, vehicle: Entity, limit = WALK_LIMIT): number {
  let ticks = 0;
  while (!s.world.get(vehicle, Vehicle).harnessed) {
    s.step();
    ticks++;
    if (ticks > limit) throw new Error('the cart was never harnessed');
  }
  return ticks;
}

describe('the recruit pick', () => {
  it('passes over the first two eligible animals by id, the breeding pair, whatever their distance', () => {
    const s = sim();
    const c = cart(s);
    const near = cow(s, CART.hx + 2, CART.hy);
    const nearer = cow(s, CART.hx + 1, CART.hy);
    const far = cow(s, CART.hx + 10, CART.hy);
    expect(DRAUGHT_BREEDING_PAIR).toBe(2);
    expect(pick(s, c)).toBe(far);
    expect([near, nearer]).not.toContain(pick(s, c));
  });

  it('takes the nearest of the rest by hexagon distance, ties to the lower id', () => {
    const s = sim();
    const c = cart(s);
    cow(s, CART.hx + 8, CART.hy);
    cow(s, CART.hx + 9, CART.hy);
    const distant = cow(s, CART.hx + 12, CART.hy);
    const close = cow(s, CART.hx + 3, CART.hy + 1);
    const tied = cow(s, CART.hx + 3, CART.hy - 1);
    expect(hexDistanceBetween(CART.hx, CART.hy, CART.hx + 3, CART.hy + 1)).toBe(
      hexDistanceBetween(CART.hx, CART.hy, CART.hx + 3, CART.hy - 1),
    );
    expect(pick(s, c)).toBe(close);
    expect(pick(s, c)).not.toBe(tied);
    expect(pick(s, c)).not.toBe(distant);
  });

  it('counts only the owner’s animals of the tribe on the door’s continent that nothing else has booked', () => {
    const s = sim(shoreMap());
    const c = cart(s);
    // Two eligible cows make the pair; each of the rest is disqualified for one reason.
    cow(s, CART.hx + 1, CART.hy);
    cow(s, CART.hx + 2, CART.hy);
    cow(s, CART.hx + 3, CART.hy, P1);
    cow(s, CART.hx + 3, CART.hy + 2, null);
    const booked = cow(s, CART.hx + 4, CART.hy);
    // A breeder leading it to its farm's door: stand-in entities, since only the link is read.
    s.world.add(booked, FarmAnimal, { farm: s.world.create(), summoner: s.world.create() });
    const taken = cow(s, CART.hx + 5, CART.hy);
    s.world.add(taken, DraughtAnimal, { vehicle: c });
    // Across the water: the shore map's right half is another component.
    const cell = 2 * (MAP_CELLS - 2);
    cow(s, cell, CART.hy);
    expect(pick(s, c)).toBeNull();
    const eligible = cow(s, CART.hx + 6, CART.hy);
    expect(pick(s, c)).toBe(eligible);
  });

  it('gives an unowned cart nothing', () => {
    const s = sim();
    const c = cart(s);
    s.world.remove(c, Owner);
    for (let i = 1; i <= 4; i++) cow(s, CART.hx + i, CART.hy);
    expect(pick(s, c)).toBeNull();
  });
});

describe('the harness', () => {
  it('consumes the animal and turns the cart into its transform type in place', () => {
    const s = sim();
    const c = cart(s);
    const ox = cow(s, CART.hx + 1, CART.hy);
    const before = s.world.get(c, Position);
    const at = { x: before.x, y: before.y };
    harnessVehicle(s.world, ctxOf(s), c, ox);
    expect(s.world.isAlive(ox)).toBe(false);
    const state = s.world.get(c, Vehicle);
    expect(state.vehicleType).toBe(OXCART);
    expect(state.harnessed).toBe(true);
    expect(state.task).toBe('none');
    expect(state.passengers).toEqual([null]);
    expect(s.world.get(c, Position)).toEqual(at);
    expect(s.world.get(c, Health)).toEqual({ hitpoints: 1000, max: 1000 });
  });

  it('spawns the ox-less cart waiting for its animal and refuses its goto with noAnimal', () => {
    const s = sim();
    const c = cart(s);
    expect(s.world.get(c, Vehicle).task).toBe('waitsForAnimal');
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: c, x: CART.hx + 4, y: CART.hy }));
    s.step();
    expect(refusals(s)).toEqual([`${c}:noAnimal`]);
  });
});

describe('the draught animal system', () => {
  it('recruits on its cadence, walks the animal to the cart and harnesses it on arrival', () => {
    const s = sim();
    const c = cart(s);
    cow(s, CART.hx + 8, CART.hy + 2);
    cow(s, CART.hx + 9, CART.hy + 2);
    const ox = cow(s, CART.hx + 10, CART.hy + 2);
    const spare = cow(s, CART.hx + 12, CART.hy + 2);
    // The first scan tick books the recruit and aims it at the cart.
    s.run(DRAUGHT_RECRUIT_CADENCE_TICKS);
    expect(s.world.get(ox, DraughtAnimal)).toEqual({ vehicle: c });
    expect(s.world.has(spare, DraughtAnimal)).toBe(false);
    expect(s.world.get(c, Vehicle).task).toBe('waitsForAnimal');
    untilHarnessed(s, c);
    expect(s.world.isAlive(ox)).toBe(false);
    expect(s.world.isAlive(spare)).toBe(true);
    expect(s.world.get(c, Vehicle).vehicleType).toBe(OXCART);
    // The oxcart takes a commander now: a goto is refused for the crew, not the animal.
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: c, x: CART.hx + 4, y: CART.hy }));
    s.step();
    expect(refusals(s)).toEqual([`${c}:noCommander`]);
  });

  it('scans only on the cadence tick and never books a second recruit for one cart', () => {
    const s = sim();
    const c = cart(s);
    for (let i = 1; i <= 2; i++) cow(s, CART.hx + 8 + i, CART.hy);
    const ox = cow(s, CART.hx + 11, CART.hy);
    const other = cow(s, CART.hx + 12, CART.hy);
    const ctx = { ...ctxOf(s), tick: 1 };
    draughtAnimalSystem(s.world, ctx);
    expect(s.world.has(ox, DraughtAnimal)).toBe(false);
    draughtAnimalSystem(s.world, { ...ctx, tick: DRAUGHT_RECRUIT_CADENCE_TICKS });
    expect(s.world.get(ox, DraughtAnimal)).toEqual({ vehicle: c });
    draughtAnimalSystem(s.world, { ...ctx, tick: 2 * DRAUGHT_RECRUIT_CADENCE_TICKS });
    expect(s.world.has(other, DraughtAnimal)).toBe(false);
  });

  it('releases a recruit back to its grazing spot when its cart is gone', () => {
    const s = sim();
    const c = cart(s);
    for (let i = 1; i <= 2; i++) cow(s, CART.hx + 8 + i, CART.hy);
    const ox = cow(s, CART.hx + 11, CART.hy);
    s.run(DRAUGHT_RECRUIT_CADENCE_TICKS);
    expect(s.world.has(ox, DraughtAnimal)).toBe(true);
    removeVehicle(s.world, ctxOf(s), c, 'script');
    s.step();
    expect(s.world.has(ox, DraughtAnimal)).toBe(false);
    expect(s.world.get(ox, MoveGoal).cell).toBe(s.world.get(ox, StayPoint).cell);
  });

  it('keeps two carts from sharing one recruit', () => {
    const s = sim();
    const first = cart(s);
    const second = cart(s, P0, { hx: CART.hx, hy: CART.hy + 4 });
    for (let i = 1; i <= 2; i++) cow(s, CART.hx + 8 + i, CART.hy);
    const a = cow(s, CART.hx + 11, CART.hy);
    const b = cow(s, CART.hx + 11, CART.hy + 4);
    s.run(DRAUGHT_RECRUIT_CADENCE_TICKS);
    expect(s.world.get(a, DraughtAnimal).vehicle).toBe(first);
    expect(s.world.get(b, DraughtAnimal).vehicle).toBe(second);
  });

  it('never recruits the same-tribe animals of an ordinary settler tribe', () => {
    const s = sim();
    const c = cart(s);
    for (let i = 1; i <= 3; i++) {
      const e = settlerAt(s, {
        jobType: null,
        tribe: VIKING,
        position: positionOfNode(CART.hx + i, CART.hy),
      });
      s.world.add(e, Owner, { player: P0 });
    }
    expect(pick(s, c)).toBeNull();
    expect([...s.world.query(Settler)]).toHaveLength(3);
  });
});
