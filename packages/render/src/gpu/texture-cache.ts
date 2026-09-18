import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { clamp } from '../data/math.js';
import type { AtlasFrame, BuildTimeSheet } from '../data/sprites/index.js';
import { BuildingTextureCache } from './building-texture-cache.js';
import { isDrawableResource, readable2dContext } from './drawable-resource.js';
import { markMagnifiedTexture, markShadowTexture } from './pixel-art-registry.js';
import { SoftShadowCache } from './soft-shadow-cache.js';

/**
 * Threshold quantisation step for the per-pixel reveal bakes: the eased reveal walks 0-255 thresholds in
 * steps of this size, so one construction pass bakes at most 256/step textures over its lifetime.
 */
const REVEAL_QUANT = 4;

/**
 * Baked reveal textures retained per atlas frame - enough for a few same-type sites at different progress
 * on screen at once. A bake is a real pixel copy rather than a free sub-rect view, hence the tight cap;
 * progress only rises, so an evicted bake is not coming back.
 */
const REVEAL_BAKES_PER_ATLAS_FRAME = 4;

interface RevealBake {
  readonly texture: Texture;
  /** The pool frame this bake was last bound on - the eviction guard. */
  stamp: number;
}

/**
 * A cache of one texture per atlas frame (a sub-rect view into a shared page source). Each frame belongs
 * to exactly one atlas→source, so keying by the frame object is 1:1 and the retained draw path never
 * re-mints a texture in the steady state.
 */
export class TextureCache {
  private readonly buildings = new BuildingTextureCache();
  private readonly softShadows = new SoftShadowCache();
  private useSoftShadows = false;
  private shadowVersion = 0;
  private readonly cache = new Map<AtlasFrame, Texture>();
  /** Cast-silhouette views of the character frames that project onto the ground, kept out of
   *  {@link cache} so the same frame can draw both, keyed by how many of its top rows the view keeps. */
  private readonly casts = new Map<AtlasFrame, Map<number, Texture>>();
  private readonly pages = new Set<TextureSource>();
  /** Bottom-kept views of a frame, keyed by how many top pixels are hidden. Nested so the primary
   *  frame→texture cache above stays a clean 1:1. */
  private readonly cropCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** Top-kept views of a frame, keyed by how many bottom pixels are hidden. */
  private readonly bottomCropCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** Reveal bakes per frame, keyed by quantised threshold. */
  private readonly revealCache = new Map<AtlasFrame, Map<number, RevealBake>>();

  get shadowRevision(): number {
    return this.shadowVersion;
  }

  setSoftShadows(enabled: boolean): void {
    if (this.useSoftShadows === enabled) return;
    this.useSoftShadows = enabled;
    this.shadowVersion++;
  }

  /** A frame of a silhouette (`_s`) atlas. That page serves nothing else, so the returned view is marked
   *  for the batch shader's shadow shading whichever branch produced it. */
  getShadow(source: TextureSource, frame: AtlasFrame): Texture {
    const texture =
      (this.useSoftShadows ? this.softShadows.get(source, frame) : null) ?? this.get(source, frame);
    markShadowTexture(texture);
    return texture;
  }

