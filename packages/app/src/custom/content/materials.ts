import { collectTerrainMaterials } from '@open-northland/art-contracts/custom';

export type { CustomTerrainMaterial } from '@open-northland/art-contracts/custom';

const manifests = import.meta.glob('../../assets/custom/terrain/*.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/custom/terrain/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const customMaterialUrls: ReadonlyMap<string, string> = new Map(
  Object.entries(images).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);
export const customTerrainMaterials = collectTerrainMaterials(
  Object.entries(manifests)
    .filter(([path]) => !path.endsWith('/map-bindings.json'))
    .map(([, manifest]) => manifest),
  new Set(customMaterialUrls.keys()),
);
