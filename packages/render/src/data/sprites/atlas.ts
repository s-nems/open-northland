/**
 * The atlas geometry half of the sprite layer: the frame-rect shapes a `.bmd`→atlas build produces,
 * re-declared structurally here so `render` never imports the build-tool pipeline, plus the pure
 * manifest → in-memory-index adaptation. The image bytes themselves live on the GPU side (a texture);
 * this is just the frame geometry. Frame *selection* (which bob id to draw) lives in
 * {@link import('./resolve.js')} and friends.
 */

/**
 * One bob frame's placement in an atlas sheet, plus the draw offset to apply when placing it at a
 * sprite's feet anchor. This is the subset of the build pipeline's `AtlasFrame` a renderer needs to
 * blit one frame; re-declared here (structurally) so `render` depends only on plain data, never on the
 * build-tool that produced the atlas.
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
 * A loaded sprite atlas: the atlas sheet's pixel dimensions plus its frames indexed by bob id. The
 * shape mirrors the build pipeline's `AtlasManifest` (dimensions + per-bob frames), reduced to what the
 * renderer needs and keyed for O(1) lookup by the bob id the binding table references. The image bytes
 * themselves live on the GPU side (a texture); this is just the frame geometry.
 */
export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  /** Frames by bob id (`bmd.firstBobId + index` from the build manifest). */
  readonly frames: ReadonlyMap<number, AtlasFrame>;
}

/**
 * Look up a bob frame in an atlas, treating a MISSING or ZERO-AREA frame as absent (`null`). A 0×0 frame
 * is an empty/zero-size bob; every reader wants the same "no drawable frame here → draw the placeholder /
 * skip the layer" answer, so the emptiness test lives here once instead of being re-inlined at each atlas
 * read across the frame-selection and GPU layer-resolution paths. Pure.
 */
export function lookupFrame(atlas: SpriteAtlas, id: number): AtlasFrame | null {
  const frame = atlas.frames.get(id);
  return frame === undefined || frame.width === 0 || frame.height === 0 ? null : frame;
}

/**
 * Build the bob-id → {@link AtlasFrame} map a {@link SpriteAtlas} needs from a flat manifest frame list
 * (the `{ bobId, rect, offsetX, offsetY }` records a `.bmd`→atlas build emits). Pure: a deterministic
 * fold, last-writer-wins on a duplicate bob id (the build emits one entry per id, so duplicates don't
 * occur — the guard just keeps the function total). Separated from
 * {@link import('./resolve.js').resolveSpriteFrame} so the (one-time) manifest→map adaptation is
 * testable on its own.
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
 * One frame record in the on-disk `.bmd`→atlas manifest (`<name>.atlas.json`) the pipeline emits.
 * It carries more than the renderer needs (`type`/`opaque` describe the source bob, not its placement);
 * {@link atlasFromManifest} keeps only the rect + draw offset {@link indexAtlasFrames} indexes by.
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
 * The on-disk atlas manifest shape — the JSON a `.bmd`→atlas build writes alongside the atlas PNG
 * (`{ width, height, frames }`). Mirrors the pipeline's `AtlasManifest`; re-declared structurally here
 * so `render` parses a decoded manifest into its in-memory {@link SpriteAtlas} without importing the
 * build tool (the same one-way "plain data only" boundary the rest of this layer keeps).
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
 * row-major 0–255 per-pixel thresholds over the WHOLE sheet, sampled at atlas coordinates — a pixel
 * first appears when construction progress reaches its threshold (the original's TimeMask byte,
 * OpenVikings CBobManager `PrintBob_UsingTimeMask`). Values at transparent atlas pixels are meaningless
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
 * {@link SpriteAtlas} the GPU layer looks frames up in. A thin pure wrapper over {@link indexAtlasFrames}
 * — the seam where a real, decoded bob atlas enters the renderer, the analogue of
 * {@link import('../../gpu/synthetic-atlas.js').syntheticAtlasFrames} for the synthetic one. The matching atlas
 * *image* is loaded separately on the GPU side ({@link import('../../gpu/pixi-app.js').loadAtlasSource}).
 */
export function atlasFromManifest(manifest: AtlasManifest): SpriteAtlas {
  return indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
}
