import { battleScene } from './battle.js';
import { berriesScene } from './berries.js';
import { buildingGeometryScene } from './building-geometry.js';
import { collisionScene } from './collision.js';
import { combatScene } from './combat.js';
import { constructionScene } from './construction.js';
import { equipmentScene } from './equipment.js';
import { farmScene } from './farm.js';
import { goodsCatalogScene } from './goods-catalog.js';
import { sandboxScene } from './sandbox.js';
import type { SceneDefinition } from './types.js';
import { warehouseScene } from './warehouse.js';

export { createSceneSim, resetComponentStores } from './runtime.js';
export type { SceneCheck, SceneDefinition } from './types.js';

/**
 * The acceptance-scene registry. Add a scene here and it is automatically (a) covered by the headless
 * mechanic test (`packages/app/test/scenes.test.ts`) and (b) reachable in the browser at
 * `?scene=<id>`. See `docs/SCENES.md` for the workflow.
 */
export const SCENES: readonly SceneDefinition[] = [
  sandboxScene,
  combatScene,
  collisionScene,
  battleScene,
  goodsCatalogScene,
  equipmentScene,
  constructionScene,
  farmScene,
  berriesScene,
  buildingGeometryScene,
  warehouseScene,
];

/** Look up a scene by its `?scene=<id>` value, or `undefined` if no scene has that id. */
export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
