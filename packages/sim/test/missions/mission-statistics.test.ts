import { describe, expect, it } from 'vitest';
import { playerTally } from '../../src/components/index.js';
import { missionObjects, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { ctxOf } from '../fixtures/context.js';
import {
  CARPENTER,
  FIRST_PASS,
  goalSim,
  HEADQUARTERS,
  HUT,
  holds,
  houseContent,
  kill,
  missionSim,
  POINT,
  SOLDIER,
  spawn,
  stamped,
  VIKING,
  WOLF,
  WOODCUTTER,
} from './support.js';

/**
 * The per-player war tallies and the goals that read them, beside the goals that count what a player
 * has standing. A script removal is deliberately invisible to every tally here.
 */

/** The id a counting goal is told to leave alone. */
const UNTAGGED = 12345;

const NO_TALLY = { humansDied: 0, soldiersDied: 0, humansKilled: 0 };

describe('the death tallies', () => {
  it('counts a human against its owner, and a soldier under both counters', () => {
    const sim = goalSim({ opcode: 'True' });
    spawn(sim, { player: 2, missionId: 1 });
    spawn(sim, { player: 2, job: SOLDIER, missionId: 2 });
    sim.run(2);
    kill(sim, stamped(sim, 1));
    expect(playerTally(sim.world, 2)).toEqual({ ...NO_TALLY, humansDied: 1 });
    kill(sim, stamped(sim, 2));
    expect(playerTally(sim.world, 2)).toEqual({ ...NO_TALLY, humansDied: 2, soldiersDied: 1 });
  });

  it('counts nothing for a script removal', () => {
    const sim = missionSim([
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [],
        results: [{ opcode: 'RemoveHumans', humanId: 1 }],
      },
    ]);
    spawn(sim, { player: 2, missionId: 1 });
    sim.run(FIRST_PASS);
    expect(missionObjects(sim.world, 1)).toHaveLength(0);
    expect(playerTally(sim.world, 2)).toEqual(NO_TALLY);
  });

  it('credits a kill to the attacker`s owner and the death to the victim`s', () => {
    const sim = goalSim({ opcode: 'True' });
    spawn(sim, { player: 2, missionId: 1 });
    spawn(sim, { player: 3, missionId: 2, at: { hx: POINT.hx + 1, hy: POINT.hy } });
    sim.run(2);
    resolveCombatHit(
      sim.world,
      ctxOf(sim),
      stamped(sim, 2),
      stamped(sim, 1),
      { damage: 100000 },
      [],
      'melee',
    );
    expect(playerTally(sim.world, 3).humansKilled).toBe(1);
    expect(playerTally(sim.world, 2).humansKilled).toBe(0);
    sim.step();
    expect(playerTally(sim.world, 2).humansDied).toBe(1);
  });

  it('credits nothing for a felled animal', () => {
    const sim = goalSim({ opcode: 'True' });
    spawn(sim, { player: 2, missionId: 1 });
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: WOLF,
      x: POINT.hx + 2,
      y: POINT.hy,
      count: 1,
      missionId: 5,
    });
    sim.run(2);
    resolveCombatHit(
      sim.world,
      ctxOf(sim),
      stamped(sim, 1),
      stamped(sim, 5),
      { damage: 100000 },
      [],
      'melee',
    );
    sim.step();
    expect(playerTally(sim.world, 2)).toEqual(NO_TALLY);
  });
});

