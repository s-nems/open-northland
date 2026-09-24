import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  isWildlife,
  MissionBehaviour,
  MissionObjectId,
  missionRecords,
  Owner,
  ownerOf,
  Person,
  Position,
  Residence,
  Settler,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation } from '../../src/index.js';
import { hexDistance, nodeOfPosition } from '../../src/nav/halfcell.js';
import type { MissionResultOp } from '../../src/systems/missions/index.js';
import { missionObjects, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  FRANK,
  firingMission,
  firingSim,
  HUT,
  HUT_LARGE,
  houseContent,
  LOAD_PASS,
  loadPassAfter,
  MAP_NODES,
  missionSim,
  PASS_TICKS,
  POINT,
  SOLDIER,
  scriptedSim,
  VIKING,
  WILD,
  WOLF,
  WOODCUTTER,
} from './support.js';

/**
 * The results that put entities on the map, take them off it, and change who owns or addresses them.
 * Every world here is a small grass lattice, because these opcodes read the map.
 */

function humansOf(sim: Simulation, player: number): Entity[] {
  return [...sim.world.query(Person)].filter((e) => ownerOf(sim.world, e) === player);
}

function buildings(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)].sort((a, b) => a - b);
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  const first = items[0];
  if (first === undefined) throw new Error('empty');
  return first;
}

/** Two ticks in, a spawned settler has moved into the home its line named. */
const BOUND = 2;

const SET_HUMAN: Extract<MissionResultOp, { opcode: 'SetHuman' }> = {
  opcode: 'SetHuman',
  player: 2,
  tribe: VIKING,
  job: WOODCUTTER,
  point: POINT,
  humanId: 77,
  behaviour: 33,
};

describe('the spawn results', () => {
  it('places one settler for the owner, id and behaviour mask the line names', () => {
    const sim = firingSim([SET_HUMAN]);
    sim.run(LOAD_PASS);
    const spawned = only(missionObjects(sim.world, 77));
    expect(ownerOf(sim.world, spawned)).toBe(2);
    expect(sim.world.get(spawned, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(spawned, MissionBehaviour).flags).toBe(33);
    expect(sim.world.has(spawned, Person)).toBe(true);
  });

  it('repeats the whole line `amount` times for SetHumanX', () => {
    const sim = firingSim([{ ...SET_HUMAN, opcode: 'SetHumanX', amount: 5 }]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 77)).toHaveLength(5);
  });

  it('places one animal per SetAnimal, and the wild slot leaves it ownerless', () => {
    const sim = firingSim([
      { opcode: 'SetAnimal', player: WILD, tribe: WOLF, job: 0, point: POINT, objectId: 12, behaviour: 0 },
    ]);
    sim.run(LOAD_PASS);
    const animal = only(missionObjects(sim.world, 12));
    expect(isWildlife(sim.world, animal)).toBe(true);
    expect(sim.world.has(animal, Owner)).toBe(false);
  });

  it('hands a scripted herd to a real player when the line names one', () => {
    const sim = firingSim([
      { opcode: 'SetAnimal', player: 3, tribe: WOLF, job: 0, point: POINT, objectId: 12, behaviour: 0 },
    ]);
    sim.run(LOAD_PASS);
    expect(ownerOf(sim.world, only(missionObjects(sim.world, 12)))).toBe(3);
  });
});

