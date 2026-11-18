import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  FarmAnimal,
  Livestock,
  type MatchGoal,
  Owner,
  Person,
  Position,
  raiseMissionGoal,
  Settler,
  Signpost,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type SimEvent,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import { MATCH_GOAL_CHECK_TICKS, matchSystem } from '../../../src/systems/match/index.js';
import { createSignpost } from '../../../src/systems/signposts/placement.js';
import { createVehicle } from '../../../src/systems/vehicles/create.js';
import { combatContent } from '../../fixtures/content/combat.js';
import { economyContent } from '../../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../../fixtures/content/index.js';
import { societyContent } from '../../fixtures/content/societies.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import { HEADQUARTERS, POINT, VIKING } from '../missions/support.js';

const WOOD = 1;
const FIRST_CHECK = MATCH_GOAL_CHECK_TICKS;
const SECOND_CHECK = 2 * MATCH_GOAL_CHECK_TICKS;
const THIRD_CHECK = 3 * MATCH_GOAL_CHECK_TICKS;
const LOSER = 1;
const RIVAL = 0;
const OTHER = 2;
/** The fixture's catchable species, a claimed one carrying `Livestock`. */
const COW = 13;
/** The teardown's chicken, declared here since no other fixture needs the species. */
const CHICKEN = 30;
const HANDCART = 1;
const MAP_CELLS = 16;
const WATER_COLUMN = 12;
const LAND = { hx: 6, hy: 6 };
const SEA = { hx: 2 * WATER_COLUMN, hy: 6 };

function aftermathContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
    tribes: [...societyContent.tribes, { typeId: CHICKEN, id: 'chicken' }],
    animals: [...societyContent.animals, { id: 'chicken', tribeType: CHICKEN, hitpointsAdult: 50 }],
  });
}

function matchSim(goals: readonly MatchGoal[]): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: aftermathContent(),
    map: waterColumnMap(MAP_CELLS, MAP_CELLS, WATER_COLUMN),
  });
  sim.enqueueSetup({ kind: 'setMatchParticipants', players: [RIVAL, LOSER, OTHER], victory: 'goals', goals });
  sim.step();
  return sim;
}

function roundTrip(sim: Simulation): Simulation {
  const bytes = serializeSaveGame(exportSaveGame(sim));
  const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
    content: sim.content,
    map: waterColumnMap(MAP_CELLS, MAP_CELLS, WATER_COLUMN),
  });
  expect(restored.hashState()).toBe(sim.hashState());
  return restored;
}

function check(sim: Simulation, tick: number): readonly SimEvent[] {
  const before = sim.events.current().length;
  matchSystem(sim.world, { ...ctxOf(sim), tick });
  return sim.events.current().slice(before);
}

function man(sim: Simulation, player: number, at: { hx: number; hy: number } = LAND): Entity {
  const e = settlerAt(sim, { jobType: null, position: positionOfNode(at.hx, at.hy) });
  sim.world.add(e, Owner, { player });
  return e;
}

function ownedBy(
  sim: Simulation,
  player: number,
  component: typeof Person | typeof Building | typeof Signpost | typeof Livestock,
): Entity[] {
  return [...sim.world.query(component, Owner)].filter((e) => sim.world.get(e, Owner).player === player);
}

/** Where the chickens stand, ascending by entity. */
function chickens(sim: Simulation): { hx: number; hy: number }[] {
  return [...sim.world.query(Settler, Position)]
    .filter((e) => sim.world.get(e, Settler).tribe === CHICKEN)
    .map((e) => {
      const at = sim.world.get(e, Position);
      return nodeOfPosition(at.x, at.y);
    });
}

