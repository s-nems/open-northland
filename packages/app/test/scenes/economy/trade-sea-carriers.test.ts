import { expect, it } from 'vitest';
import {
  buildTradeSeaCarriers,
  farWood,
  TRADER_ALONE_WOOD,
  tradeSeaCarriersScene,
} from '../../../src/scenes/economy/trade-sea-carriers.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { sceneAcceptance } from '../scene-case.js';

sceneAcceptance(tradeSeaCarriersScene, import.meta.url);

it('measures the check against the same world with no carriers', () => {
  const sim = createSceneSim({ ...tradeSeaCarriersScene, build: (world) => buildTradeSeaCarriers(world, 0) });
  sim.run(tradeSeaCarriersScene.runTicks);
  expect(farWood(sim)).toBe(TRADER_ALONE_WOOD);
});