describe('the house results', () => {
  it('builds at the point, finished and owned, carrying the line`s id', () => {
    const sim = firingSim(
      [
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: HUT, tribe: VIKING },
          level: 0,
          built: true,
          point: POINT,
          objectId: 5,
        },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    const house = only(missionObjects(sim.world, 5));
    const at = sim.world.get(house, Position);
    expect(nodeOfPosition(at.x, at.y)).toEqual(POINT);
    expect(sim.world.get(house, Building).built).toBe(ONE);
    expect(ownerOf(sim.world, house)).toBe(1);
  });

  it('builds it for the civilization its line resolved, not the one the type suggests', () => {
    const sim = firingSim(
      [
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: HUT, tribe: FRANK },
          level: 0,
          built: true,
          point: POINT,
          objectId: 5,
        },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect(sim.world.get(only(missionObjects(sim.world, 5)), Building).tribe).toBe(FRANK);
  });

  it('reports a failure when the map names a house its content never declares', () => {
    const sim = firingSim(
      [
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: -1, tribe: -1 },
          level: 0,
          built: true,
          point: POINT,
          objectId: 5,
        },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect(buildings(sim)).toHaveLength(0);
    expect(sim.events.current().filter((e) => e.kind === 'missionResultFailed')).toHaveLength(1);
  });

  it('raises a construction site when the line clears the built flag', () => {
    const sim = firingSim(
      [
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: HUT, tribe: VIKING },
          level: 0,
          built: false,
          point: POINT,
          objectId: 5,
        },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect(sim.world.has(only(missionObjects(sim.world, 5)), UnderConstruction)).toBe(true);
  });

  it('steps aside to the nearest spot that fits', () => {
    const blocking: Extract<MissionResultOp, { opcode: 'SetHouse' }> = {
      opcode: 'SetHouse',
      player: 1,
      houseName: { typeId: HUT, tribe: VIKING },
      level: 0,
      built: true,
      point: POINT,
      objectId: 5,
    };
    // Two houses on one point: the reserved rings may not overlap, so the second steps aside.
    const sim = firingSim([blocking, { ...blocking, objectId: 6 }], houseContent());
    sim.run(LOAD_PASS);
    const second = sim.world.get(only(missionObjects(sim.world, 6)), Position);
    expect(nodeOfPosition(second.x, second.y)).not.toEqual(POINT);
    // Exactly the nearest spot the first house left buildable, the lowest node id among ties.
    const alone = firingSim([blocking], houseContent());
    alone.run(LOAD_PASS);
    const probe = alone.placementProbe(HUT, 1, VIKING);
    if (probe === null) throw new Error('mapped fixture');
    let expected: { hx: number; hy: number } | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (let hy = 0; hy < MAP_NODES; hy++) {
      for (let hx = 0; hx < MAP_NODES; hx++) {
        const distance = hexDistance(POINT, { hx, hy });
        if (distance < best && probe.canPlace(hx, hy)) {
          best = distance;
          expected = { hx, hy };
        }
      }
    }
    expect(nodeOfPosition(second.x, second.y)).toEqual(expected);
  });

  it('reports a failure when nothing in reach fits', () => {
    // Every node's reserved ring runs off a lattice this small, so no spot in the band is buildable.
    const sim = new Simulation({
      seed: 1,
      content: houseContent(),
      map: grassNodeMap(2, 2),
      missions: {
        missions: [
          {
            successfullIf: SUCCESSFUL_IF.all,
            active: true,
            visible: false,
            goals: [],
            results: [
              {
                opcode: 'SetHouse',
                player: 1,
                houseName: { typeId: HUT, tribe: VIKING },
                level: 0,
                built: true,
                point: { hx: 0, hy: 0 },
                objectId: 5,
              },
            ],
          },
        ],
      },
    });
    sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    sim.run(LOAD_PASS);
    expect(buildings(sim)).toHaveLength(0);
    expect(sim.events.current().filter((e) => e.kind === 'missionResultFailed')).toEqual([
      { kind: 'missionResultFailed', mission: 0, opcode: 'SetHouse' },
    ]);
  });

  it('rebuilds a house at another level of its chain, in place', () => {
    const sim = firingSim(
      [
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: HUT, tribe: VIKING },
          level: 0,
          built: true,
          point: POINT,
          objectId: 5,
        },
        { opcode: 'SetHouseExtensionLevel', objectId: 5, amount: 1 },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    const house = only(missionObjects(sim.world, 5));
    expect(sim.world.get(house, Building).buildingType).toBe(HUT_LARGE);
    expect(sim.world.get(house, Building).level).toBe(1);
    expect(sim.world.get(house, Health).max).toBe(300);
    // The larger body settles its plot like a finished upgrade, which the app's clearing keys on.
    expect(sim.events.current().filter((e) => e.kind === 'buildingUpgraded')).toEqual([
      { kind: 'buildingUpgraded', entity: house, level: 1 },
    ]);
  });
});

