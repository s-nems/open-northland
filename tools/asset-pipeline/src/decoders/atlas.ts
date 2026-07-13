/**
 * Bob atlas packer — turns a decoded `.bmd` (CBobManager) bob set into one RGBA atlas image plus a
 * JSON-serializable manifest of per-bob frame rects + metadata. This is the second half of the
 * `.bmd` → "atlas PNG + anim JSON" pipeline stage: {@link import('./bmd.js').decodeBobFrame} yields a
 * bob's indexed pixels + opacity mask; this module colours them with a palette and shelf-packs every
 * frame into a single sheet so a renderer loads one texture and looks each sprite up by rect.
 *
 * Not a ported format. A `.bmd` has no atlas/anim layout of its own — it is a flat array of bobs
 * ({type, area, misc}); animation *grouping* lives outside it (the `.ini`/`tribetypes` `setatomic`
 * bindings reference bob ids, joined in a later stage). So the manifest here is faithfully a per-bob
 * **frame** table: each entry carries the bob's id (`firstBobId + index`), its packed rect in the
 * atlas, the bob's source `area` (the draw anchor / offset a renderer needs to place the sprite), the
 * raw bob `type`, and whether it produced any opaque pixels. Empty/zero-size bobs are recorded with a
 * 0×0 rect so a consumer can still index every bob id without a gap.
 *
 * Packing is a deterministic top-left shelf/row packer (frames placed left→right into rows of a fixed
 * max width, wrapping to a new row when the current one is full), with a 1px transparent gutter so
 * bilinear sampling can't bleed neighbours. It is intentionally simple, not optimal — the atlas is a
 * build artifact, and a stable, obvious layout makes the manifest easy to diff and verify against the
 * OpenVikings oracle. Transparency: index 0 is a *real* palette colour for bobs (unlike a reserved
 * colour-key), so alpha comes from each frame's `mask`, never from the index.
 *
 * Pure functions only (no I/O). The CLI wires file reads + `encodePng` + JSON writes around them.
 */

import type { Bmd, BobFrame } from './bmd.js';
import { BOB_ALPHA_OPAQUE, decodeBobFrame } from './bmd.js';
import { PALETTE_RGB_BYTES, type RgbaImage } from './image.js';

/** Transparent gutter (in pixels) left between packed frames so sampling can't bleed across them. */
export const ATLAS_GUTTER = 1;

/** Default atlas width the shelf packer wraps at; frames wider than this still fit (they get their own row). */
export const DEFAULT_ATLAS_MAX_WIDTH = 1024;

/** One frame's placement + metadata in the atlas. JSON-serializable (plain numbers/booleans only). */
export interface AtlasFrame {
  /** The bob's stable id: `bmd.firstBobId + index`. The join key for anim bindings in a later stage. */
  readonly bobId: number;
  /** Raw bob `type` (0 empty / 1 8-bit / 2 1-bit mask / 3 TimeMask / 4 double-byte). Carried, not interpreted. */
  readonly type: number;
  /** Pixel rect of this frame inside the atlas. `width`/`height` are 0 for an empty/zero-size bob. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /**
   * The bob's source draw rectangle (offset + size) from the `.bmd`. A renderer adds `offsetX/Y` to the
   * sprite's screen anchor to place the frame; the original keeps this as `SBobData.Area`.
   */
  readonly offsetX: number;
  readonly offsetY: number;
  /** True if the frame wrote at least one visible pixel (an all-transparent or empty frame is `false`). */
  readonly opaque: boolean;
}

/** The JSON manifest emitted alongside the atlas PNG: atlas dimensions + one entry per bob, in id order. */
export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasFrame[];
}

/** A packed atlas: the RGBA sheet to PNG-encode plus its manifest to write as JSON. */
export interface BobAtlas {
  readonly image: RgbaImage;
  readonly manifest: AtlasManifest;
}

