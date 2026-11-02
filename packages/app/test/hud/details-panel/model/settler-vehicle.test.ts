import { components, type Entity, entityById, type Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { vehicleRow } from '../../../../src/hud/details-panel/model/settler-vehicle.js';
import { sceneTrader } from '../../../../src/scenes/economy/trade.js';
import { tradeSeaScene, tradeSeaShip } from '../../../../src/scenes/economy/trade-sea.js';
import { createSceneSim } from '../../../../src/scenes/runtime.js';
import { ctxOf } from '../../../support/sandbox.js';

const { HaulingCart, Rider } = components;

/** Ticks past the voyage's start on seed 45. */
const LATEST_BOARDING_TICK = 1500;

function runUntilAboard(sim: Simulation, trader: Entity): void {
  for (let tick = 0; tick < LATEST_BOARDING_TICK; tick++) {
    if (sim.world.has(trader, Rider)) return;
    sim.step();
  }
  throw new Error('expected the trader aboard its ship');
}

it('keeps showing the cart in the Vehicle row while the trader sails its pinned ship', () => {
  const sim = createSceneSim(tradeSeaScene);
  sim.run(1);
  const trader = sceneTrader(sim);
  if (trader === undefined) throw new Error('expected the scene trader');
  runUntilAboard(sim, trader);

  const ent = entityById(sim.snapshot(), trader);
  if (ent === undefined) throw new Error('expected the trader in the snapshot');
  expect(sim.world.get(trader, Rider).vehicle).toBe(tradeSeaShip(sim));
  const row = vehicleRow(ctxOf(sim), sim.snapshot(), ent, 'worker', true);
  expect(row?.target?.id).toBe(sim.world.get(trader, HaulingCart).vehicle);
});
