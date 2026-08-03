/**
 * Bob atlas packer: packs a decoded `.bmd` bob set into one RGBA sheet plus a per-bob frame manifest.
 *
 * A `.bmd` carries no animation grouping (that lives in the `setatomic` `.ini` bindings), so the
 * manifest is one entry per bob id, with a 0×0 rect for an empty bob so every id stays addressable.
 * Index 0 is a real palette colour for bobs, so alpha always comes from a frame's `mask`.
 */

import type { Bmd, BobFrame } from './bmd/index.js';
import { BOB_ALPHA_OPAQUE, decodeBobFrame } from './bmd/index.js';
import { assertPaletteBytes, paletteToRgba, type RgbaImage } from './image.js';

/** Transparent gutter (in pixels) left between packed frames so sampling can't bleed across them. */
export const ATLAS_GUTTER = 1;

/** Default atlas width the shelf packer wraps at; frames wider than this still fit (they get their own row). */
const DEFAULT_ATLAS_MAX_WIDTH = 1024;

/** One frame's placement + metadata in the atlas. JSON-serializable (plain numbers/booleans only). */
export interface AtlasFrame {
  /** The bob's stable id: `bmd.firstBobId + index`. */
  readonly bobId: number;
  /** Raw bob `type` (0 empty / 1 8-bit / 2 1-bit mask / 3 TimeMask / 4 double-byte). Carried, not interpreted. */
  readonly type: number;
  /** Pixel rect of this frame inside the atlas. `width`/`height` are 0 for an empty/zero-size bob. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The bob's draw offset from the `.bmd` (`SBobData.Area`), added to the sprite's screen anchor. */
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
  /** Present when the `'build-time'` bake also emitted the sibling `<stem>.build.png` time sheet. */
  readonly build?: true;
}

/** A packed atlas: the RGBA sheet to PNG-encode plus its manifest to write as JSON. */
export interface BobAtlas {
  readonly image: RgbaImage;
  readonly manifest: AtlasManifest;
  /** The `'build-time'` bake's second sheet: grayscale build-progress thresholds, placed like {@link image}. */
  readonly timeImage?: RgbaImage;
}

/**
 * Colours one decoded frame into straight RGBA using a 256-entry palette (768 bytes, `[R,G,B] × 256`).
 * Alpha is the frame's `mask`: an unwritten pixel is fully transparent, a written one carries its
 * 0-255 coverage.
 */
export function expandBobFrame(frame: BobFrame, palette: Uint8Array): RgbaImage {
  assertPaletteBytes(palette, 'atlas');
  const { width, height, pixels, mask } = frame;
  return { width, height, rgba: paletteToRgba(pixels, palette, (i) => mask[i] ?? 0) };
}

/**
 * Expands one decoded frame into an indexed RGBA image: palette index in red, `mask` in alpha,
 * green/blue left 0. Colour is deferred to the renderer, which reads each index through a per-player
 * palette LUT, so a character's clothing band can be recoloured at draw time.
 */
export function expandBobFrameIndexed(frame: BobFrame): RgbaImage {
  const { width, height, pixels, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const coverage = mask[i] ?? 0;
    if (coverage === 0) continue; // transparent: leave RGBA all-zero
    const o = i * 4;
    rgba[o] = pixels[i] ?? 0;
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
  /** The frame's build-progress plane, only on a `'build-time'` bake (same size as {@link image}). */
  readonly timeImage: RgbaImage | undefined;
  readonly opaque: boolean;
}

/**
 * How an atlas reads a Double8Bit pair's second byte:
 *
 *  - `'per-pixel'`: the byte is coverage and bakes into the sheet's alpha as-is, keeping the decals'
 *    authored feathered translucency.
 *  - `'build-time'`: the byte is a 0-255 construction-progress threshold, not coverage. Measured on
 *    the `[GfxHouse]` bobs: it spans ~0-255 and is strongly row-correlated bottom-up (foundation low,
 *    roof high; ≈100 mean across solid walls). Every written pixel bakes fully opaque into the colour
 *    sheet, and the thresholds bake into a second, same-placement grayscale sheet
 *    ({@link BobAtlas.timeImage}) a renderer reveals pixel by pixel as construction progresses.
 */
export type AtlasAlphaMode = 'per-pixel' | 'build-time';

/** Options for {@link packBobAtlas}. */
export interface PackBobAtlasOptions {
  /** Shelf-packer wrap width (default {@link DEFAULT_ATLAS_MAX_WIDTH}). */
  readonly maxWidth?: number;
  /** Alpha bake mode (default `'per-pixel'` - see {@link AtlasAlphaMode}). */
  readonly alpha?: AtlasAlphaMode;
}

/**
 * Packs every bob of a decoded `.bmd` into one atlas, colouring frames with `palette`. The result's
 * `manifest.frames` has exactly `bmd.bobCount` entries, in bob-id order, so a consumer can address any
 * bob id. A frame wider than `maxWidth` is still packed; its row is just wider.
 */
export function packBobAtlas(bmd: Bmd, palette: Uint8Array, options: PackBobAtlasOptions = {}): BobAtlas {
  const { maxWidth = DEFAULT_ATLAS_MAX_WIDTH, alpha = 'per-pixel' } = options;
  return packBobAtlasWith(bmd, (frame) => expandBobFrame(frame, palette), maxWidth, alpha);
}

/**
 * The build-progress plane of a `'time'`-decoded frame: R=G=B is the pixel's 0-255 threshold, alpha 255
 * where written and 0 elsewhere. Grayscale, so the emitted `<stem>.build.png` is inspectable by eye.
 */
function expandBobFrameTime(frame: BobFrame): RgbaImage {
  const { width, height, mask, time } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const t = time?.[i] ?? 0;
    const o = i * 4;
    rgba[o] = t;
    rgba[o + 1] = t;
    rgba[o + 2] = t;
    rgba[o + 3] = BOB_ALPHA_OPAQUE;
  }
  return { width, height, rgba };
}