/**
 * Colours one decoded {@link BobFrame} into straight RGBA using a 256-entry palette (768 RGB bytes,
 * `[R,G,B] × 256`, the shared currency from `pcx`/`palette`). Alpha is the frame's `mask` value: an
 * unwritten pixel is fully transparent (RGB 0 too); a written one carries its 0–255 coverage — 255 for
 * the single-byte bob types, the per-pixel alpha byte for Double8Bit decals (ferns, smoke, wave foam;
 * see `BOB_TYPE_DOUBLE8BIT`). Throws (with an `atlas:` prefix) if the palette isn't exactly 768 bytes —
 * a programmer error, since decoded palettes always are.
 */
export function expandBobFrame(frame: BobFrame, palette: Uint8Array): RgbaImage {
  if (palette.length !== PALETTE_RGB_BYTES) {
    throw new Error(
      `atlas: palette must be ${PALETTE_RGB_BYTES} bytes (256 RGB triples), got ${palette.length}`,
    );
  }
  const { width, height, pixels, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const coverage = mask[i] ?? 0;
    if (coverage === 0) continue; // transparent: leave RGBA all-zero
    const p = (pixels[i] ?? 0) * 3;
    const o = i * 4;
    rgba[o] = palette[p] ?? 0;
    rgba[o + 1] = palette[p + 1] ?? 0;
    rgba[o + 2] = palette[p + 2] ?? 0;
    rgba[o + 3] = coverage;
  }
  return { width, height, rgba };
}

/**
 * Expands one decoded {@link BobFrame} into an **indexed** RGBA image: the palette INDEX in the red
 * channel, `mask` in alpha, green/blue left 0. No palette is applied — the colour is deferred to the
 * renderer, which reads each index through a per-player palette LUT (see `player-palette.ts`). This is
 * the alternative to {@link expandBobFrame} for the character bodies, whose clothing band must be
 * recoloured per player at draw time. A written pixel carries its real index (index 0 is a valid colour
 * for bobs) with the frame's 0–255 coverage as alpha; an unwritten pixel is fully transparent
 * (all-zero), so the index is only read where alpha is set. NOTE the indexed PACKER
 * ({@link packIndexedBobAtlas}) flattens coverage before this runs — see its doc for why.
 */
export function expandBobFrameIndexed(frame: BobFrame): RgbaImage {
  const { width, height, pixels, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const coverage = mask[i] ?? 0;
    if (coverage === 0) continue; // transparent: leave RGBA all-zero
    const o = i * 4;
    rgba[o] = pixels[i] ?? 0; // palette index → red channel (G/B stay 0)
    rgba[o + 3] = coverage;
  }
  return { width, height, rgba };
}

/** Blits a source RGBA image into `dst` at (`dx`,`dy`). Caller guarantees the source fits inside `dst`. */
function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  const dstStride = dst.width * 4;
  const srcStride = src.width * 4;
  for (let y = 0; y < src.height; y++) {
    const from = y * srcStride;
    const to = (dy + y) * dstStride + dx * 4;
    dst.rgba.set(src.rgba.subarray(from, from + srcStride), to);
  }
}

/** A frame's pre-packing record: its coloured pixels (or `undefined` if 0×0) plus the metadata to emit. */
interface PreparedFrame {
  readonly bobId: number;
  readonly type: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly image: RgbaImage | undefined;
  readonly opaque: boolean;
}

/**
 * How an atlas bakes the frames' 0–255 coverage ({@link BobFrame.mask}) into its alpha channel:
 *
 *  - `'per-pixel'` — the coverage rides into the sheet as-is: Double8Bit decals (ferns, smoke, wave
 *    foam) keep their authored feathered translucency. The engine's alpha blit
 *    (`PrintBob_UsingShadedAlpha`, OpenVikings' best-effort reconstruction corroborated by the
 *    measured alpha distributions) is the model.
 *  - `'opaque'` — every written pixel bakes fully opaque, replaying the engine's plain `PrintBob`
 *    blit, which skips the Double8Bit alpha byte. For the house atlases this is pinned by
 *    measurement: a `[GfxHouse]` bob's second byte is NOT coverage (≈100 mean across solid
 *    walls/roofs — through the alpha path the original's solid buildings would draw as 40% ghosts).
 */
