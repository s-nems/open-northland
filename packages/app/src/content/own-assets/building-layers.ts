import type { SpriteLayer } from '@open-northland/render';
import { Assets, type Texture } from 'pixi.js';
import { fetchImageData } from '../net.js';
import {
  type OwnBuildingManifest,
  ownBuildingAtlas,
  ownConstructionLayer,
  ownOverlayAtlas,
  ownOverlayLayer,
  ownOverlaySheetSize,
} from './building-manifest.js';

export async function loadOwnBuildingLayers(
  manifest: OwnBuildingManifest,
  imageUrl: (filename: string) => string | undefined,
): Promise<Readonly<Record<string, SpriteLayer>>> {
  async function texture(sprite: string, size: { width: number; height: number }): Promise<Texture> {
    const url = imageUrl(sprite);
    if (url === undefined) throw new Error(`Missing sprite ${sprite}`);
    const loaded = await Assets.load<Texture>(url);
    if (loaded.width !== size.width || loaded.height !== size.height) {
      throw new Error(`Sprite dimensions disagree with manifest: ${sprite}`);
    }
    loaded.source.scaleMode = 'linear';
    loaded.source.autoGenerateMipmaps = true;
    return loaded;
  }
  async function load(
    sprite: string,
    timeMask?: string,
    geometry: OwnBuildingManifest = manifest,
  ): Promise<SpriteLayer> {
    const { source } = await texture(sprite, geometry);
    const layer = { source, atlas: ownBuildingAtlas(geometry) };
    if (timeMask === undefined) return layer;
    const maskUrl = imageUrl(timeMask);
    const pixels = maskUrl === undefined ? null : await fetchImageData(maskUrl);
    if (pixels === null || pixels.width !== manifest.width || pixels.height !== manifest.height) {
      throw new Error(`Missing or mismatched construction mask: ${timeMask}`);
    }
    const values = new Uint8Array(pixels.width * pixels.height);
    for (let i = 0; i < values.length; i++) values[i] = pixels.data[i * 4] ?? 0;
    return { ...layer, times: { width: pixels.width, height: pixels.height, values } };
  }
  let body = await load(manifest.sprite);
  if (manifest.shadow !== undefined) {
    const shadow = manifest.shadow;
    // The shadow lane keeps shadows below the body and outside selection and hit testing.
    body = {
      ...body,
      shadow: await load(shadow.sprite, undefined, { ...manifest, ...shadow, selectionEllipse: undefined }),
    };
  }
  const overlay = manifest.overlay;
  const stateOverlay =
    overlay === undefined
      ? {}
      : {
          [ownOverlayLayer(manifest)]: {
            source: (await texture(overlay.sprite, ownOverlaySheetSize(overlay))).source,
            atlas: ownOverlayAtlas(manifest, overlay),
          },
        };
  const stages = await Promise.all(
    (manifest.construction ?? []).map(
      async (stage, i) =>
        [ownConstructionLayer(manifest, i), await load(stage.sprite, stage.timeMask)] as const,
    ),
  );
  return { [manifest.layer]: body, ...stateOverlay, ...Object.fromEntries(stages) };
}