  /**
   * A second view of a body frame, for drawing that frame as its own cast silhouette. It is kept apart
   * from {@link get}'s view so the batch shader can shade one and not the other, and out of
   * {@link pageSources} so casting from an indexed character sheet cannot hand its page to the
   * linear-sampling flip. `rows` keeps only that many of the frame's top rows, as an integer row count in
   * the frame's own source space, clamped to the frame. Sub-rect views share the page, so this costs no
   * texture memory.
   */
  castSilhouette(source: TextureSource, frame: AtlasFrame, rows: number = frame.height): Texture {
    const kept = clamp(Math.round(rows), 0, frame.height);
    let byRows = this.casts.get(frame);
    if (byRows === undefined) {
      byRows = new Map();
      this.casts.set(frame, byRows);
    }
    let tex = byRows.get(kept);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, frame.width, kept),
      });
      markShadowTexture(tex);
      byRows.set(kept, tex);
    }
    return tex;
  }

  getBuilding(source: TextureSource, frame: AtlasFrame): Texture {
    return this.buildings.get(source, frame) ?? this.get(source, frame);
  }

  get(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.cache.get(frame);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      });
      markMagnifiedTexture(tex);
      this.cache.set(frame, tex);
      this.pages.add(source);
    }
    return tex;
  }

  /** The distinct atlas pages served so far: world RGB and shadow bob atlases only. Paletted character
   *  meshes bypass this cache, and a reveal bake's own `CanvasSource` is never registered here, so a
   *  sampling toggle cannot reach an indexed sheet, whose palette indices must stay nearest-sampled. */
  pageSources(): ReadonlySet<TextureSource> {
    return this.pages;
  }

  /**
   * A view of `frame` with its top `hiddenTop` pixels cropped off, for the bottom-up construction reveal.
   * `hiddenTop` is an integer pixel count in the frame's own source space, clamped to the frame. The
   * sub-cache holds sub-rect views sharing one GPU source, so it costs no new texture memory.
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
      markMagnifiedTexture(tex);
      byTop.set(top, tex);
      this.pages.add(source);
    }
    return tex;
  }

  /**
   * The mirror of {@link cropped}, for the building-collapse sink (the original's
   * `PrintBob_UsingCollapseTimeMask` removes rows bottom-up). Same caching and bounds discipline.
   */
  croppedBottom(source: TextureSource, frame: AtlasFrame, hiddenBottom: number): Texture {
    const bottom = clamp(Math.round(hiddenBottom), 0, frame.height);
    let byBottom = this.bottomCropCache.get(frame);
    if (byBottom === undefined) {
      byBottom = new Map();
      this.bottomCropCache.set(frame, byBottom);
    }
    let tex = byBottom.get(bottom);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height - bottom),
      });
      markMagnifiedTexture(tex);
      byBottom.set(bottom, tex);
      this.pages.add(source);
    }
    return tex;
  }

  /**
   * The frame with only its pixels whose baked build-time threshold is `<= threshold`, baked onto a
   * canvas at a {@link REVEAL_QUANT}-quantised threshold. `frameStamp` is the pool's frame counter, which
   * the eviction guard reads. `null` (pixels not CPU-readable) sends the caller to the crop fallback.
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
      cached.texture.source.scaleMode = source.scaleMode;
      return cached.texture;
    }
    const canvas = bakeRevealCanvas(source, frame, times, q);
    if (canvas === null) return null;
    const baked = new CanvasSource({
      resource: canvas,
      scaleMode: source.scaleMode,
      autoGenerateMipmaps: source.autoGenerateMipmaps,
    });
    const bake: RevealBake = {
      texture: new Texture({ source: baked }),
      stamp: frameStamp,
    };
    markMagnifiedTexture(bake.texture, source);
    byThreshold.set(q, bake);
    if (byThreshold.size > REVEAL_BAKES_PER_ATLAS_FRAME) {
      for (const [key, old] of byThreshold) {
        if (byThreshold.size <= REVEAL_BAKES_PER_ATLAS_FRAME) break;
        if (old.stamp >= frameStamp) continue; // bound this frame - a live sprite may hold it
        old.texture.destroy(true);
        byThreshold.delete(key);
      }
    }
    return bake.texture;
  }

  /** Destroy every cached texture. Dropping the map entry is not enough: a Pixi `Texture` registers a
   *  `resize` listener on its source, so the app-owned atlas page keeps it alive until `destroy`
   *  unregisters it. Sub-rect views destroy at Pixi's default `destroySource: false` so the app-owned
   *  page outlives the renderer; the reveal bakes own their canvas source and take it with them. */
  clear(): void {
    this.buildings.clear();
    this.softShadows.clear();
    for (const tex of this.cache.values()) tex.destroy();
    this.cache.clear();
    for (const byRows of this.casts.values()) {
      for (const tex of byRows.values()) tex.destroy();
    }
    this.casts.clear();
    for (const byTop of this.cropCache.values()) {
      for (const tex of byTop.values()) tex.destroy();
    }
    this.cropCache.clear();
    for (const byBottom of this.bottomCropCache.values()) {
      for (const tex of byBottom.values()) tex.destroy();
    }
    this.bottomCropCache.clear();
    this.pages.clear();
    for (const byThreshold of this.revealCache.values()) {
      for (const bake of byThreshold.values()) bake.texture.destroy(true);
    }
    this.revealCache.clear();
  }
}

/**
 * Copy `frame`'s pixels off the atlas image and zero the alpha of every pixel whose time-sheet byte is
 * above `threshold`. `null` when the source pixels are unreadable (non-drawable resource, no 2d context,
 * a tainted canvas) so the caller can degrade.
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
    return null; // tainted/undecodable source - the caller falls back to the crop
  }
}
