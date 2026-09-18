import { describe, expect, it } from 'vitest';
import {
  JobAssignment,
  Position,
  Rider,
  Settler,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  adminCommand,
  exportSaveGame,
  type HalfCellNode,
  halfCellMapFromCells,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The crew of docs/formats/VEHICLES.md "Crew" and the carried vehicles of "Ships and docking": the attach
 * gate and its notes, the walk to the door, boarding on a goto, commander promotion, the straggler and
 * pending-need rules, the forced detach ahead of an ordinary order, a rider's death, a cart riding a
 * moored ship, and a save with people aboard.
 */

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const HANDCART = 1;
const SHIP_SMALL = 3;
const CATAPULT = 5;
const SCOUT = 27;
const CIVILIST = 6;
const WOODCUTTER = 1;
const MAP_CELLS = 16;
const GRASS = 0;
const WATER = 1;
/** The first water column of the shore map, in cells; the ships lie east of it. */
const SHORE_CELL = 10;
/** A hunger reading past the drive threshold, in percent. */
const STARVING_PCT = 90;
/** A scout's ten-node walk at its nine ticks a node, with a tick to board. */
const BOARD_TICKS = 120;
/** The door of a handcart parked at (12, 6): the first open node of the ring around it, north-east. */
const CART_DOOR = { hx: 12, hy: 5 } as const;
const SAIL_TICKS = 300;

/** The west grass, the east open water, at cell resolution. */
function shoreMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = SHORE_CELL; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

/** Two landmasses split by a water column at cell 5. */
function splitMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) typeIds[row * MAP_CELLS + 5] = WATER;
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function sim(map: TerrainMap = shoreMap(), seed = 5): Simulation {
  const s = new Simulation({ seed, content: testContent(), map });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

function spawn(s: Simulation, vehicleType: number, x: number, y: number, owner = P0): Entity {
  const e = createVehicle(s.world, ctxOf(s), { vehicleType, x, y, tribe: VIKING, owner });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function spawnSettler(s: Simulation, x: number, y: number, jobType = SCOUT, owner = P0): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  s.step();
  const settlers = [...s.world.query(Settler)];
  const settler = settlers[settlers.length - 1];
  if (settler === undefined) throw new Error('settler missing');
  return settler;
}

function attach(s: Simulation, entity: Entity, vehicle: Entity, player = P0): void {
  s.enqueue(playerCommand(player, { kind: 'attachToVehicle', entity, vehicle }));
  s.step();
}

function nodeOf(s: Simulation, e: Entity): HalfCellNode | null {
  const p = s.world.tryGet(e, Position);
  return p === undefined ? null : nodeOfPosition(p.x, p.y);
}

function seatOf(s: Simulation, vehicle: Entity, rider: Entity): { inside: boolean } | undefined {
  return vehiclePassengers(s.world.get(vehicle, Vehicle)).find((seat) => seat.entity === rider);
}

function riderRefusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'riderRefused' ? [`${ev.entity}:${ev.reason}:${ev.player}`] : []));
}

function crewRefusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'vehicleCrewRefused' ? [`${ev.entity}:${ev.reason}:${ev.player}`] : []));
}

/** Step until `rider` is inside `vehicle`, returning the ticks taken. */
function boardOut(s: Simulation, vehicle: Entity, rider: Entity, limit = BOARD_TICKS): number {
  for (let ticks = 1; ticks <= limit; ticks++) {
    s.step();
    if (seatOf(s, vehicle, rider)?.inside === true) return ticks;
  }
  throw new Error('rider never boarded');
}

describe('attachToVehicle', () => {
  it('seats an allowed trade in the commander slot and walks it to the door, leaving its workplace', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 2, 6);
    attach(s, scout, cart);
    expect(vehicleCommander(s.world.get(cart, Vehicle))).toBe(scout);
    expect(seatOf(s, cart, scout)).toEqual({ entity: scout, inside: false });
    expect(s.world.get(scout, Rider)).toEqual({ vehicle: cart, boarding: false });
    expect(s.world.has(scout, JobAssignment)).toBe(false);
    s.run(BOARD_TICKS);
    expect(nodeOf(s, scout)).toEqual(CART_DOOR);
    expect(seatOf(s, cart, scout)?.inside).toBe(false); // nobody asked it in
  });

  it('refuses a trade the type does not list with cannotEnter and a full vehicle with noRoom', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const woodcutter = spawnSettler(s, 2, 6, WOODCUTTER);
    attach(s, woodcutter, cart);
    expect(riderRefusals(s)).toEqual([`${woodcutter}:cannotEnter:${P0}`]);
    expect(s.world.has(woodcutter, Rider)).toBe(false);
    const first = spawnSettler(s, 2, 8);
    const second = spawnSettler(s, 2, 10);
    attach(s, first, cart);
    attach(s, second, cart);
    expect(crewRefusals(s)).toEqual([`${cart}:noRoom:${P0}`]);
    expect(s.world.has(second, Rider)).toBe(false);
    expect(vehicleCommander(s.world.get(cart, Vehicle))).toBe(first);
  });

  it("is refused for another player's vehicle and for a settler of another seat", () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6, P1);
    const scout = spawnSettler(s, 2, 6);
    attach(s, scout, cart);
    attach(s, scout, cart, P1);
    expect(s.world.has(scout, Rider)).toBe(false);
    expect(vehiclePassengers(s.world.get(cart, Vehicle))).toEqual([]);
  });

  it('promotes the first ordinary passenger when the commander detaches', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const first = spawnSettler(s, 2, 6);
    const second = spawnSettler(s, 2, 8);
    attach(s, first, ship);
    attach(s, second, ship);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(first);
    s.enqueue(playerCommand(P0, { kind: 'detachFromVehicle', entity: first }));
    s.step();
    expect(s.world.has(first, Rider)).toBe(false);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(second);
    expect(vehiclePassengers(s.world.get(ship, Vehicle))).toHaveLength(1);
  });
});

