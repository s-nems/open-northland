import { angledPathScene } from './angled-path.js';
import { buildingTypesScene } from './building-types.js';
import { gatherResourceScene } from './gather-resource.js';
import type { SceneDefinition } from './types.js';

export type { SceneDefinition, SceneCheck } from './types.js';
export { createSceneSim, resetComponentStores } from './runtime.js';

/**
 * The acceptance-scene registry. Add a scene here and it is automatically (a) covered by the headless
 * mechanic test (`packages/app/test/scenes.test.ts`) and (b) reachable in the browser at
 * `?scene=<id>`. See `docs/SCENES.md` for the workflow.
 */
export const SCENES: readonly SceneDefinition[] = [gatherResourceScene, angledPathScene, buildingTypesScene];

/** Look up a scene by its `?scene=<id>` value, or `undefined` if no scene has that id. */
export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
