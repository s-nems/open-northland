import type { OwnBuildingManifest, OwnBuildingOverlay } from '@open-northland/art-contracts';

export { type OwnBuildingManifest, ownBuildingManifest } from '@open-northland/art-contracts';

import {
  type BuildingOverlayRef,
  type BuildingTypeBinding,
  type ConstructionLayerRef,
  halfCellToScreen,
  type SpriteAtlas,
  type SpriteBindings,
} from '@open-northland/render';

export function ownConstructionLayer(manifest: OwnBuildingManifest, index: number): string {
  return `${manifest.layer}-construction-${index}`;
}

export function ownOverlayLayer(manifest: OwnBuildingManifest): string {
  return `${manifest.layer}-overlay`;
}

/** Source-to-world scale of one of the manifest's layers; only the overlay carries its own. */
export function ownLayerScale(manifest: OwnBuildingManifest, layer: string): number {
  return manifest.overlay !== undefined && layer === ownOverlayLayer(manifest)
    ? manifest.overlay.scale
    : manifest.scale;
}

export function ownBuildingFiles(manifest: OwnBuildingManifest): readonly string[] {
  return [
    ...new Set([
      manifest.sprite,
      ...(manifest.shadow === undefined ? [] : [manifest.shadow.sprite]),
      ...(manifest.overlay === undefined ? [] : [manifest.overlay.sprite]),
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

/** The overlay sheet's pixel size: `columns` frames per row, row-major. */
export function ownOverlaySheetSize(overlay: OwnBuildingOverlay): { width: number; height: number } {
  return {
    width: overlay.frameWidth * overlay.columns,
    height: overlay.frameHeight * Math.ceil(overlay.frames / overlay.columns),
  };
}

/** The overlay sheet's frames, each registered so its top-left corner lands on the body's `bodyPixel`
 *  at the overlay's own scale. */
export function ownOverlayAtlas(manifest: OwnBuildingManifest, overlay: OwnBuildingOverlay): SpriteAtlas {
  const door = halfCellToScreen(manifest.doorNode.x, manifest.doorNode.y);
  const offsetX =
    (door.x + (overlay.bodyPixel.x - manifest.entrancePixel.x) * manifest.scale) / overlay.scale;
  const offsetY =
    (door.y + (overlay.bodyPixel.y - manifest.entrancePixel.y) * manifest.scale) / overlay.scale;
  const { frameWidth: width, frameHeight: height, columns } = overlay;
  return {
    ...ownOverlaySheetSize(overlay),
    frames: new Map(
      Array.from({ length: overlay.frames }, (_, i) => [
        i,
        { x: (i % columns) * width, y: Math.floor(i / columns) * height, width, height, offsetX, offsetY },
      ]),
    ),
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
      overlayByType: Record<number, BuildingOverlayRef>;
    }
  > = {};
  const layers = new Set<string>();
  for (const manifest of manifests) {
    const tribe = byTribe[manifest.tribeId] ?? { byType: {}, constructionByType: {}, overlayByType: {} };
    const names = [
      manifest.layer,
      ...(manifest.overlay === undefined ? [] : [ownOverlayLayer(manifest)]),
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
    if (manifest.overlay !== undefined) {
      const { idle, working, ticksPerFrame } = manifest.overlay;
      tribe.overlayByType[manifest.typeId] = {
        layer: ownOverlayLayer(manifest),
        idle,
        working,
        ticksPerFrame,
      };
    }
    byTribe[manifest.tribeId] = tribe;
  }
  return { default: typeof fallback === 'number' ? fallback : fallback.default, byType: {}, byTribe };
}
