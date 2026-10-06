import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { isDrawableResource, readable2dContext } from '../drawable-resource.js';
import { analyseFoot, type FootAnalysis } from './foot-analysis.js';
import { bakeFootCover, bakeGroundShade, type FootBake } from './foot-bakes.js';
import { type FootGround, footGround, type GroundColours } from './foot-ground.js';

const RGBA = 4;
/** Overlay bytes retained on the GPU across every frame and ground, plus as much again in CPU canvas
 *  copies. Past it a new foot draws as the original: evicting could strand a pooled sprite. */
const MAX_GPU_BYTES = 32 * 1024 * 1024;
/** Frame pixels one budgeted frame may analyse and bake. A bake is synchronous, so without a ceiling
 *  switching the enhancement on over a settled town would bake every visible foot at once. A frame's first
 *  bake always runs, so a backlog always drains. */
const MAX_BAKE_PIXELS_PER_FRAME = 256 * 256;

/** What one feet position of a frame drew with. */
interface Spot {
  readonly scale: number;
  readonly overlays: GroundedOverlays | null;
}

/** A layer's part in setting a building's foot into the ground, in paint order: the ground's shade under
 *  the body's cast shadow, the sunk body, and the cover over its foot. */
export type GroundFootPart = 'shade' | 'body' | 'cover';

/** The two overlays that set one drawn frame into the ground at one spot. */
export interface GroundedOverlays {
  /** The ground's shade around the foot, drawn under the body. */
  readonly shade: Texture | null;
  /** The stain, tufts or drift over the foot, drawn over the body. */
  readonly cover: Texture | null;
}

/**
 * The analysis of each building frame's foot and the overlays baked for each ground it stands on. The
 * overlays are keyed by the quantized ground colours along the foot, so feet on like ground share them.
 */
export class GroundedFootCache {
  private ground: GroundColours | null = null;
  private readonly analyses = new WeakMap<AtlasFrame, FootAnalysis | null>();
  /** Per frame, by feet x then y: numbers, so a hit allocates nothing. */
  private readonly spots = new Map<AtlasFrame, Map<number, Map<number, Spot>>>();
  /** Per frame, by {@link FootGround.key}; owns the textures. */
  private readonly baked = new Map<AtlasFrame, Map<string, GroundedOverlays | null>>();
  private gpuBytes = 0;
  private framePixels = 0;
  /** Whether the open frame is held to {@link MAX_BAKE_PIXELS_PER_FRAME}. */
  private budgeted = false;
  private deferred = false;
  /** Requests a spent budget turned away, ever; see {@link SoftShadowCache.deferrals}. */
  deferrals = 0;
  // The last spot asked for: a body and its two overlays ask for the same one in a row.
  private lastFrame: AtlasFrame | null = null;
  private lastScale = 0;
  private lastX = 0;
  private lastY = 0;
  private lastOverlays: GroundedOverlays | null = null;

  /** Whether the frame just drawn ran out of bake budget, so some feet still draw plain and need asking
   *  again. */
  get deferredBakes(): boolean {
    return this.deferred;
  }

  /** Opens a drawn frame; an unbudgeted one bakes every foot it asks for. */
  beginFrame(budgeted: boolean): void {
    this.budgeted = budgeted;
    this.framePixels = 0;
    this.deferred = false;
  }

  /** The ground the feet take their colours from; null draws every foot as the original. */
  setGround(ground: GroundColours | null): void {
    if (this.ground === ground) return;
    this.ground = ground;
    this.forgetSpots();
  }

  /** The analysis of a frame's foot from its isolated RGBA copy, or null when it stands on no ground line. */
  analysisFromImage(
    frame: AtlasFrame,
    image: Uint8ClampedArray,
    stride: number,
    offsetX: number,
    offsetY: number,
  ): FootAnalysis | null {
    const known = this.analyses.get(frame);
    if (known !== undefined) return known;
    const analysis = analyseFoot(image, stride, offsetX, offsetY, frame.width, frame.height);
    this.analyses.set(frame, analysis);
    return analysis;
  }

  /**
   * The overlays for `frame` drawn at `scale` with its feet at the lifted pre-camera point `(x, y)`, or
   * null to draw it as the original: no ground, no ground line in the art, unreadable pixels, a spent
   * budget.
   */
  overlaysAt(
    source: TextureSource,
    frame: AtlasFrame,
    scale: number,
    x: number,
    y: number,
  ): GroundedOverlays | null {
    const ground = this.ground;
    if (ground === null) return null;
    if (frame === this.lastFrame && scale === this.lastScale && x === this.lastX && y === this.lastY) {
      return this.lastOverlays;
    }
    let byX = this.spots.get(frame);
    if (byX === undefined) {
      byX = new Map();
      this.spots.set(frame, byX);
    }
    let byY = byX.get(x);
    if (byY === undefined) {
      byY = new Map();
      byX.set(x, byY);
    }
    const spot = byY.get(y);
    let overlays: GroundedOverlays | null;
    if (spot !== undefined && spot.scale === scale) {
      overlays = spot.overlays;
    } else {
      const resolved = this.resolve(source, frame, scale, x, y, ground);
      if (resolved === undefined) return null; // deferred to a later frame
      overlays = resolved;
      byY.set(y, { scale, overlays });
    }
    this.lastFrame = frame;
    this.lastScale = scale;
    this.lastX = x;
    this.lastY = y;
    this.lastOverlays = overlays;
    return overlays;
  }

