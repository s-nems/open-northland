import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../../../src/core/loop.js';
import {
  MissionTiming,
  type Objective,
  objectiveOfGoal,
  scriptObjectivesOf,
} from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  type MissionDefinition,
  type MissionGoalOp,
  type MissionScript,
  SUCCESSFUL_IF,
} from '../../../../../src/systems/missions/index.js';

const SEAT = 0;
const RIVAL = 3;
const POINT = { hx: 50, hy: 60 };
const RANGE = 5;
const DIAMOND = 50;
const HALL = 12;
const SWORDSMAN = 31;

function mission(over: Partial<MissionDefinition>): MissionDefinition {
  return { successfullIf: SUCCESSFUL_IF.all, active: false, visible: false, goals: [], results: [], ...over };
}

function objectivesOf(missions: readonly MissionDefinition[], seat = SEAT) {
  const script: MissionScript = { missions };
  return scriptObjectivesOf(script, new MissionTiming(script), seat);
}

describe('goal classification', () => {
  const timing = new MissionTiming({
    missions: [mission({ active: true, goals: [{ opcode: 'TimeGone', seconds: 600 }] })],
  });
  const area = { point: POINT, range: RANGE };
  const cases: readonly [MissionGoalOp, Objective][] = [
    [
      { opcode: 'PlayerDied', player: RIVAL },
      { kind: 'defeatPlayers', players: [RIVAL] },
    ],
    [
      { opcode: 'NumberOfSoldiersNearPos', player: SEAT, point: POINT, range: RANGE, amount: 8 },
      { kind: 'holdArea', player: SEAT, area, minUnits: 8, reward: null },
    ],
    [
      { opcode: 'FindPosByPlayersMapMoveable', player: SEAT, point: POINT, range: RANGE },
      { kind: 'reachArea', player: SEAT, area },
    ],
    [
      { opcode: 'NumberOfGoodsInArea', player: SEAT, good: DIAMOND, amount: 10, point: POINT, range: RANGE },
      { kind: 'deliverGoods', player: SEAT, good: DIAMOND, amount: 10, area },
    ],
    [
      {
        opcode: 'NumberOfHousesInArea',
        player: SEAT,
        houseType: HALL,
        amount: 2,
        point: POINT,
        range: RANGE,
      },
      { kind: 'buildHouses', player: SEAT, houseType: HALL, amount: 2, area },
    ],
    [
      { opcode: 'TimeGone', seconds: 600 },
      { kind: 'surviveUntil', seconds: 600, tick: 600 * TICKS_PER_SECOND },
    ],
    [
      { opcode: 'NumberOfSoldiers', player: SEAT, amount: 20 },
      { kind: 'growPopulation', player: SEAT, amount: 20, soldiers: true },
    ],
    [
      { opcode: 'BuildHumans', player: SEAT, job: SWORDSMAN, amount: 5, humanId: 0 },
      { kind: 'trainUnits', player: SEAT, job: SWORDSMAN, amount: 5 },
    ],
    [
      { opcode: 'HousesDied', objectId: 7 },
      { kind: 'destroyObjects', family: 'houses', objectId: 7 },
    ],
    [
      { opcode: 'ChestNearPos', point: POINT, range: RANGE },
      { kind: 'unknown', opcode: 'ChestNearPos' },
    ],
  ];
  it.each(cases)('classifies %j', (goal, objective) => {
    expect(objectiveOfGoal(goal, timing, 0)).toEqual(objective);
  });
});

