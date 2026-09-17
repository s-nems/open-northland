import { describe, expect, it } from 'vitest';
import {
  FOG_MODE,
  isAboardVehicle,
  MissionObjectId,
  ownerOf,
  Person,
  Position,
  Rider,
  Settler,
  Vehicle,
  VehicleDrive,
  VehicleStock,
  vehicleCommander,
  vehiclePassengers,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, type Simulation, type TerrainMap } from '../../src/index.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../src/nav/halfcell.js';
import type { MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import { MISSION_EVALUATION_TICKS, missionObjects, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  FIRST_PASS,
  firingSim,
  goalSim,
  holds,
  MAP_NODES,
  missionSim,
  POINT,
  spawn,
  VIKING,
} from './support.js';

/**
 * The vehicle results and goals of docs/formats/VEHICLES.md "Map scripts" and MISSIONS.md: a scripted
 * spawn with its captain, the removals, the renumberings, the crew orders, the teleport's vehicle half,
 * and every goal that reads a vehicle's id, hold or place.
 */

const OWNER = 2;
const OTHER = 3;
const CART_ID = 40;
const OTHER_ID = 41;
const CREW_ID = 50;
const HANDCART = 1;
const CATAPULT = 5;
const SCOUT = 27;
const SOLDIER = 31;
const WOOD = 1;
const PLANK = 2;
const FAR = { hx: POINT.hx + 16, hy: POINT.hy };
const AREA = 4;
/** Long enough for a scout spawned a few nodes off to walk to a cart's door and step in. */
const BOARD_TICKS = 120;
const MAP_CELLS = 16;
const GRASS = 0;
const WATER = 1;

function cart(
  sim: Simulation,
  spec: {
    at?: HalfCellNode;
    owner?: number;
    missionId?: number;
    type?: number;
    goods?: { good: number; amount: number }[];
  } = {},
): Entity {
  const at = spec.at ?? POINT;
  const e = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: spec.type ?? HANDCART,
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    owner: spec.owner ?? OWNER,
    ...(spec.missionId !== undefined ? { missionId: spec.missionId } : {}),
    ...(spec.goods !== undefined ? { goods: spec.goods } : {}),
  });
  if (e === null) throw new Error('vehicle type not in the fixture');
  return e;
}

function vehicles(sim: Simulation): Entity[] {
  return [...sim.world.query(Vehicle)];
}

function nodeOf(sim: Simulation, e: Entity): HalfCellNode {
  const at = sim.world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}

function goalVerdict(goal: MissionGoalOp, arrange: (sim: Simulation) => void): boolean {
  const sim = goalSim(goal);
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
  arrange(sim);
  sim.run(FIRST_PASS);
  return holds(sim);
}

/** Two landmasses split by a water column at cell 5. */
function splitMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) typeIds[row * MAP_CELLS + 5] = WATER;
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