describe('the removal results', () => {
  it('takes every human with the id off the board without a death cue', () => {
    const sim = firingSim([SET_HUMAN]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 77)).toHaveLength(1);

    const removing = firingSim([SET_HUMAN, { opcode: 'RemoveHumans', humanId: 77 }]);
    removing.run(LOAD_PASS);
    expect(missionObjects(removing.world, 77)).toHaveLength(0);
    expect(removing.events.current().filter((e) => e.kind === 'settlerDied')).toHaveLength(0);
  });

  it('takes animals and houses the same way', () => {
    const sim = firingSim(
      [
        { opcode: 'SetAnimal', player: WILD, tribe: WOLF, job: 0, point: POINT, objectId: 12, behaviour: 0 },
        {
          opcode: 'SetHouse',
          player: 1,
          houseName: { typeId: HUT, tribe: VIKING },
          level: 0,
          built: true,
          point: POINT,
          objectId: 5,
        },
        { opcode: 'RemoveAnimals', objectId: 12 },
        { opcode: 'RemoveHouses', objectId: 5 },
      ],
      houseContent(),
    );
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 12)).toHaveLength(0);
    expect(buildings(sim)).toHaveLength(0);
  });

  it('leaves an animal of the same id standing when the line asks for houses', () => {
    const sim = firingSim([
      { opcode: 'SetAnimal', player: WILD, tribe: WOLF, job: 0, point: POINT, objectId: 9, behaviour: 0 },
      { opcode: 'RemoveHouses', objectId: 9 },
    ]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 9)).toHaveLength(1);
  });
});

describe('the ownership results', () => {
  /** A player-2 soldier living in a player-2 hut, and a script that waits for that binding. A job id
   *  outside the age classes, so the settler is an adult its home will take. */
  function housed(results: readonly MissionResultOp[]): { sim: Simulation; moved: Entity } {
    const sim = scriptedSim([firingMission(results)], houseContent());
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 2,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SOLDIER,
      tribe: VIKING,
      x: POINT.hx + 4,
      y: POINT.hy,
      owner: 2,
      missionId: 77,
      home: { x: POINT.hx, y: POINT.hy },
    });
    sim.run(BOUND);
    const moved = only(missionObjects(sim.world, 77));
    expect(sim.world.has(moved, Residence)).toBe(true);
    return { sim, moved };
  }

  it('hands the humans with an id to another player and cuts their bindings', () => {
    const { sim, moved } = housed([{ opcode: 'ChangeHumanPlayerId', humanId: 77, player: 4 }]);
    loadPassAfter(sim, 0);
    expect(ownerOf(sim.world, moved)).toBe(4);
    expect(sim.world.has(moved, Residence)).toBe(false);
  });

  it('unhouses the residents of a house the script removes', () => {
    const HOUSE_ID = 5;
    const { sim, moved } = housed([{ opcode: 'RemoveHouses', objectId: HOUSE_ID }]);
    sim.world.add(only(buildings(sim)), MissionObjectId, { id: HOUSE_ID });
    loadPassAfter(sim, 0);
    expect(buildings(sim)).toHaveLength(0);
    expect(sim.world.has(moved, Residence)).toBe(false);
  });

  it('leaves a whole nation`s bindings alone when it changes flag', () => {
    const { sim, moved } = housed([{ opcode: 'ChangePlayerPlayerId', player: 2, otherPlayer: 5 }]);
    loadPassAfter(sim, 0);
    expect(ownerOf(sim.world, moved)).toBe(5);
    // The house moved with its owner, so the settler keeps living in it.
    expect(sim.world.has(moved, Residence)).toBe(true);
  });

  it('hands a whole player to another', () => {
    const sim = firingSim([
      SET_HUMAN,
      { ...SET_HUMAN, humanId: 78 },
      { opcode: 'ChangePlayerPlayerId', player: 2, otherPlayer: 5 },
    ]);
    sim.run(LOAD_PASS);
    expect(humansOf(sim, 2)).toHaveLength(0);
    expect(humansOf(sim, 5)).toHaveLength(2);
  });

  it('hands over only what stands inside the area', () => {
    const far = { hx: POINT.hx + 12, hy: POINT.hy };
    const sim = firingSim([
      SET_HUMAN,
      { ...SET_HUMAN, humanId: 78, point: far },
      { opcode: 'ChangePlayerIdInArea', player: 2, otherPlayer: 6, point: POINT, range: 3 },
    ]);
    sim.run(LOAD_PASS);
    expect(ownerOf(sim.world, only(missionObjects(sim.world, 77)))).toBe(6);
    expect(ownerOf(sim.world, only(missionObjects(sim.world, 78)))).toBe(2);
  });

  it('cuts the bindings of the humans an area handover takes', () => {
    const { sim, moved } = housed([
      { opcode: 'ChangePlayerIdInArea', player: 2, otherPlayer: 6, point: POINT, range: 6 },
    ]);
    loadPassAfter(sim, 0);
    expect(ownerOf(sim.world, moved)).toBe(6);
    expect(sim.world.has(moved, Residence)).toBe(false);
  });

  it('leaves the owner store alone when a repeating line hands a house to its own owner', () => {
    const HOUSE_ID = 5;
    const sim = scriptedSim(
      [
        {
          ...firingMission([
            { opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: 2 },
            { opcode: 'ActivateMission', missionIndex: 0 },
          ]),
          goals: [{ opcode: 'True' }],
        },
      ],
      houseContent(),
    );
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 2,
      missionId: HOUSE_ID,
    });
    loadPassAfter(sim, 1);
    const generation = sim.world.componentGeneration(Owner);
    sim.run(PASS_TICKS);
    expect(missionRecords(sim.world)[0]?.fireCount).toBe(2);
    expect(ownerOf(sim.world, only(buildings(sim)))).toBe(2);
    expect(sim.world.componentGeneration(Owner)).toBe(generation);
  });

  it('tames at most the number of animals the line asks for', () => {
    const herd: MissionResultOp[] = [1, 2, 3].map((objectId) => ({
      opcode: 'SetAnimal',
      player: WILD,
      tribe: WOLF,
      job: 0,
      point: POINT,
      objectId,
      behaviour: 0,
    }));
    const sim = firingSim([
      ...herd,
      {
        opcode: 'ChangeAnimalPlayerIdInArea',
        player: WILD,
        tribe: WOLF,
        point: POINT,
        range: 6,
        amount: 2,
        otherPlayer: 7,
      },
    ]);
    sim.run(LOAD_PASS);
    const tamed = [...sim.world.query(Settler)].filter((e) => ownerOf(sim.world, e) === 7);
    expect(tamed).toHaveLength(2);
  });
});

