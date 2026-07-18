import { battleScene } from './battle.js';
import { berriesScene } from './berries.js';
import { chainScene } from './chain.js';
import { childrenScene } from './children.js';
import { collisionScene } from './collision.js';
import { familyScene } from './family.js';
import { goodsCatalogScene } from './goods-catalog.js';
import { gossipScene } from './gossip.js';
import { sandboxScene } from './sandbox/index.js';
import { signpostsScene } from './signposts.js';
import type { SceneDefinition } from './types.js';
import { upgradeScene } from './upgrade.js';
import { warehouseScene } from './warehouse.js';

export { createSceneSim } from './runtime.js';
export type { SceneDefinition } from './types.js';

/**
 * The acceptance-scene registry. Add a scene here and it is automatically (a) covered by the headless
 * mechanic test (`packages/app/test/scenes.test.ts`) and (b) reachable in the browser at
 * `?scene=<id>`. See `docs/SCENES.md` for the workflow.
 */
export const SCENES: readonly SceneDefinition[] = [
  sandboxScene,
  collisionScene,
  battleScene,
  goodsCatalogScene,
  berriesScene,
  chainScene,
  warehouseScene,
  upgradeScene,
  signpostsScene,
  familyScene,
  childrenScene,
  gossipScene,
];

/** Look up a scene by its `?scene=<id>` value, or `undefined` if no scene has that id. */
export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
