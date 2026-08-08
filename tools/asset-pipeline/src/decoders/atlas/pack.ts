/**
 * Bob atlas packer: a decoded `.bmd` bob set into one RGBA sheet plus a per-bob frame manifest. A
 * `.bmd` carries no animation grouping (that lives in the `setatomic` `.ini` bindings), so the manifest
 * is one entry per bob id, with a 0×0 rect for an empty bob so every id stays addressable.
 */

import { type Bmd, decodeBobFrame } from '../bmd/index.js';
import type { RgbaImage } from '../image.js';
import { type AtlasAlphaMode, type BobBake, colouredBake, INDEXED_BAKE, SHADOW_BAKE } from './bake.js';

/** Transparent gutter (in pixels) left between packed frames so sampling can't bleed across them. */
export const ATLAS_GUTTER = 1;

/** Default atlas width the shelf packer wraps at; frames wider than this still fit (they get their own row). */
const DEFAULT_ATLAS_MAX_WIDTH = 1024;

/** One frame's placement + metadata in the atlas. Plain JSON data - no typed arrays or class instances. */
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
  return packBobAtlasWith(bmd, colouredBake(palette, alpha), maxWidth);
}

/**
 * Packs a shadow `.bmd` (`GfxBobLibs` `shadowlib`: 1-bit silhouettes paralleling the body bob ids) into
 * pre-baked black-at-`SHADOW_ALPHA` silhouettes, so a cast shadow draws as a plain batched sprite.
 */
export function packShadowBobAtlas(bmd: Bmd): BobAtlas {
  return packBobAtlasWith(bmd, SHADOW_BAKE, DEFAULT_ATLAS_MAX_WIDTH);
}

/**
 * Packs every bob into an indexed atlas (palette index in red, mask in alpha). Placement and manifest
 * are identical to the RGB atlas of the same `.bmd`. Coverage bakes graded, like the RGB path, so the
 * type-4 bobs' authored feathered translucency survives into the drawn sprite.
 */
export function packIndexedBobAtlas(bmd: Bmd): BobAtlas {
  return packBobAtlasWith(bmd, INDEXED_BAKE, DEFAULT_ATLAS_MAX_WIDTH);
}

function packBobAtlasWith(bmd: Bmd, bake: BobBake, maxWidth: number): BobAtlas {
  const prepared = prepareFrames(bmd, bake);
  const layout = shelfPack(prepared, maxWidth);
  return emitAtlas(prepared, layout, bake.secondByte === 'time');
}

/** A frame's pre-packing record: its baked pixels (or `undefined` if 0×0) plus the metadata to emit. */
interface PreparedFrame {
  readonly bobId: number;
  readonly type: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly image: RgbaImage | undefined;
  /** The frame's build-progress plane, same size as {@link image}. */
  readonly timeImage: RgbaImage | undefined;
  readonly opaque: boolean;
}

/** `bobs` is `bobCount` long by the {@link Bmd} contract, so the index guard only discharges the
 *  checked-index `| undefined`. */
function prepareFrames(bmd: Bmd, bake: BobBake): PreparedFrame[] {
  const prepared: PreparedFrame[] = [];
  for (let i = 0; i < bmd.bobCount; i++) {
    const bob = bmd.bobs[i];
    if (bob === undefined) continue;
    const frame = decodeBobFrame(bmd, i, bake.secondByte);
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
      image: hasPixels ? bake.plane(frame) : undefined,
      timeImage: hasPixels && bake.secondByte === 'time' ? bake.time(frame) : undefined,
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

/** Shelf-packs the non-empty frames left to right into rows wrapping at `maxWidth`, in bob-id order so
 *  the layout stays deterministic. */
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

/** Allocates the sheet(s), blits each placed frame, and builds the manifest the packer returns. */
function emitAtlas(
  prepared: readonly PreparedFrame[],
  layout: PackedLayout,
  withTimeSheet: boolean,
): BobAtlas {
  const { placements, width, height } = layout;
  const image: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4) };
  const timeImage: RgbaImage | undefined = withTimeSheet
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
