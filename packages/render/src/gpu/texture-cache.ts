import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites/index.js';

/**
 * A cache of one {@link Texture} per atlas {@link AtlasFrame} (a sub-rect view into a shared page
 * {@link TextureSource}). Each frame belongs to exactly one atlas→source, so keying the cache by the
 * frame object is 1:1 — the same frame always yields the same reused `Texture`, so the retained draw
 * path never re-mints a texture in the steady state (near-zero per-frame allocation). Shared by the
 * {@link import('./sprite-pool/index.js').SpritePool}, the tall map objects
 * ({@link import('./map-objects/index.js').MapObjectLayer}), and the
 * {@link import('./gallery/index.js').AnimationGallery} — every retained Pixi view needs the exact
 * same frame→texture memoization.
 */
export class TextureCache {
  private readonly cache = new Map<AtlasFrame, Texture>();
  /** Bottom-cropped views of a frame, keyed by how many TOP pixels are hidden — the reveal path
   *  ({@link cropped}). Nested so the primary frame→texture cache above stays a clean 1:1. */
  private readonly cropCache = new Map<AtlasFrame, Map<number, Texture>>();

  /** The reused {@link Texture} for `frame` on `source`, minted (and cached) on first request. */
  get(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.cache.get(frame);
    if (tex === undefined) {
      tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.cache.set(frame, tex);
    }
    return tex;
  }

  /**
   * A view of `frame` with its top `hiddenTop` pixels cropped OFF — only the bottom `height − hiddenTop`
   * rows, used for the bottom-up construction reveal (a building rising out of the ground). `hiddenTop` is
   * an integer pixel count in the frame's own (source) space, clamped to the frame; the caller shifts the
   * sprite DOWN by `hiddenTop · scale` so the visible bottom stays anchored. Cached per (frame, hiddenTop):
   * the eased reveal walks whole-pixel `hiddenTop` values, so over a build this sub-cache can grow to at most
   * the frame's height in entries — BOUNDED (lightweight sub-rect views sharing one GPU source, no new
   * texture memory), and every home crops the same frame identically so a warm cache mints nothing per frame.
   */
  cropped(source: TextureSource, frame: AtlasFrame, hiddenTop: number): Texture {
    const top = Math.max(0, Math.min(frame.height, Math.round(hiddenTop)));
    let byTop = this.cropCache.get(frame);
    if (byTop === undefined) {
      byTop = new Map();
      this.cropCache.set(frame, byTop);
    }
    let tex = byTop.get(top);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y + top, frame.width, frame.height - top),
      });
      byTop.set(top, tex);
    }
    return tex;
  }

  /** Drop every cached texture (called on renderer/gallery dispose). */
  clear(): void {
    this.cache.clear();
    this.cropCache.clear();
  }
}