  /** Undefined when this frame's bake budget is spent. */
  private resolve(
    source: TextureSource,
    frame: AtlasFrame,
    scale: number,
    x: number,
    y: number,
    ground: GroundColours,
  ): GroundedOverlays | null | undefined {
    let analysis = this.analyses.get(frame);
    if (analysis === undefined) {
      if (!this.spend(frame.width * frame.height)) return undefined;
      const pixels = readFrame(source, frame);
      analysis = pixels === null ? null : analyseFoot(pixels, frame.width, 0, 0, frame.width, frame.height);
      this.analyses.set(frame, analysis);
    }
    if (analysis === null) return null;
    const underFoot = footGround(analysis, frame, scale, x, y, ground);
    if (underFoot === null) return null;
    let byGround = this.baked.get(frame);
    if (byGround === undefined) {
      byGround = new Map();
      this.baked.set(frame, byGround);
    }
    const known = byGround.get(underFoot.key);
    if (known !== undefined) return known;
    if (!this.spend(frame.width * frame.height)) return undefined;
    const overlays = this.bake(frame, analysis, underFoot);
    byGround.set(underFoot.key, overlays);
    return overlays;
  }

  private bake(frame: AtlasFrame, analysis: FootAnalysis, underFoot: FootGround): GroundedOverlays | null {
    const shade = bakeGroundShade(analysis, underFoot);
    const cover = bakeFootCover(analysis, underFoot);
    const bytes =
      RGBA * ((shade?.width ?? 0) * (shade?.height ?? 0) + (cover?.width ?? 0) * (cover?.height ?? 0));
    if (this.gpuBytes + bytes > MAX_GPU_BYTES) return null;
    const shadeTexture = shade === null ? null : overlayTexture(frame, shade);
    const coverTexture = cover === null ? null : overlayTexture(frame, cover);
    if ((shade !== null && shadeTexture === null) || (cover !== null && coverTexture === null)) {
      shadeTexture?.destroy(true);
      coverTexture?.destroy(true);
      return null;
    }
    this.gpuBytes += bytes;
    return { shade: shadeTexture, cover: coverTexture };
  }

  private spend(pixels: number): boolean {
    if (this.budgeted && this.framePixels > 0 && this.framePixels + pixels > MAX_BAKE_PIXELS_PER_FRAME) {
      this.deferred = true;
      this.deferrals++;
      return false;
    }
    this.framePixels += pixels;
    return true;
  }

  private forgetSpots(): void {
    this.spots.clear();
    this.lastFrame = null;
    this.lastOverlays = null;
  }

  clear(): void {
    this.forgetSpots();
    for (const byGround of this.baked.values()) {
      for (const overlays of byGround.values()) {
        overlays?.shade?.destroy(true);
        overlays?.cover?.destroy(true);
      }
    }
    this.baked.clear();
    this.gpuBytes = 0;
  }
}

/** One atlas frame's straight-alpha RGBA pixels, or null when its page cannot be read back. */
function readFrame(source: TextureSource, frame: AtlasFrame): Uint8ClampedArray | null {
  const resource: unknown = source.resource;
  if (!isDrawableResource(resource)) return null;
  const read = readable2dContext(frame.width, frame.height);
  if (read === null) return null;
  try {
    read.drawImage(resource, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    return read.getImageData(0, 0, frame.width, frame.height).data;
  } catch {
    return null;
  }
}

/** An overlay texture framed like its body frame, so it shares the body's feet anchor. */
function overlayTexture(frame: AtlasFrame, bake: FootBake): Texture | null {
  const write = readable2dContext(bake.width, bake.height);
  if (write === null) return null;
  try {
    write.putImageData(new ImageData(bake.pixels, bake.width, bake.height), 0, 0);
    return new Texture({
      // The source's resolution scales a lower-resolution bake back up to frame px.
      source: new CanvasSource({ resource: write.canvas, scaleMode: 'linear', resolution: bake.resolution }),
      orig: new Rectangle(0, 0, frame.width, frame.height),
      trim: new Rectangle(bake.left, bake.top, bake.width / bake.resolution, bake.height / bake.resolution),
    });
  } catch {
    return null;
  }
}
