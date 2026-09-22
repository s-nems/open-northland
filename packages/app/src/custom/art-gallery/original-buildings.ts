import type { CustomBuildingManifest } from '@open-northland/art-contracts/custom';
import { type AtlasFrame, lookupFrame, type SpriteLayer } from '@open-northland/render';
import { boundBuildingRef, HOUSE_ATLAS } from '../../content/building-gfx/index.js';
import { shadowStemsByAtlasStem } from '../../content/ir/joins.js';
import { loadLayer, MissingAtlasError } from '../../content/ir/load.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { loadBuildingSheet } from '../../content/sprite-sheet/buildings.js';
import type { WorldTribes } from '../../game/world-tribes.js';

/** A decoded body frame on its atlas page. */
export interface DecodedFrame {
  readonly source: SpriteLayer['source'];
  readonly frame: AtlasFrame;
}

/** The decoded original body one custom package replaces, with its cast shadow when the atlas pairs one. */
export interface OriginalBuilding extends DecodedFrame {
  readonly shadow?: DecodedFrame | undefined;
}

export type OriginalBuildingOf = (manifest: CustomBuildingManifest) => OriginalBuilding | undefined;

/**
 * Load the original building bodies of the tribes the custom packages skin, resolved per package through the
 * map's binding for that `(tribe, typeId)`. `null` without decoded content, so the gallery can say so
 * instead of drawing a placeholder as if it were the original.
 */
export async function loadOriginalBuildings(
  ir: ContentIr | null,
  tribes: WorldTribes,
): Promise<OriginalBuildingOf | null> {
  if (ir === null) return null;
  const shadowStems = shadowStemsByAtlasStem(ir);
  let defaultFamily: SpriteLayer | undefined;
  try {
    defaultFamily = await loadLayer(HOUSE_ATLAS, shadowStems.get(HOUSE_ATLAS));
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
  }
  const sheet = await loadBuildingSheet(ir, tribes, shadowStems);
  if (defaultFamily === undefined && Object.keys(sheet.families).length === 0) return null;
  return (manifest) => {
    const ref = boundBuildingRef(sheet.binding, manifest.typeId, manifest.tribeId);
    if (ref === undefined) return undefined;
    const draw = typeof ref === 'number' ? { bob: ref } : ref;
    const layer = 'layer' in draw ? sheet.families[draw.layer] : defaultFamily;
    const frame = layer === undefined ? null : lookupFrame(layer.atlas, draw.bob);
    if (layer === undefined || frame === null) return undefined;
    const shadowFrame = layer.shadow === undefined ? null : lookupFrame(layer.shadow.atlas, draw.bob);
    return {
      source: layer.source,
      frame,
      ...(layer.shadow !== undefined && shadowFrame !== null
        ? { shadow: { source: layer.shadow.source, frame: shadowFrame } }
        : {}),
    };
  };
}
