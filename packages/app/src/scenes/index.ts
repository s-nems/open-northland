import { allBuildingsScene } from './all-buildings.js';
import { charactersScene } from './characters.js';
import { housePlacementScene } from './house-placement.js';
import { soundShowcaseScene } from './sound-showcase.js';
import { stressCrowdScene } from './stress-crowd.js';
import type { SceneDefinition } from './types.js';

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
  housePlacementScene,
  soundShowcaseScene,
  stressCrowdScene,
];

/** Look up a scene by its `?scene=<id>` value, or `undefined` if no scene has that id. */
export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
