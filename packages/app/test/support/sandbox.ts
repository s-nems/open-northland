import type { Simulation } from '@open-northland/sim';
import type { UnitPanelModelContext } from '../../src/hud/details-panel/index.js';
import { createSceneSim } from '../../src/scenes/index.js';
import { sandboxScene } from '../../src/scenes/sandbox.js';

/** The details-panel model context `{ buildings, goods, jobs }` a sim's content provides — the content half
 *  every `buildUnitPanelModel` assertion runs against. */
export function ctxOf(sim: Simulation): UnitPanelModelContext {
  return { buildings: sim.content.buildings, goods: sim.content.goods, jobs: sim.content.jobs };
}

/** {@link ctxOf} for a fresh `sandbox` scene sim. A fresh sim per call keeps each test isolated (the scene
 *  build resets the shared component stores; see {@link createSceneSim}). */
export function sandboxCtx(): UnitPanelModelContext {
  return ctxOf(createSceneSim(sandboxScene));
}