describe('boarding', () => {
  it('holds a goto until the crew is inside, then drives; the rider leaves the map and rides along', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 2, 6);
    attach(s, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: cart, x: 4, y: 12 }));
    s.step();
    expect(s.world.get(cart, Vehicle).task).toBe('waitsForHuman');
    expect(s.world.get(cart, Vehicle).heldGoal).toEqual({ hx: 4, hy: 12 });
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
    boardOut(s, cart, scout);
    expect(s.world.has(scout, Position)).toBe(false);
    expect(s.world.get(scout, Rider)).toEqual({ vehicle: cart, boarding: false });
    s.step();
    expect(s.world.get(cart, Vehicle).task).toBe('none');
    expect(s.world.has(cart, VehicleDrive)).toBe(true);
    s.run(SAIL_TICKS);
    expect(nodeOf(s, cart)).toEqual({ hx: 4, hy: 12 });
    expect(s.world.has(scout, Position)).toBe(false);
    const saved = serializeSaveGame(exportSaveGame(s));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: shoreMap(),
    });
    expect(restored.hashState()).toBe(s.hashState());
    expect(restored.world.get(scout, Rider)).toEqual({ vehicle: cart, boarding: false });
  });

  it("refuses a goto without a commander and boards a moored ship's crew at its mooring", () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: ship, x: 26, y: 12 }));
    s.step();
    expect(
      s.events.current().some((ev) => ev.kind === 'vehicleMoveRefused' && ev.reason === 'noCommander'),
    ).toBe(true);
    const first = spawnSettler(s, 2, 6);
    const second = spawnSettler(s, 2, 8);
    attach(s, first, ship);
    attach(s, second, ship);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: first }));
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: second }));
    boardOut(s, ship, first, SAIL_TICKS);
    boardOut(s, ship, second, SAIL_TICKS);
    expect(s.world.has(first, Position)).toBe(false);
    expect(s.world.has(second, Position)).toBe(false);
    expect(vehiclePassengers(s.world.get(ship, Vehicle)).every((seat) => seat.inside)).toBe(true);
  });

  it('detaches a rider on another continent instead of waiting for it', () => {
    const s = sim(splitMap());
    const cart = spawn(s, HANDCART, 4, 6);
    const near = spawnSettler(s, 2, 6);
    const far = spawnSettler(s, 20, 6);
    attach(s, near, cart);
    attach(s, far, cart);
    // The far scout took the commander slot? No: the near one attached first and commands; the far one
    // is refused a second seat on a one-seat cart, so seat it on a ship instead.
    expect(s.world.has(far, Rider)).toBe(false);
    const ship = spawn(s, SHIP_SMALL, 4, 12);
    attach(s, far, ship);
    attach(s, near, ship);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(far);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: ship, x: 4, y: 20 }));
    s.step();
    s.step();
    expect(s.world.has(far, Rider)).toBe(false);
    expect(nodeOf(s, far)).toEqual({ hx: 20, hy: 6 });
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(near);
  });

  it('does not ask a rider with a pending need aboard', () => {
    const s = sim();
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 12, 6);
    attach(s, scout, cart);
    s.enqueue(adminCommand({ kind: 'debugSetNeeds', target: scout, hunger: STARVING_PCT }));
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: cart, x: 4, y: 12 }));
    s.run(BOARD_TICKS);
    expect(s.world.get(cart, Vehicle).task).toBe('waitsForHuman');
    expect(s.world.get(scout, Rider).boarding).toBe(false);
    expect(s.world.has(scout, Position)).toBe(true);
  });

  it('boardVehicle steps a rider standing on the door in without a goto', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 12, 6);
    attach(s, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: scout }));
    boardOut(s, cart, scout);
    expect(s.world.has(scout, Position)).toBe(false);
  });
});

