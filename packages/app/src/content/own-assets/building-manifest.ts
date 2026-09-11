import type { OwnBuildingManifest } from '@open-northland/art-contracts';

export { type OwnBuildingManifest, ownBuildingManifest } from '@open-northland/art-contracts';

import {
  type BuildingTypeBinding,
  type ConstructionLayerRef,
  halfCellToScreen,
  type SpriteAtlas,
  type SpriteBindings,
} from '@open-northland/render';

export function ownConstructionLayer(manifest: OwnBuildingManifest, index: number): string {
  return `${manifest.layer}-construction-${index}`;
}

export function ownBuildingFiles(manifest: OwnBuildingManifest): readonly string[] {
  return [
    ...new Set([
      manifest.sprite,
      ...(manifest.construction ?? []).flatMap((stage) => [stage.sprite, stage.timeMask]),
    ]),
  ];
}

export function ownBuildingAtlas(manifest: OwnBuildingManifest): SpriteAtlas {
  const { width, height, scale, entrancePixel, doorNode } = manifest;
  const door = halfCellToScreen(doorNode.x, doorNode.y);
  return {
    width,
    height,
    frames: new Map([
      [
        0,
        {
          x: 0,
          y: 0,
          width,
          height,
          offsetX: door.x / scale - entrancePixel.x,
          offsetY: door.y / scale - entrancePixel.y,
          ...(manifest.selectionEllipse === undefined ? {} : { selectionEllipse: manifest.selectionEllipse }),
        },
      ],
    ]),
  };
}

export function ownBuildingBindings(
  fallback: SpriteBindings['building'],
  manifests: readonly OwnBuildingManifest[],
): BuildingTypeBinding {
  const byTribe: Record<
    number,
    {
      byType: Record<number, { layer: string; bob: number }>;
      constructionByType: Record<number, ConstructionLayerRef[]>;
    }
  > = {};
  const layers = new Set<string>();
  for (const manifest of manifests) {
    const tribe = byTribe[manifest.tribeId] ?? { byType: {}, constructionByType: {} };
    const names = [
      manifest.layer,
      ...(manifest.construction ?? []).map((_, i) => ownConstructionLayer(manifest, i)),
    ];
    if (tribe.byType[manifest.typeId] !== undefined || names.some((name) => layers.has(name))) {
      throw new Error(`Duplicate own building binding or layer: ${manifest.layer}`);
    }
    for (const name of names) layers.add(name);
    tribe.byType[manifest.typeId] = { layer: manifest.layer, bob: 0 };
    if (manifest.construction !== undefined) {
      tribe.constructionByType[manifest.typeId] = manifest.construction.map((stage, i) => ({
        layer: ownConstructionLayer(manifest, i),
        bob: 0,
        fromPct: stage.fromPct,
        toPct: stage.toPct,
      }));
    }
    byTribe[manifest.tribeId] = tribe;
  }
  return { default: typeof fallback === 'number' ? fallback : fallback.default, byType: {}, byTribe };
}
