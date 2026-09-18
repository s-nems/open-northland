import { describe, expect, it } from 'vitest';
import { missionRecords, Person as PersonComponent, Position } from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import type { MissionGoalOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import {
  goalSim,
  HUT,
  HUT_LARGE,
  holds,
  houseContent,
  LOAD_PASS,
  missionSim,
  PASS_TICKS,
  POINT,
  SOLDIER,
  spawn,
  VIKING,
  WILD,
  WOLF,
  WOODCUTTER,
} from './support.js';

/**
 * The goals that measure map-point distance. Each pair is one world where the goal holds and one
 * where it does not, judged on the load pass, where every setup placement stands where its line put it.
 */

const OWNER = 2;
const HERE = 61;
const THERE = 62;
const AREA = 10;
const FAR = { hx: POINT.hx + 22, hy: POINT.hy };

function judged(sim: Simulation): boolean {
  sim.run(LOAD_PASS);
  return holds(sim);
}

function houseAt(
  sim: Simulation,
  buildingType: number,
  at: { hx: number; hy: number },
  owner = OWNER,
  asSite = false,
): void {
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    owner,
    force: true,
    underConstruction: asSite,
  });
}

describe('FindPosByHumans', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> = {
    opcode: 'FindPosByHumans',
    humanId: HERE,
    point: POINT,
    range: AREA,
  };

  it('holds while a human with the id is inside the area', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE });
    expect(judged(sim)).toBe(true);
  });

  it('does not hold for one standing outside it', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE, at: FAR });
    expect(judged(sim)).toBe(false);
  });

  it('does not hold for a human carrying no id', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER });
    expect(judged(sim)).toBe(false);
  });
});

describe('the goal flag a range test writes', () => {
  /** Never elapses, so the mission holding this goal stays active and keeps re-checking the one
   *  under test instead of firing once and going quiet. */
  const NEVER: MissionGoalOp = { opcode: 'TimeGone', seconds: 1_000_000 };

  it('is rewritten every pass, so leaving the area clears it again', () => {
    const sim = missionSim([
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [{ opcode: 'FindPosByHumans', humanId: HERE, point: POINT, range: AREA }, NEVER],
        results: [],
      },
    ]);
    spawn(sim, { player: OWNER, missionId: HERE });
    sim.run(LOAD_PASS);
    expect(missionRecords(sim.world)[0]?.goalsHeld[0]).toBe(true);

    // Set down outside rather than walked out: the goal reads where the unit stands, and a walk order
    // is the planner's to keep or drop.
    const [walker] = [...sim.world.query(PersonComponent)];
    if (walker === undefined) throw new Error('no settler');
    const out = positionOfNode(FAR.hx, FAR.hy);
    const at = sim.world.mut(walker, Position);
    at.x = out.x;
    at.y = out.y;
    sim.run(PASS_TICKS); // the next pass reads the new stand
    expect(missionRecords(sim.world)[0]?.goalsHeld[0]).toBe(false);
  });
});

describe('FindPosByPlayersMapMoveable', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'FindPosByPlayersMapMoveable' }> = {
    opcode: 'FindPosByPlayersMapMoveable',
    player: OWNER,
    point: POINT,
    range: AREA,
  };

  it('holds on any human of the player inside the area', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER });
    expect(judged(sim)).toBe(true);
  });

  it('ignores another player’s', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER + 1 });
    expect(judged(sim)).toBe(false);
  });
});

describe('FindHumansByHumans', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'FindHumansByHumans' }> = {
    opcode: 'FindHumansByHumans',
    humanId: HERE,
    otherHumanId: THERE,
    range: AREA,
  };

  it('holds once the two groups are within range of each other', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE });
    spawn(sim, { player: OWNER, missionId: THERE });
    expect(judged(sim)).toBe(true);
  });

  it('does not hold while they stand apart', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE });
    spawn(sim, { player: OWNER, missionId: THERE, at: FAR });
    expect(judged(sim)).toBe(false);
  });
});

describe('FindHumansByPlayersMM', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'FindHumansByPlayersMM' }> = {
    opcode: 'FindHumansByPlayersMM',
    humanId: HERE,
    player: OWNER + 1,
    range: AREA,
  };

  it('holds when the player’s human reaches the marked one', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE });
    spawn(sim, { player: OWNER + 1 });
    expect(judged(sim)).toBe(true);
  });

  it('does not hold with nobody of that player near', () => {
    const sim = goalSim(goal);
    spawn(sim, { player: OWNER, missionId: HERE });
    spawn(sim, { player: OWNER + 1, at: FAR });
    expect(judged(sim)).toBe(false);
  });
});

