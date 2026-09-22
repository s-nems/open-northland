import type { ResourceTypeBinding, SpriteBindings } from '@open-northland/render';
import type { ContentIr } from '../../content/ir/rows.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../../content/map-resources.js';
import { type CustomPropManifest, customPropLayer, customPropNames } from './prop-manifest.js';

export function customBushBinding(
  fallback: SpriteBindings['berrybush'],
  ir: ContentIr | null,
  manifests: readonly CustomPropManifest[],
): SpriteBindings['berrybush'] {
  const names = customPropNames(manifests);
  const base: ResourceTypeBinding =
    typeof fallback === 'object' ? fallback : { default: fallback ?? 0, byGood: {} };
  const byGfxIndex = { ...base.byGfxIndex };
  let matched = false;
  for (const row of ir?.landscapeGfx ?? []) {
    if (row.logicType !== BUSH_WITH_FRUITS_LOGIC_TYPE || row.editName === undefined) continue;
    const name = row.editName;
    const stages = ['empty', 'flower', 'fruits'].map((suffix) =>
      names.get(name.replace(/fruits?$/i, suffix)),
    );
    if (stages.some((stage) => stage === undefined)) continue;
    byGfxIndex[row.index] = stages.flatMap((stage) =>
      stage === undefined ? [] : [{ layer: customPropLayer(stage.id), bob: 0 }],
    );
    matched = true;
  }
  return matched ? { ...base, byGfxIndex } : fallback;
}
