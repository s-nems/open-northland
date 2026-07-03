import { allBuildingsScene } from './all-buildings.js';
import { charactersScene } from './characters.js';
import { craftChainScene } from './craft-chain.js';
import { gatheringScene } from './gathering.js';
import { housePlacementScene } from './house-placement.js';
import { meleeEngagementScene } from './melee-engagement.js';
import { soundShowcaseScene } from './sound-showcase.js';
import { stancesScene } from './stances.js';
import { stressCrowdScene } from './stress-crowd.js';
import { toolPanelScene } from './tool-panel.js';
import type { SceneDefinition } from './types.js';
import { unitOrdersScene } from './unit-orders.js';

export type { SceneDefinition, SceneCheck } from './types.js';
export { createSceneSim, resetComponentStores } from './runtime.js';

/**
 * The acceptance-scene registry. Add a scene here and it is automatically (a) covered by the headless
 * mechanic test (`packages/app/test/scenes.test.ts`) and (b) reachable in the browser at
 * `?scene=<id>`. See `docs/SCENES.md` for the workflow.
 */
export const SCENES: readonly SceneDefinition[] = [
  allBuildingsScene,
  charactersScene,
  craftChainScene,
  gatheringScene,
  housePlacementScene,
  meleeEngagementScene,
  soundShowcaseScene,
  stancesScene,
  stressCrowdScene,
  toolPanelScene,
  unitOrdersScene,
];

/** Look up a scene by its `?scene=<id>` value, or `undefined` if no scene has that id. */
export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
