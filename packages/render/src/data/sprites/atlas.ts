/**
 * The atlas geometry half of the sprite layer: the frame-rect shapes a `.bmd`→atlas build produces,
 * re-declared structurally here so `render` never imports the build-tool pipeline, plus the pure
 * manifest → in-memory-index adaptation. The image bytes live on the GPU side (a texture); this is
 * just the frame geometry. Frame *selection* (which bob id to draw) lives in
 * {@link import('./resolve.js')} and friends.
 */

/**
 * One bob frame's placement in an atlas sheet, plus the draw offset to apply when placing it at a
 * sprite's feet anchor.
 */
export interface AtlasFrame {
  /** Pixel rect of the frame inside the atlas sheet (top-left origin). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * The frame's source draw offset (the original's `SBobData.Area` origin). The GPU layer adds this to
   * the sprite's feet-anchor screen position so the frame sits where the bob was authored to.
   */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * A loaded sprite atlas: the atlas sheet's pixel dimensions plus its frames keyed for O(1) lookup by
 * the bob id the binding table references.
 */
export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  /** Frames by bob id (`bmd.firstBobId + index` from the build manifest). */
  readonly frames: ReadonlyMap<number, AtlasFrame>;
}

/**
 * Look up a bob frame in an atlas, treating a missing or zero-area frame as absent (`null`). A 0×0
 * frame is an empty/zero-size bob, which every reader handles the same way as a missing one.
 */
export function lookupFrame(atlas: SpriteAtlas, id: number): AtlasFrame | null {
  const frame = atlas.frames.get(id);
  return frame === undefined || frame.width === 0 || frame.height === 0 ? null : frame;
}

/**
 * Build the bob-id → {@link AtlasFrame} map a {@link SpriteAtlas} needs from a flat manifest frame list
 * (the `{ bobId, rect, offsetX, offsetY }` records a `.bmd`→atlas build emits). Pure; last-writer-wins
 * on a duplicate bob id, which the build does not emit.
 */
export function indexAtlasFrames(
  width: number,
  height: number,
  manifestFrames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly offsetX: number;
    readonly offsetY: number;
  }[],
): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of manifestFrames) {
    frames.set(f.bobId, {
      x: f.rect.x,
      y: f.rect.y,
      width: f.rect.width,
      height: f.rect.height,
      offsetX: f.offsetX,
      offsetY: f.offsetY,
    });
  }
  return { width, height, frames };
}

/**
 * One frame record in the on-disk `.bmd`→atlas manifest (`<name>.atlas.json`) the pipeline emits,
 * narrowed to the rect + draw offset {@link indexAtlasFrames} indexes by (the manifest's `type`/`opaque`
 * describe the source bob, not its placement).
 */
export interface AtlasManifestFrame {
  readonly bobId: number;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The on-disk atlas manifest shape — the JSON a `.bmd`→atlas build writes alongside the atlas PNG.
 * Re-declared structurally so `render` parses it into a {@link SpriteAtlas} without importing the
 * build tool.
 */
export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasManifestFrame[];
  /** `true` when the build emitted a sibling `<stem>.build.png` time sheet (a `'build-time'` house
   *  bake) — the loader's cue to fetch it into a {@link BuildTimeSheet}. */
  readonly build?: boolean;
}

/**
 * CPU-side copy of an atlas's build-progress time sheet (the `'build-time'` bake's `<stem>.build.png`):
 * row-major 0–255 per-pixel thresholds over the whole sheet, sampled at atlas coordinates — a pixel
 * first appears when construction progress reaches its threshold (the original's time-mask byte).
 * Values at transparent atlas pixels are meaningless
 * (the colour sheet's alpha already gates them).
 */
export interface BuildTimeSheet {
  readonly width: number;
  readonly height: number;
  /** The sheet's R channel, `width * height` bytes. */
  readonly values: Uint8Array;
}

/**
 * Adapt a decoded {@link AtlasManifest} (parsed from a `<name>.atlas.json`) into the in-memory
 * {@link SpriteAtlas} the GPU layer looks frames up in. Pure; the matching atlas *image* is loaded
 * separately on the GPU side ({@link import('../../gpu/pixi-app.js').loadAtlasSource}).
 */
export function atlasFromManifest(manifest: AtlasManifest): SpriteAtlas {
  return indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
}
