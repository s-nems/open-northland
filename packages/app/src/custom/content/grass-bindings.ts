import { grassBindingsSchema } from '@open-northland/art-contracts/custom';
import type { GfxPattern } from '@open-northland/data';
import type { GroundPattern } from '@open-northland/render';
import manifest from '../../assets/custom/terrain/map-bindings.json';

const bindings = grassBindingsSchema.parse(manifest);

export function customGrassBindings(
  rows: readonly GfxPattern[],
  width: number,
  height: number,
): ReadonlyMap<string, GroundPattern> {
  const pages = new Map(bindings.pages.map((page) => [page.source, page]));
  const patterns = new Map<string, GroundPattern>();
  for (const row of rows) {
    const page = row.texture === undefined ? undefined : pages.get(row.texture);
    if (!page || !row.editName || !row.coordsA || !row.coordsB) continue;
    const convert = (coords: readonly number[]): number[] =>
      coords.map((value, index) => {
        const size = index % 2 === 0 ? width : height;
        return (value / page.extent) * size;
      });
    patterns.set(row.editName, {
      pageKey: 'own-grass',
      coordsA: convert(row.coordsA),
      coordsB: convert(row.coordsB),
    });
  }
  return patterns;
}
