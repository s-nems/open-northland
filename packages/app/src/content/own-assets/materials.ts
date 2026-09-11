import { terrainMaterialsSchema } from '@open-northland/art-contracts';

export type { OwnTerrainMaterial } from '@open-northland/art-contracts';

import manifest from '../../assets/own/terrain/materials.json';
import rockManifest from '../../assets/own/terrain/rock-materials.json';
import sandManifest from '../../assets/own/terrain/sand-materials.json';

export const ownTerrainMaterials = terrainMaterialsSchema.parse({
  sourceBasis: `${manifest.sourceBasis} ${rockManifest.sourceBasis} ${sandManifest.sourceBasis}`,
  materials: [...manifest.materials, ...rockManifest.materials, ...sandManifest.materials],
}).materials;