describe('the goals that read a tally', () => {
  it('holds once the player has lost the number of humans the goal names', () => {
    const sim = goalSim({ opcode: 'NumberOfHumansDied', player: 2, amount: 2 });
    spawn(sim, { player: 2, missionId: 1 });
    spawn(sim, { player: 2, missionId: 2 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    kill(sim, stamped(sim, 1));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false); // one short
    kill(sim, stamped(sim, 2));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('counts soldiers apart from the rest of the fallen', () => {
    const sim = goalSim({ opcode: 'SoldiersDied', player: 2, amount: 1 });
    spawn(sim, { player: 2, missionId: 1 });
    spawn(sim, { player: 2, job: SOLDIER, missionId: 2 });
    sim.run(2);
    kill(sim, stamped(sim, 1));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false); // a civilian death is not a soldier's
    kill(sim, stamped(sim, 2));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('holds once the player has killed the number the goal names', () => {
    const sim = goalSim({ opcode: 'NumberOfHumansKilled', player: 3, amount: 1 });
    spawn(sim, { player: 2, missionId: 1 });
    spawn(sim, { player: 3, missionId: 2, at: { hx: POINT.hx + 1, hy: POINT.hy } });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    resolveCombatHit(
      sim.world,
      ctxOf(sim),
      stamped(sim, 2),
      stamped(sim, 1),
      { damage: 100000 },
      [],
      'melee',
    );
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });
});

describe('the goals that count what is standing', () => {
  it('holds while the id names living humans and turns once they are gone', () => {
    const sim = goalSim({ opcode: 'HumansDied', humanId: 1 });
    spawn(sim, { player: 2, missionId: 1 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    kill(sim, stamped(sim, 1));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('tells a house from an animal carrying the same id', () => {
    const sim = goalSim({ opcode: 'AnimalsDied', objectId: 5 });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 2,
      missionId: 5,
    });
    sim.run(FIRST_PASS);
    // The id names a house only, so no animal carries it and the goal already holds.
    expect(holds(sim)).toBe(true);
  });

  it('counts a player`s whole population', () => {
    const sim = goalSim({ opcode: 'Population', player: 2, amount: 2 });
    spawn(sim, { player: 2 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    spawn(sim, { player: 2 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('needs one match even for an amount of zero', () => {
    const empty = goalSim({ opcode: 'Population', player: 2, amount: 0 });
    empty.run(FIRST_PASS);
    expect(holds(empty)).toBe(false);
    const one = goalSim({ opcode: 'Population', player: 2, amount: 0 });
    spawn(one, { player: 2 });
    one.run(FIRST_PASS);
    expect(holds(one)).toBe(true);
    const soldiers = goalSim({ opcode: 'NumberOfSoldiers', player: 2, amount: 0 });
    spawn(soldiers, { player: 2 });
    soldiers.run(FIRST_PASS);
    expect(holds(soldiers)).toBe(false);
  });

  it('counts only the soldiers for NumberOfSoldiers', () => {
    const sim = goalSim({ opcode: 'NumberOfSoldiers', player: 2, amount: 1 });
    spawn(sim, { player: 2 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    spawn(sim, { player: 2, job: SOLDIER });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('reads the job of the humans an id names', () => {
    const sim = goalSim({ opcode: 'CheckHumanJob', humanId: 1, job: SOLDIER });
    spawn(sim, { player: 2, missionId: 1 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    spawn(sim, { player: 2, job: SOLDIER, missionId: 1 });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('counts the adults living in a finished home', () => {
    const sim = goalSim({ opcode: 'HumansWithHome', player: 2, amount: 1 }, houseContent());
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 2,
    });
    // A job id outside the age classes: the fixture reuses ids 1..4 for adult trades.
    spawn(sim, { player: 2, job: SOLDIER, at: { hx: POINT.hx + 3, hy: POINT.hy } });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    spawn(sim, {
      player: 2,
      job: SOLDIER,
      at: { hx: POINT.hx + 4, hy: POINT.hy },
      home: { x: POINT.hx, y: POINT.hy },
    });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('counts the humans posted to a workplace', () => {
    const sim = goalSim({ opcode: 'HumanAttachedToWorkHouse', player: 2, job: WOODCUTTER, amount: 1 });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 2,
    });
    spawn(sim, { player: 2, at: { hx: POINT.hx + 2, hy: POINT.hy } });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    spawn(sim, {
      player: 2,
      at: { hx: POINT.hx + 3, hy: POINT.hy },
      workplace: { x: POINT.hx, y: POINT.hy },
    });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });
});

describe('the counting goals that tag what they counted', () => {
  it('stamps the goal`s id on every human it counted', () => {
    const sim = goalSim({ opcode: 'BuildHumans', player: 2, job: CARPENTER, amount: 2, humanId: 42 });
    spawn(sim, { player: 2, job: CARPENTER });
    spawn(sim, { player: 2, job: CARPENTER });
    spawn(sim, { player: 2, job: WOODCUTTER });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
    expect(missionObjects(sim.world, 42)).toHaveLength(2);
  });

  it('leaves them unstamped when the goal names the untagged id', () => {
    const sim = goalSim({ opcode: 'BuildHumans', player: 2, job: CARPENTER, amount: 1, humanId: UNTAGGED });
    spawn(sim, { player: 2, job: CARPENTER });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
    expect(missionObjects(sim.world, UNTAGGED)).toHaveLength(0);
  });

  it('clears the ids they carried when the goal names id 0', () => {
    const sim = goalSim({ opcode: 'BuildHumans', player: 2, job: CARPENTER, amount: 1, humanId: 0 });
    spawn(sim, { player: 2, job: CARPENTER, missionId: 7 });
    sim.run(1);
    expect(missionObjects(sim.world, 7)).toHaveLength(1);
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
    expect(missionObjects(sim.world, 7)).toHaveLength(0);
  });

  it('counts and stamps the player`s houses of the type', () => {
    const sim = goalSim({
      opcode: 'BuildHouses',
      player: 2,
      houseType: HEADQUARTERS,
      amount: 1,
      objectId: 43,
    });
    // Another player's house of the same type is not this player's.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: 3,
    });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      tribe: VIKING,
      x: POINT.hx + 4,
      y: POINT.hy,
      owner: 2,
    });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
    expect(missionObjects(sim.world, 43)).toHaveLength(1);
  });
});