describe('SetVehicle', () => {
  it('stands a vehicle of the type for the player with the id', () => {
    const sim = firingSim([
      {
        opcode: 'SetVehicle',
        player: OWNER,
        tribe: VIKING,
        vehicleType: HANDCART,
        point: POINT,
        vehicleId: CART_ID,
        withCaptain: false,
      },
    ]);
    sim.run(FIRST_PASS);
    const [e] = vehicles(sim);
    if (e === undefined) throw new Error('no vehicle spawned');
    expect(vehicles(sim)).toHaveLength(1);
    expect(sim.world.get(e, Vehicle).vehicleType).toBe(HANDCART);
    expect(ownerOf(sim.world, e)).toBe(OWNER);
    expect(sim.world.get(e, MissionObjectId).id).toBe(CART_ID);
    expect(nodeOf(sim, e)).toEqual(POINT);
    expect([...sim.world.query(Person)]).toHaveLength(0);
  });

  it('with the captain flag also seats a commander of the first passenger trade, aboard, with the vehicle id', () => {
    const sim = firingSim([
      {
        opcode: 'SetVehicle',
        player: OWNER,
        tribe: VIKING,
        vehicleType: CATAPULT,
        point: POINT,
        vehicleId: CART_ID,
        withCaptain: true,
      },
    ]);
    sim.run(FIRST_PASS);
    const [e] = vehicles(sim);
    if (e === undefined) throw new Error('no vehicle spawned');
    const captain = vehicleCommander(sim.world.get(e, Vehicle));
    if (captain === null) throw new Error('no captain seated');
    expect(sim.world.get(captain, Settler).jobType).toBe(SOLDIER);
    expect(ownerOf(sim.world, captain)).toBe(OWNER);
    expect(sim.world.get(captain, MissionObjectId).id).toBe(CART_ID);
    expect(isAboardVehicle(sim.world, captain)).toBe(true);
    expect(missionObjects(sim.world, CART_ID)).toEqual([e, captain]);
  });

  it('reports a point off the map or a type the content lacks as a failed line', () => {
    const lines: MissionResultOp[] = [
      {
        opcode: 'SetVehicle',
        player: OWNER,
        tribe: VIKING,
        vehicleType: 99,
        point: POINT,
        vehicleId: CART_ID,
        withCaptain: false,
      },
      {
        opcode: 'SetVehicle',
        player: OWNER,
        tribe: VIKING,
        vehicleType: HANDCART,
        point: { hx: MAP_NODES + 5, hy: 1 },
        vehicleId: CART_ID,
        withCaptain: false,
      },
    ];
    for (const line of lines) {
      const sim = firingSim([line]);
      sim.run(FIRST_PASS);
      expect(vehicles(sim)).toHaveLength(0);
      expect(sim.events.current().filter((e) => e.kind === 'missionResultFailed')).toHaveLength(1);
    }
  });
});

describe('the removals', () => {
  it('RemoveVehicles takes every vehicle with the id off the map without a wreck, setting its crew down', () => {
    const sim = firingSim([{ opcode: 'RemoveVehicles', vehicleId: CART_ID }]);
    const doomed = cart(sim, { missionId: CART_ID });
    const spared = cart(sim, { at: FAR, missionId: OTHER_ID });
    spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
    sim.step();
    const [crew] = missionObjects(sim.world, CREW_ID);
    if (crew === undefined) throw new Error('no crew');
    sim.enqueueSetup({ kind: 'attachToVehicle', entity: crew, vehicle: doomed });
    sim.run(FIRST_PASS - sim.tick);
    expect(vehicles(sim)).toEqual([spared]);
    expect(sim.world.isAlive(crew)).toBe(true);
    expect(sim.world.has(crew, Rider)).toBe(false);
    const gone = sim.events.current().filter((e) => e.kind === 'vehicleDestroyed');
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ entity: doomed, cause: 'script', ruins: [] });
  });

  it('RemoveVehiclesWithMissionId takes the crews with it only when the flag is set', () => {
    for (const flag of [false, true]) {
      const sim = firingSim([{ opcode: 'RemoveVehiclesWithMissionId', vehicleId: CART_ID, flag }]);
      const doomed = cart(sim, { missionId: CART_ID });
      spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
      sim.step();
      const [crew] = missionObjects(sim.world, CREW_ID);
      if (crew === undefined) throw new Error('no crew');
      sim.enqueueSetup({ kind: 'attachToVehicle', entity: crew, vehicle: doomed });
      sim.run(FIRST_PASS - sim.tick);
      expect(vehicles(sim)).toHaveLength(0);
      expect(sim.world.isAlive(crew)).toBe(!flag);
    }
  });
});

