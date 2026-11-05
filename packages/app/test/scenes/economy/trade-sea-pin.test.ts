import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { sceneTrader } from '../../../src/scenes/economy/trade.js';
import { tradeSeaPinScene } from '../../../src/scenes/economy/trade-sea-pin.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { sceneAcceptance } from '../scene-case.js';

sceneAcceptance(tradeSeaPinScene, import.meta.url);

it('keeps the trader ashore on every tick while no ship is pinned', () => {
  const sim = createSceneSim(tradeSeaPinScene);
  sim.run(1);
  const trader = sceneTrader(sim);
  if (trader === undefined) throw new Error('expected the scene trader');
  for (let tick = 0; tick < tradeSeaPinScene.runTicks; tick++) {
    sim.step();
    expect(sim.world.has(trader, components.Rider)).toBe(false);
  }
});
