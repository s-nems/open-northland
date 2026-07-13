import type { UnitPanelModelContext } from '../../src/hud/details-panel/index.js';
import { createSceneSim } from '../../src/scenes/index.js';
import { sandboxScene } from '../../src/scenes/sandbox.js';

/**
 * The details-panel model context `{ buildings, goods, jobs }` pulled from a fresh `sandbox` scene sim —
 * the content half every `buildUnitPanelModel` assertion runs against. A fresh sim per call keeps each
 * test isolated (the scene build resets the shared component stores; see {@link createSceneSim}).
 */
export function sandboxCtx(): UnitPanelModelContext {
  const sim = createSceneSim(sandboxScene);
  return {
    buildings: sim.content.buildings,
    goods: sim.content.goods,
    jobs: sim.content.jobs,
  };
}
