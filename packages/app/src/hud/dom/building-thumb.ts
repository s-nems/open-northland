import { isDrawableResource, lookupFrame, type SpriteSheet } from '@open-northland/render';
import { boundBuildingRef } from '../../content/building-gfx/index.js';

/**
 * A building's picture for a card: its finished body cut from the sheet's already-loaded building
 * pages, the same frame the map draws for the seat's tribe (FOUNDATION.md: construction shows the
 * actual game building). Painted into the card's own canvas, so it needs no GPU and no second fetch.
 */

/** A body taller than this many times its width would shrink to a sliver in the square box, so its
 *  upper part fills the box instead (a tower, a mint). */
export const TALL_THUMB_RATIO = 1.35;
/** How far down a tall body the shown square starts, as a share of the hidden height: the roof and
 *  the upper storey, not the bare footing. */
const TALL_THUMB_FOCUS = 0.22;
/** Backing pixels per design px, so the thumb stays crisp on a scaled plane. */
const THUMB_BACKING_SCALE = 2;

export interface ThumbFit {
  /** The source rect to take from the frame. */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** Where it lands in the `box` square. */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/** Contain the frame in a `box` square, centred; a tall frame is cropped to a square of its width
 *  taken near the top instead. */
export function thumbFit(frame: { readonly width: number; readonly height: number }, box: number): ThumbFit {
  const { width, height } = frame;
  if (height > width * TALL_THUMB_RATIO) {
    return {
      sx: 0,
      sy: (height - width) * TALL_THUMB_FOCUS,
      sw: width,
      sh: width,
      dx: 0,
      dy: 0,
      dw: box,
      dh: box,
    };
  }
  const scale = Math.min(box / width, box / height);
  const dw = width * scale;
  const dh = height * scale;
  return { sx: 0, sy: 0, sw: width, sh: height, dx: (box - dw) / 2, dy: (box - dh) / 2, dw, dh };
}

export interface BuildingThumbs {
  /** Paint the type's body into `canvas` at `boxPx` design px; false leaves the canvas untouched (no
   *  sheet, no bound frame, or a GPU-only page) and the card shows its glyph instead. */
  paint(canvas: HTMLCanvasElement, typeId: number, boxPx: number): boolean;
}

export function createBuildingThumbs(sheet: SpriteSheet | undefined, tribe: number): BuildingThumbs {
  return {
    paint: (canvas, typeId, boxPx) => {
      if (sheet === undefined) return false;
      const ref = boundBuildingRef(sheet.bindings.building, typeId, tribe);
      if (ref === undefined) return false;
      const draw = typeof ref === 'number' ? { bob: ref, layer: undefined } : ref;
      const layer = draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.building;
      const frame = layer === undefined ? null : lookupFrame(layer.atlas, draw.bob);
      const resource: unknown = layer?.source.resource;
      if (frame === null || !isDrawableResource(resource)) return false;
      const size = boxPx * THUMB_BACKING_SCALE;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return false;
      const fit = thumbFit(frame, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        resource,
        frame.x + fit.sx,
        frame.y + fit.sy,
        fit.sw,
        fit.sh,
        fit.dx,
        fit.dy,
        fit.dw,
        fit.dh,
      );
      return true;
    },
  };
}
