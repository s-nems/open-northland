import { collectTerrainMaterials } from '@open-northland/art-contracts';

export type { OwnTerrainMaterial } from '@open-northland/art-contracts';

const manifests = import.meta.glob('../../assets/own/terrain/*.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/own/terrain/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const ownMaterialUrls: ReadonlyMap<string, string> = new Map(
  Object.entries(images).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);
export const ownTerrainMaterials = collectTerrainMaterials(
  Object.entries(manifests)
    .filter(([path]) => !path.endsWith('/map-bindings.json'))
    .map(([, manifest]) => manifest),
  new Set(ownMaterialUrls.keys()),
);