describe('leaving', () => {
  it('detaches ahead of an ordinary order and refuses to leave a ship at sea with cannotLeave', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const scout = spawnSettler(s, 2, 6);
    attach(s, scout, ship);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: scout }));
    boardOut(s, ship, scout, SAIL_TICKS);
    s.world.mut(ship, Vehicle).moored = false; // cast off
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: scout, x: 2, y: 6 }));
    s.step();
    expect(riderRefusals(s)).toEqual([`${scout}:cannotLeave:${P0}`]);
    expect(s.world.has(scout, Position)).toBe(false);
    expect(s.world.has(scout, Rider)).toBe(true);
    s.world.mut(ship, Vehicle).moored = true;
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: scout, x: 2, y: 6 }));
    s.step();
    expect(s.world.has(scout, Rider)).toBe(false);
    expect(vehiclePassengers(s.world.get(ship, Vehicle))).toEqual([]);
    const mooring = s.world.get(ship, Vehicle).mooring;
    expect(mooring).not.toBeNull();
    expect(s.world.has(scout, Position)).toBe(true);
    s.run(SAIL_TICKS);
    expect(nodeOf(s, scout)).toEqual({ hx: 2, hy: 6 }); // the order ran after the detach
  });

  it('unloadPeople puts everyone aboard onto the door node and frees them', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 12, 6);
    attach(s, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: scout }));
    boardOut(s, cart, scout);
    s.enqueue(playerCommand(P0, { kind: 'unloadPeople', vehicle: cart }));
    s.step();
    expect(nodeOf(s, scout)).toEqual(CART_DOOR);
    expect(s.world.has(scout, Rider)).toBe(false);
    expect(vehiclePassengers(s.world.get(cart, Vehicle))).toEqual([]);
  });

  it('unseats a rider that dies aboard, so the vehicle never meets a dead seat', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const first = spawnSettler(s, 2, 6);
    const second = spawnSettler(s, 2, 8);
    attach(s, first, ship);
    attach(s, second, ship);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: first }));
    boardOut(s, ship, first, SAIL_TICKS);
    s.enqueue(adminCommand({ kind: 'debugKill', target: first }));
    s.step();
    expect(s.world.isAlive(first)).toBe(false);
    expect(vehiclePassengers(s.world.get(ship, Vehicle)).map((seat) => seat.entity)).toEqual([second]);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(second);
  });

  it('sets the crew of a destroyed cart down and drowns the crew of a ship at sea', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 12, 6);
    attach(s, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: scout }));
    boardOut(s, cart, scout);
    s.enqueue(adminCommand({ kind: 'debugKill', target: cart }));
    s.step();
    expect(s.world.isAlive(scout)).toBe(true);
    expect(nodeOf(s, scout)).toEqual(CART_DOOR);
    expect(s.world.has(scout, Rider)).toBe(false);
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const sailor = spawnSettler(s, 2, 8);
    attach(s, sailor, ship);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: sailor }));
    boardOut(s, ship, sailor, SAIL_TICKS);
    s.world.mut(ship, Vehicle).moored = false;
    s.enqueue(adminCommand({ kind: 'debugKill', target: ship }));
    s.step();
    expect(s.world.isAlive(sailor)).toBe(false);
  });
});

