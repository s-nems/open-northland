import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  prioritizesGood,
  Settler,
  StorePriority,
  TradeRoute,
  TradeShip,
  Vehicle,
} from '../../../../src/components/index.js';
import {
  everyBuildingOf,
  everySettlerOf,
  homeBuildings,
  homeSettlers,
} from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { isTraderJob } from '../../../../src/systems/readviews/index.js';
import { colonyContent, colonyState, stepUntil } from '../../../fixtures/colony-islands.js';
import { routedWorld, standingTrader } from '../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const AFTER_SAVE_TICKS = minutesToTicks(3);
/** A building material home's stop store pulls for a colony, its content id the one the pull reads. */
const BRICK = 47;

describe('a colony toggle turned off', () => {
  it('lets its routes go, lifts the stop pulls and hands the colony back to the whole seat', () => {
    const base = colonyContent();
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: BRICK, id: 'brick', weight: 1 }],
    });
    const { sim, ship } = routedWorld(content);
    const trader = standingTrader(sim);
    const homeStop = sim.world.get(trader, TradeRoute).stops[0]?.house;
    if (homeStop === undefined) throw new Error('setup: no home stop');
    sim.world.add(homeStop, StorePriority, { goods: [BRICK] });
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT).length).toBeLessThan(
      everySettlerOf(sim.world, SEAT).length,
    );
    const modules = { ...sim.world.get(carrier, AiControl).modules, houseBuild: false };
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules });
    sim.step();
    expect(colonyState(sim)).toBeUndefined();
    expect(sim.world.tryGet(trader, TradeShip)).toBeUndefined();
    expect(isTraderJob(sim.content, sim.world.get(trader, Settler).jobType)).toBe(false);
    expect(prioritizesGood(sim.world, homeStop, BRICK)).toBe(false);
    expect(sim.world.get(ship, Vehicle).hauler).not.toBe(trader);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toEqual(everySettlerOf(sim.world, SEAT));
    expect(homeBuildings(sim.world, ctxOf(sim), SEAT)).toEqual(everyBuildingOf(sim.world, SEAT));
    stepUntil(sim, AFTER_SAVE_TICKS, () => false);
    expect(colonyState(sim)).toBeUndefined();
  });

  it('leaves the routes standing for whoever takes the seat when the whole AI turns off', () => {
    const { sim, ship } = routedWorld();
    const trader = standingTrader(sim);
    sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: false });
    sim.step();
    expect(aiControlEntity(sim.world, SEAT)).toBeNull();
    expect(sim.world.tryGet(trader, TradeShip)?.vehicle).toBe(ship);
    expect(isTraderJob(sim.content, sim.world.get(trader, Settler).jobType)).toBe(true);
  });
});
