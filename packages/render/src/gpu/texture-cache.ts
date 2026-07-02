import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites.js';

/**
 * A cache of one {@link Texture} per atlas {@link AtlasFrame} (a sub-rect view into a shared page
 * {@link TextureSource}). Each frame belongs to exactly one atlas→source, so keying the cache by the
 * frame object is 1:1 — the same frame always yields the same reused `Texture`, so the retained draw
 * path never re-mints a texture in the steady state (near-zero per-frame allocation). Shared by the
 * {@link import('./sprite-pool.js').SpritePool}, the tall map objects
 * ({@link import('./map-object-layer.js').MapObjectLayer}), and the
 * {@link import('./animation-gallery.js').AnimationGallery} — every retained Pixi view needs the exact
 * same frame→texture memoization.
 */
export class TextureCache {
  private readonly cache = new Map<AtlasFrame, Texture>();

  /** The reused {@link Texture} for `frame` on `source`, minted (and cached) on first request. */
  get(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.cache.get(frame);
    if (tex === undefined) {
      tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.cache.set(frame, tex);
    }
    return tex;
  }

  /** Drop every cached texture (called on renderer/gallery dispose). */
  clear(): void {
    this.cache.clear();
  }
}