describe('ownership and ids', () => {
  it('ChangeVehiclesPlayerId hands the vehicles with the id over and leaves the crew its owner', () => {
    const sim = firingSim([{ opcode: 'ChangeVehiclesPlayerId', vehicleId: CART_ID, player: OTHER }]);
    const handed = cart(sim, { missionId: CART_ID });
    const kept = cart(sim, { at: FAR });
    spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
    sim.step();
    const [crew] = missionObjects(sim.world, CREW_ID);
    if (crew === undefined) throw new Error('no crew');
    sim.enqueueSetup({ kind: 'attachToVehicle', entity: crew, vehicle: handed });
    sim.run(FIRST_PASS - sim.tick);
    expect(ownerOf(sim.world, handed)).toBe(OTHER);
    expect(ownerOf(sim.world, kept)).toBe(OWNER);
    expect(ownerOf(sim.world, crew)).toBe(OWNER);
    expect(vehicleCommander(sim.world.get(handed, Vehicle))).toBe(crew);
  });

  it('ChangeMissionIdOfVehicles renumbers one id to another, and to none for 0', () => {
    const sim = firingSim([
      { opcode: 'ChangeMissionIdOfVehicles', vehicleId: CART_ID, index: OTHER_ID },
      { opcode: 'ChangeMissionIdOfVehicles', vehicleId: 7, index: 0 },
    ]);
    const renumbered = cart(sim, { missionId: CART_ID });
    const cleared = cart(sim, { at: FAR, missionId: 7 });
    sim.run(FIRST_PASS);
    expect(sim.world.get(renumbered, MissionObjectId).id).toBe(OTHER_ID);
    expect(sim.world.has(cleared, MissionObjectId)).toBe(false);
  });

  it("ChangeMissionIdOfVehiclesInRange stamps the player's vehicles inside the area alone", () => {
    const sim = firingSim([
      {
        opcode: 'ChangeMissionIdOfVehiclesInRange',
        player: OWNER,
        vehicleId: CART_ID,
        point: POINT,
        range: AREA,
      },
    ]);
    const inside = cart(sim, { at: { hx: POINT.hx + 2, hy: POINT.hy } });
    const outside = cart(sim, { at: FAR });
    const foreign = cart(sim, { at: POINT, owner: OTHER });
    sim.run(FIRST_PASS);
    expect(sim.world.tryGet(inside, MissionObjectId)?.id).toBe(CART_ID);
    expect(sim.world.has(outside, MissionObjectId)).toBe(false);
    expect(sim.world.has(foreign, MissionObjectId)).toBe(false);
  });

  it("ChangeMissionIdOfPlayersVehiclesOnContinent stamps the vehicles on the point's landmass", () => {
    const west = { hx: 4, hy: 8 };
    const east = { hx: 20, hy: 8 };
    const sim = missionSim(
      [
        {
          successfullIf: SUCCESSFUL_IF.all,
          active: true,
          visible: false,
          goals: [],
          results: [
            {
              opcode: 'ChangeMissionIdOfPlayersVehiclesOnContinent',
              player: OWNER,
              point: west,
              vehicleId: CART_ID,
            },
          ],
        },
      ],
      testContent(),
      splitMap(),
    );
    const near = cart(sim, { at: { hx: 6, hy: 12 } });
    const across = cart(sim, { at: east });
    sim.run(FIRST_PASS);
    expect(sim.world.tryGet(near, MissionObjectId)?.id).toBe(CART_ID);
    expect(sim.world.has(across, MissionObjectId)).toBe(false);
  });
});