/**
 * The baked alpha of a shadow-atlas pixel. The original's shadow blit is not pinned byte-level, so this
 * adopts the value another reimplementation matched against the running original. A named
 * approximation, one knob to retune.
 */
export const SHADOW_ALPHA = 0x50;

/**
 * Expands one decoded frame into a shadow plane: every written pixel is black at {@link SHADOW_ALPHA},
 * every unwritten one fully transparent. No palette: the darkening belongs to the blit, not the art.
 */
function expandBobFrameShadow(frame: BobFrame): RgbaImage {
  const { width, height, mask } = frame;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) === 0) continue; // transparent: leave RGBA all-zero
    rgba[i * 4 + 3] = SHADOW_ALPHA;
  }
  return { width, height, rgba };
}

/**
 * Packs every bob of a shadow `.bmd` (the `GfxBobLibs` `shadowlib` value: 1-bit silhouette masks
 * paralleling the body bob ids) into one atlas of pre-baked black-at-{@link SHADOW_ALPHA} silhouettes,
 * so a cast shadow draws as a plain batched sprite instead of a blend-mode blit.
 */
export function packShadowBobAtlas(bmd: Bmd): BobAtlas {
  return packBobAtlasWith(bmd, expandBobFrameShadow, DEFAULT_ATLAS_MAX_WIDTH, 'per-pixel');
}

/**
 * Packs every bob into an indexed atlas (palette index in red, mask in alpha). Placement and manifest
 * are identical to the RGB atlas of the same `.bmd`, so the two share frame geometry and differ only in
 * the pixel channels. Coverage bakes graded, like the RGB path, so the type-4 bobs' authored feathered
 * translucency survives into the drawn sprite.
 */
export function packIndexedBobAtlas(bmd: Bmd): BobAtlas {
  return packBobAtlasWith(bmd, expandBobFrameIndexed, DEFAULT_ATLAS_MAX_WIDTH, 'per-pixel');
}

/** `expand` is called only for frames that have pixels, so it always receives a non-empty frame. */
function packBobAtlasWith(
  bmd: Bmd,
  expand: (frame: BobFrame) => RgbaImage,
  maxWidth: number,
  alpha: AtlasAlphaMode,
): BobAtlas {
  const buildTime = alpha === 'build-time';
  const prepared = prepareFrames(bmd, expand, buildTime);
  const layout = shelfPack(prepared, maxWidth);
  return emitAtlas(prepared, layout, buildTime);
}

/** Decode + colour/index-encode every bob into a dense record, dropping only the gaps `bmd.bobs` omits. */
function prepareFrames(
  bmd: Bmd,
  expand: (frame: BobFrame) => RgbaImage,
  buildTime: boolean,
): PreparedFrame[] {
  const prepared: PreparedFrame[] = [];
  for (let i = 0; i < bmd.bobCount; i++) {
    const bob = bmd.bobs[i];
    if (bob === undefined) continue;
    const frame = decodeBobFrame(bmd, i, buildTime ? 'time' : 'alpha');
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
      timeImage: hasPixels && buildTime ? expandBobFrameTime(frame) : undefined,
      opaque,
    });
  }
  return prepared;
}

/** Where each frame lands and the sheet size that holds them (min 1×1 so an empty pack is a valid PNG). */
interface PackedLayout {
  /** Placement per non-empty frame, keyed by its index in the `prepared` array (not its bob id). */
  readonly placements: ReadonlyMap<number, { readonly x: number; readonly y: number }>;
  readonly width: number;
  readonly height: number;
}

/**
 * Shelf-packs the non-empty frames left to right into rows wrapping at `maxWidth`, in bob-id order so
 * the layout stays deterministic.
 */
function shelfPack(prepared: readonly PreparedFrame[], maxWidth: number): PackedLayout {
  const placements = new Map<number, { x: number; y: number }>();
  let cursorX = ATLAS_GUTTER;
  let cursorY = ATLAS_GUTTER;
  let rowHeight = 0;
  let atlasWidth = 0;
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined || p.image === undefined) continue;
    // Wrap to a new shelf on overflow, but always place at least one frame per row.
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
  return { placements, width: Math.max(1, atlasWidth), height: Math.max(1, atlasHeight) };
}

/** Allocates the sheet(s), blits each placed frame, and builds the manifest the packer returns. */
function emitAtlas(prepared: readonly PreparedFrame[], layout: PackedLayout, buildTime: boolean): BobAtlas {
  const { placements, width, height } = layout;
  const image: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4) };
  const timeImage: RgbaImage | undefined = buildTime
    ? { width, height, rgba: new Uint8Array(width * height * 4) }
    : undefined;

  const frames: AtlasFrame[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined) continue;
    const at = placements.get(i);
    if (p.image !== undefined && at !== undefined) {
      blit(image, p.image, at.x, at.y);
      if (timeImage !== undefined && p.timeImage !== undefined) blit(timeImage, p.timeImage, at.x, at.y);
      frames.push({
        bobId: p.bobId,
        type: p.type,
        rect: { x: at.x, y: at.y, width: p.width, height: p.height },
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        opaque: p.opaque,
      });
    } else {
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

  return timeImage === undefined
    ? { image, manifest: { width, height, frames } }
    : { image, manifest: { width, height, frames, build: true }, timeImage };
}
