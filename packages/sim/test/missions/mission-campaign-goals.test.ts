import { describe, expect, it } from 'vitest';
import { missionRecords, Position, Rider } from '../../src/components/index.js';
import { exportSaveGame, restoreSimulation, Simulation, type TerrainMap } from '../../src/index.js';
import type { MissionGoalOp } from '../../src/systems/missions/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';
import {
  goalMission,
  goalSim,
  HUT,
  holds,
  houseContent,
  LOAD_PASS,
  missionSim,
  POINT,
  runLoadPass,
  scriptedSim,
  spawn,
  stamped,
  VIKING,
  WOLF,
} from './support.js';

const WIDTH = 48;
const OWNER = 2;
const HUMAN = 71;
const HANDCART = 1;
const SCOUT = 27;
const OTHER_POINT = { hx: 34, hy: 20 };
const HUMAN_GOAL: MissionGoalOp = { opcode: 'HumanIsOnContinent', humanId: HUMAN, point: POINT };
const HOUSE_GOAL: MissionGoalOp = {
  opcode: 'BuildHouseOnContinent',
  player: OWNER,
  houseType: HUT,
  point: POINT,
};

/** One walkable field, but two authored continent ids. */
function authoredMap(): TerrainMap {
  return {
    ...grassNodeMap(WIDTH, WIDTH),
    waterContinents: Array.from({ length: WIDTH * WIDTH }, (_, node) => (node % WIDTH < 28 ? 7 : 9)),
  };
}

describe('campaign continent goals', () => {
  it.each([
    [POINT, HUMAN, true],
    [OTHER_POINT, HUMAN, false],
    [POINT, HUMAN + 1, false],
  ] as const)('judges the authored continent and human id (%o, %i)', (at, missionId, expected) => {
    const sim = missionSim([goalMission(HUMAN_GOAL)], testContent(), authoredMap());
    spawn(sim, { at, missionId });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(expected);
  });

  it('matches authored land even when navigation separates it', () => {
    const map = waterColumnMap(24, 24, 12);
    const sim = missionSim([goalMission(HUMAN_GOAL)], testContent(), {
      ...map,
      waterContinents: new Array(WIDTH * WIDTH).fill(7),
    });
    spawn(sim, { at: OTHER_POINT, missionId: HUMAN });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('uses disconnected movement components when no authored lane exists', () => {
    const sim = missionSim([goalMission(HUMAN_GOAL)], testContent(), waterColumnMap(24, 24, 12));
    spawn(sim, { at: OTHER_POINT, missionId: HUMAN });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(false);
  });

  it.each([-1, WIDTH])('refuses an out-of-map target at x=%i', (hx) => {
    const sim = missionSim(
      [goalMission({ ...HUMAN_GOAL, point: { hx, hy: 20 } })],
      testContent(),
      authoredMap(),
    );
    spawn(sim, { missionId: HUMAN });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(false);
  });

  it.each([
    [POINT, OWNER, false, true],
    [OTHER_POINT, OWNER, false, false],
    [POINT, OWNER + 1, false, false],
    [POINT, OWNER, true, false],
  ] as const)(
    'requires a completed owned house on the continent (%o, %i, site=%s)',
    (at, owner, underConstruction, expected) => {
      const sim = missionSim([goalMission(HOUSE_GOAL)], houseContent(), authoredMap());
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HUT,
        tribe: VIKING,
        x: at.hx,
        y: at.hy,
        owner,
        force: true,
        underConstruction,
      });
      sim.run(LOAD_PASS);
      expect(holds(sim)).toBe(expected);
    },
  );

  it('keeps a missing terrain answer unknown under a negated rule', () => {
    const mission = { ...goalMission(HUMAN_GOAL), successfullIf: 3 };
    const sim = new Simulation({ seed: 1, content: testContent(), missions: { missions: [mission] } });
    sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    sim.step();
    expect(holds(sim)).toBe(false);
    expect(missionRecords(sim.world)[0]?.unknownGoals).toEqual([0]);
  });

  it('preserves the pending predicate across save/restore on authored terrain', () => {
    const map = authoredMap();
    const sim = missionSim([goalMission(HUMAN_GOAL)], testContent(), map);
    spawn(sim, { at: OTHER_POINT, missionId: HUMAN });
    sim.run(LOAD_PASS);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map,
      ...(sim.missions === undefined ? {} : { missions: sim.missions }),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    sim.run(20);
    restored.run(20);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('uses the carrier location for an embarked human', () => {
    const sim = scriptedSim([goalMission(HUMAN_GOAL)], testContent(), authoredMap());
    const vehicle = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: HANDCART,
      x: POINT.hx,
      y: POINT.hy,
      tribe: VIKING,
      owner: OWNER,
    });
    if (vehicle === null) throw new Error('Fixture cart missing');
    spawn(sim, { player: OWNER, missionId: HUMAN, job: SCOUT });
    sim.step();
    const human = stamped(sim, HUMAN);
    sim.enqueueSetup({ kind: 'attachToVehicle', entity: human, vehicle });
    sim.step();
    expect(sim.world.has(human, Rider)).toBe(true);
    boardRider(sim.world, human, vehicle);
    expect(sim.world.has(human, Position)).toBe(false);
    runLoadPass(sim);
    expect(holds(sim)).toBe(true);
  });
});

describe('CheckNumberOfWildAnimals', () => {
  it.each([
    [0, 0, undefined, false],
    [1, 0, undefined, true],
    [1, 2, undefined, false],
    [2, 2, undefined, true],
    [3, 2, undefined, true],
    [3, 2, OWNER, false],
  ] as const)('counts %i animals against %i with owner %s', (count, amount, owner, expected) => {
    const sim = goalSim({ opcode: 'CheckNumberOfWildAnimals', tribe: WOLF, amount });
    if (count > 0)
      sim.enqueueSetup({
        kind: 'spawnAnimalHerd',
        tribe: WOLF,
        x: POINT.hx,
        y: POINT.hy,
        count,
        ...(owner === undefined ? {} : { owner }),
      });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(expected);
  });

  it('does not count a different species', () => {
    const sim = goalSim({ opcode: 'CheckNumberOfWildAnimals', tribe: WOLF + 1, amount: 1 });
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: WOLF, x: POINT.hx, y: POINT.hy, count: 2 });
    sim.run(LOAD_PASS);
    expect(holds(sim)).toBe(false);
  });
});
