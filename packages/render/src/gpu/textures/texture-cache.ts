import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { clamp } from '../../data/math.js';
import type { AtlasFrame, BuildTimeSheet } from '../../data/sprites/index.js';
import {
  type GroundColours,
  GroundedFootCache,
  type GroundFootPart,
  sinkBody,
} from '../ground-foot/index.js';
import {
  isPixelArtSource,
  markMagnifiedTexture,
  markPalettedTexture,
  markPixelArtSource,
  markShadowTexture,
} from '../pixel-art/registry.js';
import { BuildingTextureCache } from './building-texture-cache.js';
import { readable2dContext } from './drawable-resource.js';
import {
  type ErasedFrame,
  ErasedFrameCache,
  type ErasedRegion,
  type FramePlacement,
} from './erased-frame-cache.js';
import { PaletteRowsLut, type RecolourLut } from './palette-rows-lut.js';
import {
  colourRecolouredFrame,
  copyRecolour,
  frameImageData,
  RecolouredPageSource,
  recolourOf,
  registerRecolouredTexture,
} from './recoloured-pages.js';
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

/** CPU and GPU bytes of the cached RGBA copies of recoloured frames ({@link TextureCache.colouredView}). */
const COLOURED_COPY_BUDGET_BYTES = 16 * 1024 * 1024;
const RGBA = 4;

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
  private readonly groundedFeet = new GroundedFootCache();
  private readonly sinkFoot = (
    frame: AtlasFrame,
    image: Uint8ClampedArray,
    stride: number,
    pad: number,
  ): void => {
    const analysis = this.groundedFeet.analysisFromImage(frame, image, stride, pad, pad);
    if (analysis !== null) sinkBody(image, stride, pad, pad, analysis);
  };
  /** Sunk building bodies in the enhanced look, and in the page's own sampling. */
  private readonly groundedEnhanced = new BuildingTextureCache({ enhanced: true, rework: this.sinkFoot });
  private readonly groundedPlain = new BuildingTextureCache({ enhanced: false, rework: this.sinkFoot });
  private readonly softShadows = new SoftShadowCache();
  private readonly erasedFrames = new ErasedFrameCache();
  private useSoftShadows = false;
  private revision = 0;
  /** {@link revision} plus a bump after every frame whose bake budget ran out. */
  private retry = 0;
  private framesBegun = 0;
  private readonly cache = new Map<AtlasFrame, Texture>();
  /** Cast-silhouette views of the character frames that project onto the ground, kept out of
   *  {@link cache} so the same frame can draw both, keyed by how many of its top rows the view keeps. */
  private readonly casts = new Map<AtlasFrame, Map<number, Texture>>();
  /** Views of indexed character frames, drawn through a palette LUT; kept out of {@link pages} so the
   *  linear-sampling flip never reaches an indexed sheet, and out of {@link cache} since they need no
   *  magnification mark. */
  private readonly paletteIndexed = new Map<AtlasFrame, Texture>();
  /** RGBA copies of recoloured frames, for consumers that draw outside the world batch. */
  private readonly colouredCopies = new Map<AtlasFrame, Texture>();
  private colouredCopyBytes = 0;
  private readonly pages = new Set<TextureSource>();
  /** The silhouette pages among {@link pages}: coverage only, so a prescaler leaves them. */
  private readonly shadowPages = new Set<TextureSource>();
  /** Bottom-kept views of a frame, keyed by how many top pixels are hidden. Nested so the primary
   *  frame→texture cache above stays a clean 1:1. */
  private readonly cropCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** {@link cropCache}'s twin for indexed frames read through a LUT. */
  private readonly palettedCropCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** Top-kept views of a frame, keyed by how many top pixels are kept. */
  private readonly topCache = new Map<AtlasFrame, Map<number, Texture>>();
  /** Reveal bakes per frame, keyed by quantised threshold. */
  private readonly revealCache = new Map<AtlasFrame, Map<number, RevealBake>>();
  /** {@link unmagnified} twins, keyed by the view they copy. */
  private readonly unmagnifiedTwins = new Map<Texture, Texture>();

  /** The LUT recoloured frames draw through; the sheet's human palette LUT when it has one, so the
   *  world batch still reads one LUT. */
  private recolourLut: RecolourLut | undefined;
  /** The recoloured pages served so far: off {@link pages}, since no prescaler may redraw an index page,
   *  but under the world's sampling flip like them ({@link RecolouredPageSource.scaleMode}). */
  private readonly recolouredPages = new Set<TextureSource>();

  /** Views of a texture's frame grown by a margin of texels on every side, keyed by that texture, then
   *  by the margin. A view goes when its texture does. */
  private readonly grown = new Map<Texture, Map<number, Texture>>();

  /** Bumps whenever a bind of unchanged layers would pick other textures: a shadow or ground switch or
   *  a page sampling flip. A bake a budget turned away does not bump it: see {@link deferrals}. */
  get textureRevision(): number {
    return this.revision;
  }

  /** {@link textureRevision}, also bumped after a frame whose bake budget ran out: the signal for a
   *  consumer that cannot tell which of its binds received a stand-in, so it rebinds them all and the
   *  backlog drains a frame at a time. */
  get retryRevision(): number {
    return this.revision + this.retry;
  }

  /** Bake requests a spent budget has turned away so far. A bind that saw it grow drew a stand-in (a
   *  hard silhouette, a plain foot) and should ask again next frame. */
  get deferrals(): number {
    return this.softShadows.deferrals + this.groundedFeet.deferrals;
  }

  /** Opens a frame. The first frame bakes everything it shows, so a map opens with its soft shadows and
   *  grounded feet in place; later frames ration bakes. A bake the last frame's budget turned away bumps
   *  the revision, so the layers still holding hard silhouettes or plain feet rebind and the backlog
   *  drains a frame at a time. */
  beginFrame(): void {
    if (this.softShadows.deferredBakes || this.groundedFeet.deferredBakes) this.retry++;
    const budgeted = this.framesBegun > 0;
    this.framesBegun++;
    this.softShadows.beginFrame(budgeted);
    this.groundedFeet.beginFrame(budgeted);
  }

  /** Set before the first view of a recoloured frame is minted: every such view names this LUT. */
  setRecolourLut(lut: RecolourLut): void {
    this.recolourLut = lut;
  }

  /** The LUT {@link recolourRow} indexes, the one recoloured views draw through. */
  get recolourLutSource(): TextureSource {
    this.recolourLut ??= new PaletteRowsLut();
    return this.recolourLut.source;
  }

  /** The LUT row `frame` of `source` draws through, or -1 when it is no recoloured stem's frame. */
  recolourRow(source: TextureSource, frame: AtlasFrame): number {
    const palette = source instanceof RecolouredPageSource ? recolourOf(frame) : undefined;
    if (palette === undefined) return -1;
    this.recolourLut ??= new PaletteRowsLut();
    return this.recolourLut.fixedRow(palette);
  }

  /**
   * A view of `rect` of `frame`'s page: a recoloured frame's view draws through its stem's LUT row
   * and stays off the prescaled, sampling-flipped pages, as an indexed character's does; any other
   * view joins {@link pages} and magnifies like the original's sprites.
   */
  private frameView(source: TextureSource, frame: AtlasFrame, rect: Rectangle): Texture {
    const tex = new Texture({ source, frame: rect });
    const palette = source instanceof RecolouredPageSource ? recolourOf(frame) : undefined;
    if (palette !== undefined) {
      this.recolourLut ??= new PaletteRowsLut();
      markPalettedTexture(tex, this.recolourLut.source, this.recolourLut.fixedRow(palette));
      registerRecolouredTexture(tex, palette);
      markMagnifiedTexture(tex);
      this.recolouredPages.add(source);
      return tex;
    }
    markMagnifiedTexture(tex);
    this.pages.add(source);
    return tex;
  }

  /**
   * `frame` on a page holding colours, for a consumer that draws it outside the world batch's palette
   * path (its own shader, Pixi's default batcher): a recoloured frame gets an RGBA copy of the frame
   * alone, any other frame its {@link get} view.
   */
  colouredView(source: TextureSource, frame: AtlasFrame): Texture {
    const palette = source instanceof RecolouredPageSource ? recolourOf(frame) : undefined;
    if (palette === undefined || !(source instanceof RecolouredPageSource)) return this.get(source, frame);
    let copy = this.colouredCopies.get(frame);
    if (copy !== undefined) {
      this.colouredCopies.delete(frame);
      this.colouredCopies.set(frame, copy);
      return copy;
    }
    copy = colouredCopy(source, frame, palette) ?? Texture.EMPTY;
    this.colouredCopies.set(frame, copy);
    this.colouredCopyBytes += frame.width * frame.height * RGBA;
    // Past the budget the oldest copies leave the cache without being destroyed: a sign or a collapse
    // still drawing one keeps it, and Pixi's idle GC unloads its GPU copy once nothing draws it.
    for (const old of this.colouredCopies.keys()) {
      if (this.colouredCopyBytes <= COLOURED_COPY_BUDGET_BYTES || old === frame) break;
      this.colouredCopies.delete(old);
      this.colouredCopyBytes -= old.width * old.height * RGBA;
    }
    return copy;
  }

  setSoftShadows(enabled: boolean): void {
    if (this.useSoftShadows === enabled) return;
    this.useSoftShadows = enabled;
    this.revision++;
  }

  /** The world pages' sampling flipped: copies that follow a page's sampling pick it up on their next
   *  bind. */
  pageSamplingChanged(): void {
    this.revision++;
  }

  /** The ground buildings set their feet into; null draws every building as the original. */
  setGroundColours(ground: GroundColours | null): void {
    this.groundedFeet.setGround(ground);
    this.revision++;
  }

  /** A frame of a silhouette (`_s`) atlas. That page serves nothing else, so the returned view is marked
   *  for the batch shader's shadow shading whichever branch produced it. */
  getShadow(source: TextureSource, frame: AtlasFrame): Texture {
    const texture =
      (this.useSoftShadows ? this.softShadows.get(source, frame) : null) ?? this.get(source, frame);
    this.shadowPages.add(source);
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

  /** `texture`'s frame grown by `margin` texels on every side, over the same page: a selection outline's
   *  quad around its body. The grown frame may reach past the page; nothing samples it there. */
  grownView(texture: Texture, margin: number): Texture {
    let byMargin = this.grown.get(texture);
    if (byMargin === undefined) {
      byMargin = new Map();
      this.grown.set(texture, byMargin);
      texture.once('destroy', this.dropGrown, this);
    }
    let view = byMargin.get(margin);
    if (view === undefined) {
      const { x, y, width, height } = texture.frame;
      view = new Texture({
        source: texture.source,
        frame: new Rectangle(x - margin, y - margin, width + 2 * margin, height + 2 * margin),
      });
      byMargin.set(margin, view);
    }
    return view;
  }

  private dropGrown(texture: Texture): void {
    for (const view of this.grown.get(texture)?.values() ?? []) view.destroy();
    this.grown.delete(texture);
  }

  /** A frame of a palette-indexed sheet, marked to draw through `lut` in the world batch shader. Each
   *  frame belongs to one sheet, and each sheet reads one LUT. */
  palettedFrame(source: TextureSource, frame: AtlasFrame, lut: TextureSource): Texture {
    let tex = this.paletteIndexed.get(frame);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      });
      markPalettedTexture(tex, lut);
      this.paletteIndexed.set(frame, tex);
    }
    return tex;
  }

  /** {@link palettedFrame} with its top `hiddenTop` rows cut away, as {@link cropped} does a plain frame. */
  palettedCropped(source: TextureSource, frame: AtlasFrame, lut: TextureSource, hiddenTop: number): Texture {
    const top = clamp(Math.round(hiddenTop), 0, frame.height);
    if (top === 0) return this.palettedFrame(source, frame, lut);
    let byTop = this.palettedCropCache.get(frame);
    if (byTop === undefined) {
      byTop = new Map();
      this.palettedCropCache.set(frame, byTop);
    }
    let tex = byTop.get(top);
    if (tex === undefined) {
      tex = new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y + top, frame.width, frame.height - top),
      });
      markPalettedTexture(tex, lut);
      byTop.set(top, tex);
    }
    return tex;
  }

  /**
   * One part of a building frame set into the ground, drawn at `scale` with its feet at the lifted
   * pre-camera point `(x, y)`: strip `strip` of the ground's shade, the sunk body in the enhanced or the
   * page's own look, or strip `strip` of the cover over its foot; an overlay's strips together draw it
   * whole. Null draws the part as the original would: a plain body, no shade, no cover.
   */
  groundedPart(
    part: GroundFootPart,
    source: TextureSource,
    frame: AtlasFrame,
    scale: number,
    x: number,
    y: number,
    enhanced: boolean,
    strip = 0,
  ): Texture | null {
    const overlays = this.groundedFeet.overlaysAt(source, frame, scale, x, y);
    if (overlays === null) return null;
    // An overlay without its sunk body would shade a foot that still stands on the ground.
    const body = (enhanced ? this.groundedEnhanced : this.groundedPlain).get(source, frame);
    if (body === null) return null;
    if (part === 'body') return body;
    return (part === 'shade' ? overlays.shade : overlays.cover)?.[strip] ?? null;
  }

  /** `frame` copied onto a page of its own with `region` cleared, served like an atlas frame; null when
   *  the region misses the frame or its pixels are unreadable. */
  erased(
    source: TextureSource,
    frame: AtlasFrame,
    region: ErasedRegion,
    placement: FramePlacement,
  ): ErasedFrame | null {
    return this.erasedFrames.get(source, frame, region, placement);
  }

  getBuilding(source: TextureSource, frame: AtlasFrame): Texture {
    return this.buildings.get(source, frame) ?? this.get(source, frame);
  }

  get(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.cache.get(frame);
    if (tex === undefined) {
      tex = this.frameView(source, frame, new Rectangle(frame.x, frame.y, frame.width, frame.height));
      this.cache.set(frame, tex);
    }
    return tex;
  }

  /** Serve an app-loaded world texture as a page of its own: it follows the zoom's sampling flip and,
   *  loaded as pixel art, magnifies like the original's sprites. The caller keeps ownership. */
  adopt(texture: Texture): void {
    markMagnifiedTexture(texture);
    this.pages.add(texture.source);
  }

  /** The distinct atlas pages served so far: world RGB and shadow bob atlases only. Paletted character
   *  frames stay off it, and a reveal bake's own `CanvasSource` is never registered here, so a
   *  sampling toggle cannot reach an indexed sheet, whose palette indices must stay nearest-sampled. */
  pageSources(): ReadonlySet<TextureSource> {
    return this.pages;
  }

  /** The recoloured pages served so far, which the world's sampling flip sets as it sets {@link pages}. */
  recolouredPageSources(): ReadonlySet<TextureSource> {
    return this.recolouredPages;
  }

  /** Whether a page prescaler may redraw `source`: a body page loaded as pixel art (never a silhouette
   *  page, and never art a presentation pack loaded with its own sampling) or an enhanced building bake
   *  cut from such a page. */
  isPrescalable(source: TextureSource): boolean {
    if (this.pages.has(source)) return !this.shadowPages.has(source) && isPixelArtSource(source);
    return this.buildings.isPixelArtBake(source) || this.groundedEnhanced.isPixelArtBake(source);
  }

  /** A twin of a view served here, on the same page and frame but without the magnification mark: the
   *  world shader reads it with one plain sampler tap, no magnifier. */
  unmagnified(texture: Texture): Texture {
    let twin = this.unmagnifiedTwins.get(texture);
    if (twin === undefined) {
      twin = new Texture({ source: texture.source, frame: texture.frame.clone() });
      copyRecolour(texture, twin);
      this.unmagnifiedTwins.set(texture, twin);
    }
    return twin;
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
      tex = this.frameView(
        source,
        frame,
        new Rectangle(frame.x, frame.y + top, frame.width, frame.height - top),
      );
      byTop.set(top, tex);
    }
    return tex;
  }

  /** A view of `frame` keeping only its top `rows` pixels, the upper part of a mark split around a body
   *  it partly stands behind. `rows` is clamped like {@link cropped}'s count, and the view shares the page. */
  topRows(source: TextureSource, frame: AtlasFrame, rows: number): Texture {
    const kept = clamp(Math.round(rows), 0, frame.height);
    let byRows = this.topCache.get(frame);
    if (byRows === undefined) {
      byRows = new Map();
      this.topCache.set(frame, byRows);
    }
    let tex = byRows.get(kept);
    if (tex === undefined) {
      tex = this.frameView(source, frame, new Rectangle(frame.x, frame.y, frame.width, kept));
      byRows.set(kept, tex);
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
    const texture = this.bakeReveal(source, frame, times, q);
    if (texture === null) return null;
    const bake: RevealBake = { texture, stamp: frameStamp };
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

  /**
   * An uncached {@link revealed} bake at the exact `threshold`, owned by the caller, who destroys it with
   * `destroy(true)`: a transient that must outlive the cache's per-frame eviction. `null` when the pixels
   * are not CPU-readable.
   */
  bakeReveal(
    source: TextureSource,
    frame: AtlasFrame,
    times: BuildTimeSheet,
    threshold: number,
  ): Texture | null {
    const canvas = bakeRevealCanvas(source, frame, times, threshold);
    if (canvas === null) return null;
    const baked = new CanvasSource({
      resource: canvas,
      scaleMode: source.scaleMode,
      autoGenerateMipmaps: source.autoGenerateMipmaps,
    });
    const texture = new Texture({ source: baked });
    markMagnifiedTexture(texture, source);
    return texture;
  }

  /** Destroy every cached texture. Dropping the map entry is not enough: a Pixi `Texture` registers a
   *  `resize` listener on its source, so the app-owned atlas page keeps it alive until `destroy`
   *  unregisters it. Sub-rect views destroy at Pixi's default `destroySource: false` so the app-owned
   *  page outlives the renderer; the reveal bakes own their canvas source and take it with them. */
  clear(): void {
    this.buildings.clear();
    this.groundedEnhanced.clear();
    this.groundedPlain.clear();
    this.groundedFeet.clear();
    this.softShadows.clear();
    for (const tex of this.cache.values()) tex.destroy();
    this.cache.clear();
    for (const byRows of this.casts.values()) {
      for (const tex of byRows.values()) tex.destroy();
    }
    this.casts.clear();
    for (const [texture, byMargin] of this.grown) {
      texture.off('destroy', this.dropGrown, this);
      for (const view of byMargin.values()) view.destroy();
    }
    this.grown.clear();
    for (const tex of this.paletteIndexed.values()) tex.destroy();
    this.paletteIndexed.clear();
    for (const copy of this.colouredCopies.values()) if (copy !== Texture.EMPTY) copy.destroy(true);
    this.colouredCopies.clear();
    this.colouredCopyBytes = 0;
    for (const byTop of this.cropCache.values()) {
      for (const tex of byTop.values()) tex.destroy();
    }
    this.cropCache.clear();
    for (const byTop of this.palettedCropCache.values()) {
      for (const tex of byTop.values()) tex.destroy();
    }
    this.palettedCropCache.clear();
    for (const byRows of this.topCache.values()) {
      for (const tex of byRows.values()) tex.destroy();
    }
    this.topCache.clear();
    for (const twin of this.unmagnifiedTwins.values()) twin.destroy();
    this.unmagnifiedTwins.clear();
    this.pages.clear();
    this.shadowPages.clear();
    this.recolouredPages.clear();
    for (const byThreshold of this.revealCache.values()) {
      for (const bake of byThreshold.values()) bake.texture.destroy(true);
    }
    this.revealCache.clear();
    // After the views minted on their pages.
    this.erasedFrames.clear();
  }
}

/** `frame` coloured through `palette` onto a canvas page of its own, marked as pixel art like its
 *  atlas page; null without a 2d context. */
function colouredCopy(page: RecolouredPageSource, frame: AtlasFrame, palette: Uint8Array): Texture | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const ctx = readable2dContext(frame.width, frame.height);
  if (ctx === null) return null;
  const image = ctx.createImageData(frame.width, frame.height);
  colourRecolouredFrame(page, frame, palette, image.data);
  ctx.putImageData(image, 0, 0);
  const source = new CanvasSource({ resource: ctx.canvas, scaleMode: page.scaleMode });
  markPixelArtSource(source);
  const texture = new Texture({ source });
  markMagnifiedTexture(texture);
  return texture;
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
  const ctx = readable2dContext(frame.width, frame.height);
  if (ctx === null) return null;
  try {
    const img = frameImageData(ctx, source, frame, 0, 0);
    if (img === null) return null;
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