describe('carried vehicles', () => {
  /** A cart with a scout aboard, standing on the shore beside a moored ship. */
  function loadedCart(s: Simulation): { ship: Entity; cart: Entity; scout: Entity } {
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const cart = spawn(s, HANDCART, 10, 6);
    const scout = spawnSettler(s, 10, 6);
    attach(s, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: scout }));
    boardOut(s, cart, scout);
    return { ship, cart, scout };
  }

  it('boards a small ship with its crew aboard and leaves it onto the shore', () => {
    const s = sim();
    const { ship, cart, scout } = loadedCart(s);
    const mooring = s.world.get(ship, Vehicle).mooring;
    if (mooring === null) throw new Error('the ship spawned unmoored');
    s.enqueue(playerCommand(P0, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship }));
    s.step();
    expect(s.world.get(cart, Vehicle).task).toBe('boardsShip');
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([{ entity: cart, inside: false }]);
    s.run(SAIL_TICKS);
    expect(s.world.has(cart, Position)).toBe(false);
    expect(s.world.get(cart, Vehicle).carrier).toBe(ship);
    expect(s.world.get(cart, Vehicle).task).toBe('none');
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([{ entity: cart, inside: true }]);
    expect(seatOf(s, cart, scout)?.inside).toBe(true); // the crew rides inside its own vehicle
    expect(s.world.has(scout, Position)).toBe(false);
    // Off a ship at sea, nobody leaves.
    s.world.mut(ship, Vehicle).moored = false;
    s.enqueue(playerCommand(P0, { kind: 'leaveCarrier', vehicle: cart }));
    s.step();
    expect(crewRefusals(s)).toEqual([`${cart}:cannotLeave:${P0}`]);
    s.enqueue(playerCommand(P0, { kind: 'detachFromVehicle', entity: scout }));
    s.step();
    expect(riderRefusals(s)).toEqual([`${scout}:cannotLeave:${P0}`]);
    s.world.mut(ship, Vehicle).moored = true;
    s.enqueue(playerCommand(P0, { kind: 'leaveCarrier', vehicle: cart }));
    s.step();
    expect(nodeOf(s, cart)).toEqual(mooring);
    expect(s.world.get(cart, Vehicle).carrier).toBeNull();
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([null]);
    expect(seatOf(s, cart, scout)?.inside).toBe(true);
  });

  it('refuses a carrier that does not list the vehicle, and drops a load the ship cannot take', () => {
    const s = sim();
    const { ship, cart } = loadedCart(s);
    const catapult = spawn(s, CATAPULT, 6, 12);
    s.enqueue(playerCommand(P0, { kind: 'loadIntoVehicle', vehicle: cart, carrier: catapult }));
    s.step();
    expect(crewRefusals(s)).toEqual([`${cart}:cannotAttach:${P0}`]);
    s.world.mut(ship, Vehicle).moored = false;
    s.enqueue(playerCommand(P0, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship }));
    s.step(); // attached by the command, dropped by the boarding pass of the same tick
    expect(crewRefusals(s)).toEqual([`${cart}:noRoom:${P0}`]);
    expect(s.world.get(cart, Vehicle).carrier).toBeNull();
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([null]);
  });

  it('clears the carrier slot when the carried vehicle is removed', () => {
    const s = sim();
    const { ship, cart, scout } = loadedCart(s);
    s.enqueue(playerCommand(P0, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship }));
    s.run(SAIL_TICKS);
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([{ entity: cart, inside: true }]);
    s.enqueue(adminCommand({ kind: 'debugKill', target: cart }));
    s.step();
    expect(s.world.isAlive(cart)).toBe(false);
    expect(s.world.get(ship, Vehicle).vehicles).toEqual([null]);
    expect(nodeOf(s, scout)).toEqual(s.world.get(ship, Vehicle).mooring); // set down on the ship's door
    expect(s.world.has(scout, Rider)).toBe(false);
  });

  it('a civilist may crew the ship but not the cart it rides', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 10, 6);
    const civilist = spawnSettler(s, 10, 6, CIVILIST);
    attach(s, civilist, cart);
    expect(riderRefusals(s)).toEqual([`${civilist}:cannotEnter:${P0}`]);
  });
});

describe('an authored seat', () => {
  it('seats a spawned settler on the vehicle standing on its anchor, the first as commander, aboard when inside', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 22, 8);
    const mooring = s.world.get(ship, Vehicle).mooring;
    if (mooring === null) throw new Error('the ship should spawn moored');
    for (const inside of [true, false]) {
      s.enqueueSetup({
        kind: 'spawnSettler',
        jobType: SCOUT,
        x: 2,
        y: 6,
        tribe: VIKING,
        owner: P0,
        vehicle: { x: 22, y: 8, inside },
      });
    }
    s.step();
    const [first, second] = [...s.world.query(Settler)];
    if (first === undefined || second === undefined) throw new Error('two settlers expected');
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(first);
    expect(seatOf(s, ship, first)).toEqual({ entity: first, inside: true });
    expect(s.world.has(first, Position)).toBe(false);
    expect(seatOf(s, ship, second)).toEqual({ entity: second, inside: false });
    expect(s.world.get(second, Rider)).toEqual({ vehicle: ship, boarding: false });
    expect(nodeOf(s, second)).not.toBeNull(); // walking to the door from where it spawned
  });

  it('leaves a settler where it spawned when no vehicle stands on the anchor or the gate refuses it', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    s.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SCOUT,
      x: 2,
      y: 6,
      tribe: VIKING,
      owner: P0,
      vehicle: { x: 5, y: 5, inside: true },
    });
    s.enqueueSetup({
      kind: 'spawnSettler',
      jobType: CIVILIST,
      x: 2,
      y: 8,
      tribe: VIKING,
      owner: P0,
      vehicle: { x: 12, y: 6, inside: true },
    });
    s.step();
    const settlers = [...s.world.query(Settler)];
    expect(settlers).toHaveLength(2);
    for (const e of settlers) {
      expect(s.world.has(e, Rider)).toBe(false);
      expect(s.world.has(e, Position)).toBe(true);
    }
    expect(vehiclePassengers(s.world.get(cart, Vehicle))).toHaveLength(0);
  });
});
