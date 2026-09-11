import type { TerrainTextureSet } from '@open-northland/render';
import { TERRAIN_OPEN } from '../../catalog/terrain.js';
import { MATERIAL_GUTTER, MATERIAL_TILE } from './material-layout.js';

/** Synthetic scene grass has a navigation class but no decoded ground-pattern name. */
export function ownSceneTerrain(terrain: TerrainTextureSet): TerrainTextureSet {
  return {
    ...terrain,
    cellFor: (typeId) =>
      typeId === TERRAIN_OPEN && terrain.pages.has('own-meadow')
        ? {
            pageKey: 'own-meadow',
            rect: { x: MATERIAL_GUTTER, y: MATERIAL_GUTTER, w: MATERIAL_TILE, h: MATERIAL_TILE },
            fallbackColour: 0x687e4b,
          }
        : terrain.cellFor(typeId),
  };
}