describe('FindHousesByHumans', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'FindHousesByHumans' }> = {
    opcode: 'FindHousesByHumans',
    humanId: HERE,
    objectId: THERE,
    range: AREA,
  };

  it('holds once a marked human stands by a marked house', () => {
    const sim = goalSim(goal, houseContent());
    spawn(sim, { player: OWNER, missionId: HERE });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT_LARGE,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: OWNER,
      missionId: THERE,
    });
    expect(judged(sim)).toBe(true);
  });

  it('does not hold with the house out of reach', () => {
    const sim = goalSim(goal, houseContent());
    spawn(sim, { player: OWNER, missionId: HERE });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT_LARGE,
      tribe: VIKING,
      x: FAR.hx,
      y: FAR.hy,
      owner: OWNER,
      missionId: THERE,
    });
    expect(judged(sim)).toBe(false);
  });
});

describe('the head-count goals near a point', () => {
  const soldiers: Extract<MissionGoalOp, { opcode: 'NumberOfSoldiersNearPos' }> = {
    opcode: 'NumberOfSoldiersNearPos',
    player: OWNER,
    point: POINT,
    range: AREA,
    amount: 2,
  };

  it('counts the player’s soldiers in the area', () => {
    const sim = goalSim(soldiers);
    spawn(sim, { player: OWNER, job: SOLDIER });
    spawn(sim, { player: OWNER, job: SOLDIER });
    expect(judged(sim)).toBe(true);
  });

  it('does not count a civilian toward them', () => {
    const sim = goalSim(soldiers);
    spawn(sim, { player: OWNER, job: SOLDIER });
    spawn(sim, { player: OWNER, job: WOODCUTTER });
    expect(judged(sim)).toBe(false);
  });

  it('counts civilians the other way round', () => {
    const sim = goalSim({
      opcode: 'NumberOfCivilainsNearPos',
      player: OWNER,
      point: POINT,
      range: AREA,
      amount: 1,
    });
    spawn(sim, { player: OWNER, job: WOODCUTTER });
    expect(judged(sim)).toBe(true);
  });

  it('leaves a soldier out of the civilian count', () => {
    const sim = goalSim({
      opcode: 'NumberOfCivilainsNearPos',
      player: OWNER,
      point: POINT,
      range: AREA,
      amount: 1,
    });
    spawn(sim, { player: OWNER, job: SOLDIER });
    expect(judged(sim)).toBe(false);
  });
});

describe('NumberOfHousesInArea', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'NumberOfHousesInArea' }> = {
    opcode: 'NumberOfHousesInArea',
    player: OWNER,
    houseType: HUT_LARGE,
    amount: 1,
    point: POINT,
    range: AREA,
  };

  it('counts a finished house of the type', () => {
    const sim = goalSim(goal, houseContent());
    houseAt(sim, HUT_LARGE, POINT);
    expect(judged(sim)).toBe(true);
  });

  it('ignores an unfinished one', () => {
    const sim = goalSim({ ...goal, houseType: HUT }, houseContent());
    houseAt(sim, HUT, POINT, OWNER, true);
    expect(judged(sim)).toBe(false);
  });

  it('ignores another player’s', () => {
    const sim = goalSim(goal, houseContent());
    houseAt(sim, HUT_LARGE, POINT, OWNER + 1);
    expect(judged(sim)).toBe(false);
  });
});

describe('NumberOfAnimalsInArea', () => {
  const goal: Extract<MissionGoalOp, { opcode: 'NumberOfAnimalsInArea' }> = {
    opcode: 'NumberOfAnimalsInArea',
    player: WILD,
    tribe: WOLF,
    amount: 2,
    point: POINT,
    range: AREA,
  };

  function herd(sim: Simulation, count: number, at = POINT, owner?: number): void {
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: WOLF,
      x: at.hx,
      y: at.hy,
      count,
      ...(owner === undefined ? {} : { owner }),
    });
  }

  it('counts the wild herd standing in the area', () => {
    const sim = goalSim(goal);
    herd(sim, 2);
    expect(judged(sim)).toBe(true);
  });

  it('does not count a herd somebody owns as wild', () => {
    const sim = goalSim(goal);
    herd(sim, 2, POINT, OWNER);
    expect(judged(sim)).toBe(false);
  });

  it('does not count a herd outside the area', () => {
    const sim = goalSim(goal);
    herd(sim, 2, FAR);
    expect(judged(sim)).toBe(false);
  });
});