describe('the crew results', () => {
  it('AttachHumanToVehicle seats every admitted human with the id on the first vehicle with the vehicle id', () => {
    const sim = firingSim([{ opcode: 'AttachHumanToVehicle', humanId: CREW_ID, vehicleId: CART_ID }]);
    const first = cart(sim, { missionId: CART_ID });
    const second = cart(sim, { at: FAR, missionId: CART_ID });
    const near = { hx: POINT.hx + 2, hy: POINT.hy };
    spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: near });
    spawn(sim, { player: OWNER, job: SOLDIER, missionId: CREW_ID, at: near }); // not a cart trade
    spawn(sim, { player: OTHER, job: SCOUT, missionId: CREW_ID, at: near }); // another owner
    sim.run(FIRST_PASS);
    const seated = vehiclePassengers(sim.world.get(first, Vehicle)).map((seat) => seat.entity);
    expect(seated).toHaveLength(1);
    expect(sim.world.get(seated[0] as Entity, Settler).jobType).toBe(SCOUT);
    expect(vehiclePassengers(sim.world.get(second, Vehicle))).toHaveLength(0);
    expect(sim.events.current().filter((e) => e.kind === 'riderRefused')).toHaveLength(0);
  });

  it('DetachHumanFromVehicle frees every rider with the id where it stands', () => {
    const sim = firingSim([{ opcode: 'DetachHumanFromVehicle', humanId: CREW_ID }]);
    const e = cart(sim);
    spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
    sim.step();
    const [crew] = missionObjects(sim.world, CREW_ID);
    if (crew === undefined) throw new Error('no crew');
    sim.enqueueSetup({ kind: 'attachToVehicle', entity: crew, vehicle: e });
    sim.step();
    expect(sim.world.has(crew, Rider)).toBe(true);
    sim.run(FIRST_PASS - sim.tick);
    expect(sim.world.has(crew, Rider)).toBe(false);
    expect(vehiclePassengers(sim.world.get(e, Vehicle))).toHaveLength(0);
  });
});

describe('MoveUnitsInArea', () => {
  it("sets the player's vehicles in the area down beside the destination, drives dropped", () => {
    const destination = { hx: POINT.hx, hy: POINT.hy + 20 };
    const sim = firingSim([
      {
        opcode: 'MoveUnitsInArea',
        player: OWNER,
        point: POINT,
        range: AREA,
        index: destination.hx,
        extra: destination.hy,
      },
    ]);
    const moved = cart(sim, { at: { hx: POINT.hx + 1, hy: POINT.hy } });
    const other = cart(sim, { at: { hx: POINT.hx - 1, hy: POINT.hy } });
    const left = cart(sim, { at: FAR });
    const foreign = cart(sim, { at: POINT, owner: OTHER });
    sim.run(FIRST_PASS);
    for (const e of [moved, other]) {
      expect(hexDistance(nodeOf(sim, e), destination)).toBeLessThanOrEqual(1);
      expect(sim.world.has(e, VehicleDrive)).toBe(false);
    }
    expect(nodeOf(sim, moved)).not.toEqual(nodeOf(sim, other));
    expect(nodeOf(sim, left)).toEqual(FAR);
    expect(nodeOf(sim, foreign)).toEqual(POINT);
  });
});

