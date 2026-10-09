import { components, playerCommand, RUIN_COLLAPSE_TICKS } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildingDemolitionScene, demolitionOrders } from '../../src/scenes/building-demolition.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(buildingDemolitionScene, import.meta.url);

it('the preview action demolishes every example through the normal player command', () => {
  const sim = createSceneSim(buildingDemolitionScene);
  sim.run(2);
  for (const order of demolitionOrders(sim.snapshot())) {
    if (order.by === 'viewer') sim.enqueue(playerCommand(0, order.command));
  }
  sim.run(RUIN_COLLAPSE_TICKS + 2);
  expect([...sim.world.query(components.Building)]).toHaveLength(0);
});