describe('the object-id results', () => {
  it('renumbers every human of a player', () => {
    const sim = firingSim([
      SET_HUMAN,
      { ...SET_HUMAN, humanId: 78 },
      { opcode: 'ChangeMissionIdOfPlayer', player: 2, humanId: 99 },
    ]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 99)).toHaveLength(2);
    expect(missionObjects(sim.world, 77)).toHaveLength(0);
  });

  it('renumbers only the humans inside the range', () => {
    const far = { hx: POINT.hx + 12, hy: POINT.hy };
    const sim = firingSim([
      SET_HUMAN,
      { ...SET_HUMAN, humanId: 78, point: far },
      { opcode: 'ChangeHumanObjectIdInArea', player: 2, point: POINT, range: 3, humanId: 99 },
    ]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 99)).toHaveLength(1);
    expect(missionObjects(sim.world, 78)).toHaveLength(1);
  });

  it('leaves the id store alone when a repeating line renumbers a group to the id it holds', () => {
    const sim = missionSim([
      firingMission([SET_HUMAN, { opcode: 'ActivateMission', missionIndex: 1 }]),
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: false,
        visible: false,
        goals: [{ opcode: 'True' }],
        results: [
          { opcode: 'ChangeMissionIdOfHumanInRange', player: 2, point: POINT, range: 3, humanId: 99 },
          { opcode: 'ActivateMission', missionIndex: 1 },
        ],
      },
    ]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 99)).toHaveLength(1);
    const generation = sim.world.componentGeneration(MissionObjectId);
    sim.run(PASS_TICKS);
    expect(missionRecords(sim.world)[1]?.fireCount).toBe(2);
    expect(missionObjects(sim.world, 99)).toHaveLength(1);
    expect(sim.world.componentGeneration(MissionObjectId)).toBe(generation);
  });

  it('clears the id when the line renumbers to nothing', () => {
    const sim = firingSim([SET_HUMAN, { opcode: 'ChangeMissionIdOfPlayer', player: 2, humanId: 0 }]);
    sim.run(LOAD_PASS);
    expect(missionObjects(sim.world, 77)).toHaveLength(0);
    expect([...sim.world.query(MissionObjectId)]).toHaveLength(0);
  });
});
