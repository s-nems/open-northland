import { Sprite } from 'pixi.js';
import type { ResolvedLayer } from '../sprite-pool/index.js';
import type { TextureCache } from '../texture-cache.js';

/** Mint a plain, non-pooled sprite for one {@link ResolvedLayer}. The shared per-layer step of the static
 *  sprite stacks the collapse and placement-ghost overlays build from a resolved bob. */
export function mintLayerSprite(textures: TextureCache, layer: ResolvedLayer): Sprite {
  const spr = new Sprite(textures.get(layer.source, layer.frame));
  spr.position.set(layer.frame.offsetX * layer.scale, layer.frame.offsetY * layer.scale);
  spr.scale.set(layer.scale);
  return spr;
}
