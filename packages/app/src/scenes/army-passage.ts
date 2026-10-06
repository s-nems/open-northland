import { TERRAIN_IMPASSABLE } from '../catalog/terrain.js';
import { armyControlScene } from './army-control.js';
import type { SceneDefinition } from './types.js';

const clearing = armyControlScene.terrain;

/** The same army crosses a narrow land passage before spreading back into its destination area. */
export const armyPassageScene: SceneDefinition = {
  ...armyControlScene,
  id: 'army-passage',
  initialZoom: 0.4,
  terrain: {
    ...clearing,
    typeIds: clearing.typeIds.map((type, index) => {
      const x = index % clearing.width;
      const y = Math.floor(index / clearing.width);
      return x >= 56 && x <= 57 && (y < 18 || y > 28) ? TERRAIN_IMPASSABLE : type;
    }),
  },
};
