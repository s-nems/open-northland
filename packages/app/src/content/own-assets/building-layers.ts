import type { SpriteLayer } from '@open-northland/render';
import { Assets, type Texture } from 'pixi.js';
import { fetchImageData } from '../net.js';
import { type OwnBuildingManifest, ownBuildingAtlas, ownConstructionLayer } from './building-manifest.js';

export async function loadOwnBuildingLayers(
  manifest: OwnBuildingManifest,
  imageUrl: (filename: string) => string | undefined,
): Promise<Readonly<Record<string, SpriteLayer>>> {
  async function load(
    sprite: string,
    timeMask?: string,
    geometry: OwnBuildingManifest = manifest,
  ): Promise<SpriteLayer> {
    const url = imageUrl(sprite);
    if (url === undefined) throw new Error(`Missing sprite ${sprite}`);
    const texture = await Assets.load<Texture>(url);
    if (texture.width !== geometry.width || texture.height !== geometry.height) {
      throw new Error(`Sprite dimensions disagree with manifest: ${sprite}`);
    }
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
    const layer = { source: texture.source, atlas: ownBuildingAtlas(geometry) };
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
  const stages = await Promise.all(
    (manifest.construction ?? []).map(
      async (stage, i) =>
        [ownConstructionLayer(manifest, i), await load(stage.sprite, stage.timeMask)] as const,
    ),
  );
  return { [manifest.layer]: body, ...Object.fromEntries(stages) };
}
