import { describe, expect, it } from 'vitest';
import { Vehicle } from '../../../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import {
  colonyBuildingsOn,
  colonyHeldShips,
  homeBuildings,
} from '../../../../src/systems/ai-shared/home-roster.js';
import {
  mayLookFurther,
  type NextColonyRead,
} from '../../../../src/systems/computer-player/colony/expansion.js';
import { LATE_GAME_FROM_TICKS, minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { colonyContent, colonyState, stepUntil, threeIslands } from '../../../fixtures/colony-islands.js';
import { twoColonies } from '../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const SETTLERS_FOR_TWO = 200;
const AT_HOME = 80;
const SECOND_LINE_TICKS = minutesToTicks(60);
const AFTER_SAVE_TICKS = minutesToTicks(4);

/** A seat that passes every look past its first colony. */
const ready: NextColonyRead = {
  tick: LATE_GAME_FROM_TICKS,
  retryAt: 0,
  colonies: 1,
  settlers: SETTLERS_FOR_TWO,
  fighters: AT_HOME,
  civilians: AT_HOME,
  settled: true,
  fed: true,
  delivered: LATE_GAME_FROM_TICKS - minutesToTicks(5),
  freeShips: 2,
};

describe('a seat looking past its colonies', () => {
  it('looks once the colony runs, feeds itself and delivers, and home holds people, ships and fighters', () => {
    expect(mayLookFurther(ready)).toBe(true);
  });

  it.each<[string, Partial<NextColonyRead>]>([
    ['before the late game', { tick: LATE_GAME_FROM_TICKS - 1, delivered: 0 }],
    ['while a failed voyage holds it', { retryAt: LATE_GAME_FROM_TICKS + 1 }],
    ['past the colonies its people carry', { settlers: SETTLERS_FOR_TWO - 1 }],
    ['with a colony lost among them at that cap', { colonies: 2 }],
    ['with fewer fighters at home than civilians', { fighters: AT_HOME - 1 }],
    ['with a voyage under way', { settled: false }],
    ['with its newest colony hungry', { fed: false }],
    ['with nothing unloaded yet', { delivered: null }],
    ['with its last unloading long past', { delivered: 0 }],
    ['with one ship free', { freeShips: 1 }],
  ])('stays as it is %s', (_rule, change) => {
    expect(mayLookFurther({ ...ready, ...change })).toBe(false);
  });
});

describe('a seat of two colonies on three islands', () => {
  it('runs each on its own land with its own route, and comes back from a save', () => {
    const sim = twoColonies();
    const running = stepUntil(sim, SECOND_LINE_TICKS, () => colonyState(sim, 1)?.phase === 'running');
    expect(running).toBe(true);
    const near = colonyState(sim);
    const far = colonyState(sim, 1);
    const nearShip = near?.route?.ship ?? null;
    const farShip = far?.route?.ship ?? null;
    if (near === undefined || far === undefined || nearShip === null || farShip === null)
      throw new Error('a route is missing');
    expect(far.land).not.toBe(near.land);
    expect(farShip).not.toBe(nearShip);
    expect(colonyHeldShips(sim.world, SEAT)).toEqual(expect.arrayContaining([nearShip, farShip]));
    const ctx = ctxOf(sim);
    const nearBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, near.land);
    const farBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, far.land);
    expect(nearBuildings.length).toBeGreaterThan(0);
    expect(farBuildings.length).toBeGreaterThan(0);
    const home = homeBuildings(sim.world, ctx, SEAT);
    expect([...nearBuildings, ...farBuildings].filter((e) => home.includes(e))).toEqual([]);

    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: colonyContent(), map: threeIslands() });
    expect(copy.hashState()).toBe(sim.hashState());
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(colonyState(copy, 1)?.land).toBe(far.land);
    expect(copy.world.has(farShip, Vehicle)).toBe(true);
    expect(copy.hashState()).toBe(sim.hashState());
  });
});