describe('the vehicle goals', () => {
  it("GoodsInVehicles sums the hold of every vehicle with the id, under the hold's alias", () => {
    const goal: MissionGoalOp = { opcode: 'GoodsInVehicles', vehicleId: CART_ID, good: WOOD, amount: 5 };
    expect(
      goalVerdict(goal, (sim) => {
        cart(sim, { missionId: CART_ID, goods: [{ good: WOOD, amount: 3 }] });
        cart(sim, { at: FAR, missionId: CART_ID, goods: [{ good: WOOD, amount: 2 }] });
      }),
    ).toBe(true);
    expect(
      goalVerdict(goal, (sim) => {
        cart(sim, { missionId: CART_ID, goods: [{ good: WOOD, amount: 3 }] });
        cart(sim, { at: FAR, missionId: OTHER_ID, goods: [{ good: WOOD, amount: 2 }] });
      }),
    ).toBe(false);
    // Nothing carrying the id fails even an amount of 0.
    expect(goalVerdict({ ...goal, amount: 0 }, () => {})).toBe(false);
  });

  it('FindVehicles holds once a vehicle with the id stands on a point the player explored', () => {
    const goal: MissionGoalOp = { opcode: 'FindVehicles', player: OWNER, vehicleId: CART_ID };
    expect(goalVerdict(goal, (sim) => cart(sim, { missionId: CART_ID, owner: OTHER }))).toBe(false);
    expect(
      goalVerdict(goal, (sim) => {
        cart(sim, { missionId: CART_ID, owner: OTHER });
        spawn(sim, { player: OWNER, at: POINT }); // the owner's own eye reveals the point
      }),
    ).toBe(true);
    expect(goalVerdict(goal, () => {})).toBe(false);
  });

  it("the range goals measure from the vehicle's standing node", () => {
    const near = { hx: POINT.hx + 2, hy: POINT.hy };
    expect(
      goalVerdict({ opcode: 'FindPosByVehicles', vehicleId: CART_ID, point: POINT, range: AREA }, (sim) => {
        cart(sim, { at: near, missionId: CART_ID });
      }),
    ).toBe(true);
    expect(
      goalVerdict({ opcode: 'FindPosByVehicles', vehicleId: CART_ID, point: POINT, range: AREA }, (sim) => {
        cart(sim, { at: FAR, missionId: CART_ID });
      }),
    ).toBe(false);
    expect(
      goalVerdict(
        { opcode: 'FindHumansByVehicles', vehicleId: CART_ID, humanId: CREW_ID, range: AREA },
        (sim) => {
          cart(sim, { at: near, missionId: CART_ID });
          spawn(sim, { player: OWNER, missionId: CREW_ID, at: POINT });
        },
      ),
    ).toBe(true);
    expect(
      goalVerdict(
        { opcode: 'FindVehiclesByVehicles', vehicleId: CART_ID, otherVehicleId: OTHER_ID, range: AREA },
        (sim) => {
          cart(sim, { at: near, missionId: CART_ID });
          cart(sim, { at: POINT, missionId: OTHER_ID });
        },
      ),
    ).toBe(true);
    expect(
      goalVerdict(
        { opcode: 'FindVehiclesByVehicles', vehicleId: CART_ID, otherVehicleId: OTHER_ID, range: AREA },
        (sim) => {
          cart(sim, { at: near, missionId: CART_ID });
          cart(sim, { at: FAR, missionId: OTHER_ID });
        },
      ),
    ).toBe(false);
    expect(
      goalVerdict(
        { opcode: 'FindHousesByVehicles', vehicleId: CART_ID, objectId: OTHER_ID, range: AREA },
        (sim) => {
          cart(sim, { at: near, missionId: CART_ID });
          sim.enqueueSetup({
            kind: 'placeBuilding',
            buildingType: 1,
            x: POINT.hx,
            y: POINT.hy,
            tribe: VIKING,
            owner: OWNER,
            force: true,
            missionId: OTHER_ID,
          });
        },
      ),
    ).toBe(true);
  });

  it('FindPosByPlayersMapMoveable and FindHumansByPlayersMM admit a vehicle of the player', () => {
    const goal: MissionGoalOp = {
      opcode: 'FindPosByPlayersMapMoveable',
      player: OWNER,
      point: POINT,
      range: AREA,
    };
    expect(goalVerdict(goal, (sim) => cart(sim, { at: POINT }))).toBe(true);
    expect(goalVerdict(goal, (sim) => cart(sim, { at: POINT, owner: OTHER }))).toBe(false);
    // Wide, since an idle settler drifts a few nodes before the first pass comes round.
    const near: MissionGoalOp = {
      opcode: 'FindHumansByPlayersMM',
      humanId: CREW_ID,
      player: OWNER,
      range: 10,
    };
    expect(
      goalVerdict(near, (sim) => {
        cart(sim, { at: POINT });
        spawn(sim, { player: OTHER, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
      }),
    ).toBe(true);
    expect(
      goalVerdict(near, (sim) => {
        cart(sim, { at: { hx: POINT.hx + 30, hy: POINT.hy } });
        spawn(sim, { player: OTHER, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
      }),
    ).toBe(false);
  });

  it('IsHumanInVehicle holds when every human with the id is aboard a vehicle with the vehicle id', () => {
    const sim = goalSim({ opcode: 'IsHumanInVehicle', humanId: CREW_ID, vehicleId: CART_ID });
    const e = cart(sim, { missionId: CART_ID });
    spawn(sim, { player: OWNER, job: SCOUT, missionId: CREW_ID, at: { hx: POINT.hx + 2, hy: POINT.hy } });
    sim.step();
    const [crew] = missionObjects(sim.world, CREW_ID);
    if (crew === undefined) throw new Error('no crew');
    sim.enqueueSetup({ kind: 'attachToVehicle', entity: crew, vehicle: e });
    sim.run(FIRST_PASS - sim.tick);
    expect(holds(sim)).toBe(false); // seated, still outside
    sim.enqueueSetup({ kind: 'boardVehicle', entity: crew });
    sim.run(BOARD_TICKS);
    expect(isAboardVehicle(sim.world, crew)).toBe(true);
    sim.run(MISSION_EVALUATION_TICKS);
    expect(holds(sim)).toBe(true);
  });

  it("the area goals count the player's vehicles of the type and their holds, 0 holding over nothing", () => {
    const count: MissionGoalOp = {
      opcode: 'NumberOfVehiclesInArea',
      player: OWNER,
      vehicleType: HANDCART,
      amount: 2,
      point: POINT,
      range: AREA,
    };
    expect(
      goalVerdict(count, (sim) => {
        cart(sim, { at: POINT });
        cart(sim, { at: { hx: POINT.hx + 2, hy: POINT.hy } });
        cart(sim, { at: FAR });
      }),
    ).toBe(true);
    expect(
      goalVerdict(count, (sim) => {
        cart(sim, { at: POINT });
        cart(sim, { at: { hx: POINT.hx + 2, hy: POINT.hy }, type: CATAPULT });
      }),
    ).toBe(false);
    expect(goalVerdict({ ...count, amount: 0 }, () => {})).toBe(true);
    const goods: MissionGoalOp = {
      opcode: 'NumberOfGoodsInVehiclesInArea',
      player: OWNER,
      vehicleType: HANDCART,
      good: PLANK,
      amount: 4,
      point: POINT,
      range: AREA,
    };
    expect(
      goalVerdict(goods, (sim) => {
        cart(sim, { at: POINT, goods: [{ good: PLANK, amount: 3 }] });
        cart(sim, { at: { hx: POINT.hx + 2, hy: POINT.hy }, goods: [{ good: PLANK, amount: 1 }] });
      }),
    ).toBe(true);
    expect(
      goalVerdict(goods, (sim) => {
        cart(sim, { at: POINT, goods: [{ good: PLANK, amount: 3 }] });
        cart(sim, { at: FAR, goods: [{ good: PLANK, amount: 1 }] });
      }),
    ).toBe(false);
  });
});

describe('a loaded cart', () => {
  it("asks for the cargo it spawned with, so a script's vehicle stock is not flushed by its carrier", () => {
    const sim = firingSim([]);
    const e = cart(sim, { goods: [{ good: WOOD, amount: 3 }] });
    expect(sim.world.get(e, VehicleStock).lines.get(WOOD)).toEqual({ current: 3, wanted: 3, reserved: 3 });
  });
});

describe('the sample lines stay well formed', () => {
  it('runs every vehicle line on an empty world without a report', () => {
    const results: MissionResultOp[] = [
      { opcode: 'RemoveVehicles', vehicleId: CART_ID },
      { opcode: 'RemoveVehiclesWithMissionId', vehicleId: CART_ID, flag: true },
      { opcode: 'ChangeVehiclesPlayerId', vehicleId: CART_ID, player: OTHER },
      { opcode: 'AttachHumanToVehicle', humanId: CREW_ID, vehicleId: CART_ID },
      { opcode: 'DetachHumanFromVehicle', humanId: CREW_ID },
      { opcode: 'ChangeMissionIdOfVehicles', vehicleId: CART_ID, index: OTHER_ID },
    ];
    const sim = firingSim(results, testContent(), grassNodeMap(MAP_NODES, MAP_NODES));
    sim.run(FIRST_PASS);
    expect(
      sim.events.current().filter((e) => e.kind === 'missionUnsupported' || e.kind === 'missionResultFailed'),
    ).toEqual([]);
  });
});