describe('script objectives of a seat', () => {
  it('walks back from the verdict through activation and mission probes', () => {
    const found = objectivesOf([
      mission({
        active: true,
        goals: [{ opcode: 'BuildHouses', player: SEAT, houseType: HALL, amount: 1, objectId: 0 }],
      }),
      mission({
        active: true,
        goals: [{ opcode: 'IsMissionDone', missionIndex: 0 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 2 }],
      }),
      mission({
        goals: [{ opcode: 'PlayerDied', player: RIVAL }],
        results: [{ opcode: 'MissionWon', player: SEAT }],
      }),
    ]);
    expect(found).toEqual([
      { verdict: 'win', role: 'decides', mission: 2, objective: { kind: 'defeatPlayers', players: [RIVAL] } },
      {
        verdict: 'win',
        role: 'prerequisite',
        mission: 0,
        objective: { kind: 'buildHouses', player: SEAT, houseType: HALL, amount: 1, area: null },
      },
    ]);
  });

  it('joins the deaths an all-rule mission waits on into one defeat, and reads a failure as lose', () => {
    const found = objectivesOf([
      mission({
        active: true,
        goals: [
          { opcode: 'PlayerDied', player: 2 },
          { opcode: 'PlayerDied', player: 1 },
        ],
        results: [{ opcode: 'MissionFailed', player: SEAT }],
      }),
    ]);
    expect(found).toEqual([
      { verdict: 'lose', role: 'decides', mission: 0, objective: { kind: 'defeatPlayers', players: [1, 2] } },
    ]);
  });

  it('adds the goals of a mission that drops a deliver objective`s good into its area', () => {
    const found = objectivesOf([
      mission({
        active: true,
        goals: [
          { opcode: 'FindPosByPlayersMapMoveable', player: SEAT, point: { hx: 180, hy: 180 }, range: 13 },
        ],
        results: [
          {
            opcode: 'AddGoodsToMapArea',
            good: DIAMOND,
            amount: 1,
            point: POINT,
            range: RANGE,
            flag: false,
            player: SEAT,
          },
        ],
      }),
      mission({
        active: true,
        goals: [
          {
            opcode: 'NumberOfGoodsInArea',
            player: SEAT,
            good: DIAMOND,
            amount: 10,
            point: POINT,
            range: RANGE,
          },
        ],
        results: [{ opcode: 'MissionWon', player: SEAT }],
      }),
    ]);
    expect(found.map((o) => [o.role, o.objective.kind])).toEqual([
      ['decides', 'deliverGoods'],
      ['supply', 'reachArea'],
    ]);
  });

  it('reads a presence check on a repeating timer that pays a deliver objective as holding the area', () => {
    const centre = { hx: 180, hy: 180 };
    const everySeconds = 300;
    const grant = {
      opcode: 'AddGoodsToMapArea',
      good: DIAMOND,
      amount: 1,
      point: POINT,
      range: RANGE,
      flag: false,
      player: SEAT,
    } as const;
    const found = objectivesOf([
      // The timer re-arms itself through mission 2, sampling presence at mission 1 each time.
      mission({
        active: true,
        goals: [{ opcode: 'TimeGone', seconds: everySeconds }],
        results: [
          { opcode: 'ActivateMission', missionIndex: 1 },
          { opcode: 'ActivateMission', missionIndex: 2 },
        ],
      }),
      mission({
        goals: [{ opcode: 'FindPosByPlayersMapMoveable', player: SEAT, point: centre, range: 13 }],
        results: [grant],
      }),
      mission({ goals: [{ opcode: 'True' }], results: [{ opcode: 'ActivateMission', missionIndex: 0 }] }),
      mission({
        active: true,
        goals: [
          {
            opcode: 'NumberOfGoodsInArea',
            player: SEAT,
            good: DIAMOND,
            amount: 10,
            point: POINT,
            range: RANGE,
          },
        ],
        results: [{ opcode: 'MissionWon', player: SEAT }],
      }),
    ]);
    expect(found.find((o) => o.role === 'supply')).toEqual({
      verdict: 'win',
      role: 'supply',
      mission: 1,
      objective: {
        kind: 'holdArea',
        player: SEAT,
        area: { point: centre, range: 13 },
        minUnits: 1,
        reward: { everyTicks: everySeconds * TICKS_PER_SECOND, checks: 10, feeds: 3 },
      },
    });
  });

  it('gives a seat no verdict names no objective', () => {
    expect(objectivesOf([mission({ active: true, results: [{ opcode: 'MissionWon', player: 1 }] })])).toEqual(
      [],
    );
  });
});