export type AtlasAlphaMode = 'per-pixel' | 'opaque';

/** Options for {@link packBobAtlas}. */
export interface PackBobAtlasOptions {
  /** Shelf-packer wrap width (default {@link DEFAULT_ATLAS_MAX_WIDTH}). */
  readonly maxWidth?: number;
  /** Alpha bake mode (default `'per-pixel'` — see {@link AtlasAlphaMode}). */
  readonly alpha?: AtlasAlphaMode;
}

/**
 * Packs every bob of a decoded `.bmd` into one atlas, colouring frames with `palette`. The result's
 * `manifest.frames` has exactly `bmd.bobCount` entries, in bob-id order, so a consumer can address any
 * bob id. Empty / zero-size bobs occupy no atlas space (0×0 rect) but still get a manifest entry.
 *
 * `maxWidth` frames wider than the wrap width are still packed (their row is just wider). The atlas is
 * sized to the tightest bounding box of the placed frames (plus the gutter), or a 1×1 transparent pixel
 * when nothing has pixels (a valid PNG can't be 0×0). Throws (`atlas:` prefix) only on a malformed
 * palette via {@link expandBobFrame}; a structurally odd bob is tolerated by {@link decodeBobFrame}
 * upstream. The alpha bake mode is {@link AtlasAlphaMode}.
 */
export function packBobAtlas(bmd: Bmd, palette: Uint8Array, options: PackBobAtlasOptions = {}): BobAtlas {
  const { maxWidth = DEFAULT_ATLAS_MAX_WIDTH, alpha = 'per-pixel' } = options;
  const expand =
    alpha === 'opaque'
      ? (frame: BobFrame): RgbaImage => expandBobFrame(flattenFrameAlpha(frame), palette)
      : (frame: BobFrame): RgbaImage => expandBobFrame(frame, palette);
  return packBobAtlasWith(bmd, expand, maxWidth);
}

/**
 * Every written (`mask≠0`) pixel forced fully opaque — the plain-blit twin of a decoded frame. Named
 * bound: a Double8Bit raw pixel whose alpha byte is 0 decodes as UNWRITTEN ({@link decodeBobFrame}),
 * so it stays a hole here although the engine's plain blit would draw it — measured ≈1.2% of raw
 * pixels on the (not yet emitted) saracen house sets; revisit with the `[GfxHouse]` lumping fix.
 */
function flattenFrameAlpha(frame: BobFrame): BobFrame {
  const mask = new Uint8Array(frame.mask.length);
  for (let i = 0; i < mask.length; i++) mask[i] = frame.mask[i] !== 0 ? BOB_ALPHA_OPAQUE : 0;
  return { ...frame, mask };
}

/**
 * Packs every bob into an **indexed** atlas (palette index in red, mask in alpha) instead of an RGB one —
 * the {@link expandBobFrameIndexed} twin of {@link packBobAtlas}, for the character bodies whose player
 * colour is applied at draw time via a palette LUT. Placement + manifest are byte-identical to the RGB
 * atlas of the same `.bmd` (same frame sizes → same shelf packing), so the two atlases share frame
 * geometry; only the pixel channels differ.
 *
 * Coverage is FLATTENED here (every written pixel opaque): the indexed sheets' one consumer — the
 * `PalettedSprite` LUT shader — draws binary alpha (`texel.a < 0.5 → discard`, survivors opaque), so a
 * graded bake would silently ERODE the GUI chrome / goods icons / font glyphs whose type-4 bobs carry
 * sub-128 alpha bytes (measured: 12.6% of ls_goods' visible pixels). Baking opaque preserves the
 * pre-per-pixel-alpha look end-to-end; a graded indexed path needs a shader change plus its own human
 * pixel pass — a deliberate follow-up, not this bake.
 */
