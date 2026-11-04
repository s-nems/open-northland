import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  StorePriority,
  TradeRoute,
  Vehicle,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
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
import { stopPullOrders } from '../../../../src/systems/computer-player/colony/stop-pull.js';
import { surveyColonySite } from '../../../../src/systems/computer-player/colony/survey.js';
import { openColony } from '../../../../src/systems/computer-player/colony/voyage.js';
import { LATE_GAME_FROM_TICKS, minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import {
  colonyContent,
  colonyState,
  colonyWorld,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
  threeIslands,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { MUD, SEAT } from '../support.js';

const SETTLERS_FOR_TWO = 200;
const AT_HOME = 80;
const FIRST_LANDS_TICKS = minutesToTicks(40);
const SECOND_LINE_TICKS = minutesToTicks(60);
const AFTER_SAVE_TICKS = minutesToTicks(4);
const SEED = 7;
const SECOND_SHIP_AT = { x: 90, y: 100 };
const THIRD_SHIP_AT = { x: 90, y: 30 };
const FOURTH_SHIP_AT = { x: 90, y: 80 };
const MUD_ID = 'mud';
/** More mud than a colony could hold by then. */
const MUD_LACKED = 1000;

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

/** A seat with a route running on the east island, and the far island's colony on its way. */
function twoColonies() {
  const sim = colonyWorld(SEED, colonyContent(), [], true);
  stepUntil(sim, FIRST_LANDS_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, FIRST_LANDS_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, FIRST_LANDS_TICKS, () => (colonyState(sim)?.route?.ship ?? null) !== null))
    throw new Error('setup: no first route');
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or carrier');
  const first = colonyState(sim)?.land;
  const site = surveyColonySite(sim.world, ctx, SEAT, [], (next) => next.land !== first);
  if (site === null) throw new Error('setup: no second site');
  openColony({ world: sim.world, ctx, terrain, seat: SEAT, carrier }, site);
  mooredShip(sim, SMALL_SHIP, THIRD_SHIP_AT);
  if (!stepUntil(sim, SECOND_LINE_TICKS, () => colonyState(sim, 1)?.phase === 'fittingOut'))
    throw new Error('setup: the second colony did not scout');
  mooredShip(sim, SMALL_SHIP, FOURTH_SHIP_AT);
  return sim;
}

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

/** Each colony's trader once its route stands with marks at the colony's stop. */
function routeTraders(sim: Simulation): Entity[] {
  const state = sim.world.get(aiControlEntity(sim.world, SEAT) as Entity, ComputerColony);
  return state.colonies.flatMap((colony) => {
    const trader = colony.route?.trader ?? null;
    const route = trader === null ? undefined : sim.world.tryGet(trader, TradeRoute);
    return trader !== null && (route?.stops[1]?.imports.length ?? 0) > 0 ? [trader] : [];
  });
}

/** Fill the colony's stop of `trader` up to `upTo` units of mud. */
function markMud(sim: Simulation, trader: Entity, upTo: number): void {
  const stop = sim.world.mut(trader, TradeRoute).stops[1];
  if (stop === undefined) throw new Error('setup: no colony stop');
  stop.imports = [...stop.imports.filter((m) => m.good !== MUD), { good: MUD, upTo, keep: 0 }];
}

describe("a seat's home stop store", () => {
  it('pulls a good while any colony routed through it lacks it, and lets go once no live route does', () => {
    const sim = twoColonies();
    expect(stepUntil(sim, SECOND_LINE_TICKS, () => routeTraders(sim).length === 2)).toBe(true);
    const [short, full] = routeTraders(sim);
    if (short === undefined || full === undefined) throw new Error('setup: two routes');
    const store = sim.world.get(short, TradeRoute).stops[0]?.house;
    expect(sim.world.get(full, TradeRoute).stops[0]?.house).toBe(store);
    if (store === undefined) throw new Error('setup: no home stop');
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no seat');
    const pull = () => stopPullOrders({ world: sim.world, ctx, terrain, seat: SEAT, carrier }, [MUD_ID]);
    const order = (priority: boolean) => [
      { kind: 'setStorePriority', building: store, goodType: MUD, priority },
    ];
    markMud(sim, short, MUD_LACKED);
    markMud(sim, full, 0);
    expect(pull()).toEqual(order(true));
    sim.world.add(store, StorePriority, { goods: [MUD] });
    expect(pull()).toEqual([]);
    markMud(sim, short, 0);
    expect(pull()).toEqual(order(false));
    markMud(sim, short, MUD_LACKED);
    sim.world.destroy(short);
    expect(pull()).toEqual(order(false));
  });
});
