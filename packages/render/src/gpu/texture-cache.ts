import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { clamp } from '../data/math.js';
import type { AtlasFrame, BuildTimeSheet } from '../data/sprites/index.js';
import { isDrawableResource, readable2dContext } from './drawable-resource.js';

/**
 * Threshold quantisation step for the per-pixel reveal bakes ({@link TextureCache.revealed}): the eased
 * reveal walks 0–255 thresholds in steps of this size, so one construction pass bakes at most 256/step
 * textures per frame (and the cache keeps only the freshest {@link REVEAL_BAKES_PER_FRAME}). Step 4
 * ≈ 1.6% build progress per re-bake — finer than the sim's per-swing `built` increments, so the
 * quantisation is invisible against the original's own 0–255 scale.
 */
const REVEAL_QUANT = 4;

/**
 * Baked reveal textures retained per atlas frame — enough for a few same-type sites at different
 * progress on screen at once. Progress only rises, so an evicted (older, not-used-this-frame) bake is
 * not coming back; its texture + canvas are destroyed. Real pixel copies (unlike the free sub-rect
 * views of {@link TextureCache.cropped}), hence the tight cap.
 */
const REVEAL_BAKES_PER_FRAME = 4;

/** One baked reveal texture + the pool frame it was last bound on (the eviction guard). */
interface RevealBake {
  readonly texture: Texture;
  stamp: number;
}

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
  /** Every distinct atlas page a texture was minted from — the world-sampling toggle
   *  ({@link import('./world-renderer.js').WorldRenderer}) flips these between nearest/linear. */
  private readonly pages = new Set<TextureSource>();
  /** Bottom-cropped views of a frame, keyed by how many top pixels are hidden — the reveal path
   *  ({@link cropped}). Nested so the primary frame→texture cache above stays a clean 1:1. */
  private readonly cropCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** Per-pixel reveal bakes per frame, keyed by quantised threshold ({@link revealed}). */
  private readonly revealCache = new Map<AtlasFrame, Map<number, RevealBake>>();

  /** The reused {@link Texture} for `frame` on `source`, minted (and cached) on first request. */
  get(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.cache.get(frame);
    if (tex === undefined) {
      tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.cache.set(frame, tex);
      this.pages.add(source);
    }
    return tex;
  }

  /** The distinct atlas pages served so far — world RGB/shadow bob atlases only (paletted character
   *  meshes and the reveal bakes never pass through here), so a sampling toggle can't touch an
   *  indexed sheet whose palette indices must stay nearest-sampled. */
  pageSources(): ReadonlySet<TextureSource> {
    return this.pages;
  }

  /**
   * A view of `frame` with its top `hiddenTop` pixels cropped off — only the bottom `height − hiddenTop`
   * rows, used for the bottom-up construction reveal (a building rising out of the ground). `hiddenTop` is
   * an integer pixel count in the frame's own (source) space, clamped to the frame; the caller shifts the
   * sprite down by `hiddenTop · scale` so the visible bottom stays anchored. Cached per (frame, hiddenTop):
   * the eased reveal walks whole-pixel `hiddenTop` values, so over a build this sub-cache can grow to at most
   * the frame's height in entries — bounded (lightweight sub-rect views sharing one GPU source, no new
   * texture memory), and every home crops the same frame identically so a warm cache mints nothing per frame.
   */
  cropped(source: TextureSource, frame: AtlasFrame, hiddenTop: number): Texture {
    const top = clamp(Math.round(hiddenTop), 0, frame.height);
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
      this.pages.add(source);
    }
    return tex;
  }

  /**
   * The frame with only its pixels whose baked build-time threshold ({@link BuildTimeSheet}) is
   * `<= threshold` — the per-pixel construction reveal, where a pixel appears once progress reaches
   * its time-mask byte. Unlike
   * {@link cropped}'s free sub-rect views this is a real canvas bake, so thresholds are quantised
   * ({@link REVEAL_QUANT}) and only the freshest {@link REVEAL_BAKES_PER_FRAME} bakes per frame are
   * kept — `frameStamp` (the pool's frame counter) guards a bake bound earlier this frame from
   * eviction, since destroying it would break another site's sprite mid-frame. Threshold 255 returns
   * the plain full frame; `null` (pixels not CPU-readable) sends the caller to the crop fallback.
   */
  revealed(
    source: TextureSource,
    frame: AtlasFrame,
    times: BuildTimeSheet,
    threshold: number,
    frameStamp: number,
  ): Texture | null {
    const q = Math.min(255, Math.round(clamp(threshold, 0, 255) / REVEAL_QUANT) * REVEAL_QUANT);
    if (q >= 255) return this.get(source, frame);
    let byThreshold = this.revealCache.get(frame);
    if (byThreshold === undefined) {
      byThreshold = new Map();
      this.revealCache.set(frame, byThreshold);
    }
    const cached = byThreshold.get(q);
    if (cached !== undefined) {
      cached.stamp = frameStamp;
      return cached.texture;
    }
    const canvas = bakeRevealCanvas(source, frame, times, q);
    if (canvas === null) return null;
    const bake: RevealBake = {
      texture: new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) }),
      stamp: frameStamp,
    };
    byThreshold.set(q, bake);
    if (byThreshold.size > REVEAL_BAKES_PER_FRAME) {
      for (const [key, old] of byThreshold) {
        if (byThreshold.size <= REVEAL_BAKES_PER_FRAME) break;
        if (old.stamp >= frameStamp) continue; // bound this frame — a live sprite may hold it
        old.texture.destroy(true);
        byThreshold.delete(key);
      }
    }
    return bake.texture;
  }

  /** Drop every cached texture (called on renderer/gallery dispose). The reveal bakes own their canvas
   *  sources (unlike the sub-rect views), so they are destroyed, not just dropped. */
  clear(): void {
    this.cache.clear();
    this.cropCache.clear();
    this.pages.clear();
    for (const byThreshold of this.revealCache.values()) {
      for (const bake of byThreshold.values()) bake.texture.destroy(true);
    }
    this.revealCache.clear();
  }
}

/**
 * Copy `frame`'s pixels off the atlas image and zero the alpha of every pixel whose time-sheet byte is
 * above `threshold` — the CPU half of {@link TextureCache.revealed}. `null` when the source pixels are
 * unreadable (non-drawable resource, no 2d context, a tainted canvas) so the caller can degrade.
 */
function bakeRevealCanvas(
  source: TextureSource,
  frame: AtlasFrame,
  times: BuildTimeSheet,
  threshold: number,
): OffscreenCanvas | HTMLCanvasElement | null {
  const resource: unknown = source.resource;
  if (!isDrawableResource(resource)) return null;
  const ctx = readable2dContext(frame.width, frame.height);
  if (ctx === null) return null;
  try {
    ctx.drawImage(resource, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    const img = ctx.getImageData(0, 0, frame.width, frame.height);
    const data = img.data;
    for (let y = 0; y < frame.height; y++) {
      const sheetRow = (frame.y + y) * times.width + frame.x;
      const localRow = y * frame.width;
      for (let x = 0; x < frame.width; x++) {
        if ((times.values[sheetRow + x] ?? 0) > threshold) data[(localRow + x) * 4 + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return ctx.canvas;
  } catch {
    return null; // tainted/undecodable source — the caller falls back to the crop
  }
}