export function packIndexedBobAtlas(bmd: Bmd, maxWidth = DEFAULT_ATLAS_MAX_WIDTH): BobAtlas {
  return packBobAtlasWith(bmd, (frame) => expandBobFrameIndexed(flattenFrameAlpha(frame)), maxWidth);
}

/**
 * Shared packing core: decode + expand every bob (via `expand`, which colours or index-encodes it),
 * shelf-pack the non-empty frames, and emit the sheet + manifest. Parameterising only the per-frame
 * expansion keeps the RGB ({@link packBobAtlas}) and indexed ({@link packIndexedBobAtlas}) atlases on one
 * packing/manifest path. `expand` is called only for frames with pixels, so it always receives a real frame.
 */
function packBobAtlasWith(
  bmd: Bmd,
  expand: (frame: BobFrame) => RgbaImage,
  maxWidth = DEFAULT_ATLAS_MAX_WIDTH,
): BobAtlas {
  // 1. Decode + expand every bob; record which produced pixels.
  const prepared: PreparedFrame[] = [];
  for (let i = 0; i < bmd.bobCount; i++) {
    const bob = bmd.bobs[i];
    if (bob === undefined) continue;
    const frame = decodeBobFrame(bmd, i);
    const hasPixels = frame.width > 0 && frame.height > 0;
    let opaque = false;
    if (hasPixels) {
      for (let m = 0; m < frame.mask.length; m++) {
        if (frame.mask[m] !== 0) {
          opaque = true;
          break;
        }
      }
    }
    prepared.push({
      bobId: bmd.firstBobId + i,
      type: bob.type,
      offsetX: bob.area.x,
      offsetY: bob.area.y,
      width: frame.width,
      height: frame.height,
      image: hasPixels ? expand(frame) : undefined,
      opaque,
    });
  }

  // 2. Shelf-pack the non-empty frames left→right into rows wrapping at `maxWidth`. The frame order is
  //    bob-id order (already), which keeps the layout deterministic and the manifest easy to diff.
  const placements = new Map<number, { x: number; y: number }>();
  let cursorX = ATLAS_GUTTER;
  let cursorY = ATLAS_GUTTER;
  let rowHeight = 0;
  let atlasWidth = 0;
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined || p.image === undefined) continue;
    // Wrap to a new shelf when this frame would overflow the row (but always place at least one per row).
    if (cursorX > ATLAS_GUTTER && cursorX + p.width + ATLAS_GUTTER > maxWidth) {
      cursorX = ATLAS_GUTTER;
      cursorY += rowHeight + ATLAS_GUTTER;
      rowHeight = 0;
    }
    placements.set(i, { x: cursorX, y: cursorY });
    cursorX += p.width + ATLAS_GUTTER;
    if (cursorX > atlasWidth) atlasWidth = cursorX;
    if (p.height > rowHeight) rowHeight = p.height;
  }
  const atlasHeight = rowHeight === 0 ? cursorY : cursorY + rowHeight + ATLAS_GUTTER;

  // 3. Allocate the sheet (min 1×1 so it's a valid PNG when nothing has pixels) and blit each frame.
  const width = Math.max(1, atlasWidth);
  const height = Math.max(1, atlasHeight);
  const image: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4) };

  const frames: AtlasFrame[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined) continue;
    const at = placements.get(i);
    if (p.image !== undefined && at !== undefined) {
      blit(image, p.image, at.x, at.y);
      frames.push({
        bobId: p.bobId,
        type: p.type,
        rect: { x: at.x, y: at.y, width: p.width, height: p.height },
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        opaque: p.opaque,
      });
    } else {
      // Empty / zero-size bob: no atlas space, but still addressable by id.
      frames.push({
        bobId: p.bobId,
        type: p.type,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        opaque: false,
      });
    }
  }

  return { image, manifest: { width, height, frames } };
}