describe('multiplayer goal aftermath', () => {
  it('takes a loser off the map on the check after its verdict, leaving chickens on land and wild animals', () => {
    const sim = matchSim([{ kind: 'lostByMission' }]);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HEADQUARTERS,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      force: true,
      owner: LOSER,
    });
    sim.step();
    const house = ownedBy(sim, LOSER, Building)[0];
    if (house === undefined) throw new Error('house missing');
    man(sim, LOSER, LAND);
    man(sim, LOSER, SEA);
    const rivalMan = man(sim, RIVAL, { hx: 8, hy: 8 });
    const cow = settlerAt(sim, { jobType: null, tribe: COW, position: positionOfNode(10, 10) });
    sim.world.add(cow, Livestock, {});
    sim.world.add(cow, Owner, { player: LOSER });
    sim.world.add(cow, FarmAnimal, { farm: house, summoner: null });
    createSignpost(sim.world, terrain, terrain.nodeAt(4, 10), LOSER, sim.content);
    const cart = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: HANDCART,
      x: 12,
      y: 4,
      tribe: VIKING,
      owner: LOSER,
    });
    if (cart === null) throw new Error('cart missing');

    raiseMissionGoal(sim.world, LOSER, 'lost');
    expect(check(sim, FIRST_CHECK).map((event) => event.kind)).toEqual(['playerDefeated']);
    // The verdict's own check leaves the loser's world standing.
    expect(ownedBy(sim, LOSER, Person)).toHaveLength(2);
    expect(sim.world.isAlive(house)).toBe(true);

    const events = check(sim, SECOND_CHECK);
    expect(ownedBy(sim, LOSER, Person)).toEqual([]);
    expect(ownedBy(sim, LOSER, Building)).toEqual([]);
    expect(ownedBy(sim, LOSER, Signpost)).toEqual([]);
    expect(ownedBy(sim, LOSER, Livestock)).toEqual([]);
    expect(sim.world.isAlive(cow)).toBe(true);
    expect(sim.world.has(cow, FarmAnimal)).toBe(false);
    expect(sim.world.isAlive(cart)).toBe(false);
    const wrecks = events.filter((event) => event.kind === 'vehicleDestroyed');
    expect(wrecks.map((event) => event.cause)).toEqual(['script']);
    const deaths = events.filter(
      (event) => event.kind === 'settlerDied' || event.kind === 'buildingDestroyed',
    );
    expect(deaths).toEqual([]);
    // One chicken where the human stood on land, none for the one at sea.
    expect(chickens(sim)).toEqual([LAND]);
    expect(sim.world.isAlive(rivalMan)).toBe(true);
    // A torn-down seat is never torn down again.
    expect(check(sim, THIRD_CHECK)).toEqual([]);
    expect(chickens(sim)).toEqual([LAND]);
  });

  it('ranks the winners first, then the losers from the last to lose, across a save', () => {
    const sim = matchSim([{ kind: 'lostByMission' }, { kind: 'wonByMission' }]);
    raiseMissionGoal(sim.world, LOSER, 'lost');
    check(sim, FIRST_CHECK);
    raiseMissionGoal(sim.world, RIVAL, 'won');
    raiseMissionGoal(sim.world, OTHER, 'lost');
    check(sim, SECOND_CHECK);
    expect(sim.matchRanking()).toEqual([
      { player: RIVAL, outcome: 'victory' },
      { player: OTHER, outcome: 'defeat' },
      { player: LOSER, outcome: 'defeat' },
    ]);
    expect(roundTrip(sim).matchRanking()).toEqual(sim.matchRanking());
  });

  it('reports goods and inhabitants progress as of the latest check', () => {
    const sim = matchSim([
      { kind: 'goods', goods: [{ good: WOOD, amount: 50 }] },
      { kind: 'inhabitants', count: 3, soldiers: false },
    ]);
    man(sim, RIVAL);
    // Before any check, a first read counts once.
    expect(sim.matchGoalProgress(RIVAL)).toEqual([
      { kind: 'goods', good: WOOD, have: 0, need: 50 },
      { kind: 'inhabitants', soldiers: false, have: 1, need: 3 },
    ]);
    man(sim, RIVAL);
    expect(sim.matchGoalProgress(RIVAL)[1]?.have).toBe(1);
    check(sim, FIRST_CHECK);
    expect(sim.matchGoalProgress(RIVAL)[1]?.have).toBe(2);
    expect(sim.matchGoalProgress(LOSER)[1]?.have).toBe(0);
    man(sim, RIVAL);
    check(sim, SECOND_CHECK);
    expect(sim.matchOutcome(RIVAL)).toBe('victory');
    expect(sim.matchGoalProgress(RIVAL)).toEqual([]);
    expect(sim.matchGoalProgress(LOSER)).toHaveLength(2);
  });
});
