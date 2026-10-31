import { drawableFrame, lookupFrame, type SpriteSheet } from '@open-northland/render';
import { boundBuildingRef } from '../../content/building-gfx/index.js';
import { createStaticPictures, showPicture } from './static-picture.js';

/**
 * A building's picture for a card: its finished body cut from the sheet's already-loaded building pages, the
 * same frame the map draws for the seat's tribe, so construction shows the actual game building. Drawn
 * once per type, tribe and size into a static picture (static-picture.ts), so it needs no second fetch.
 */

/** Backing pixels per design px, so the thumb stays crisp on a scaled plane. */
export const THUMB_BACKING_SCALE = 2;

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

/** Contain the whole frame in a `box` square, centred: a tall body (a tower) stands small and whole
 *  rather than cropped. */
export function thumbFit(frame: { readonly width: number; readonly height: number }, box: number): ThumbFit {
  const { width, height } = frame;
  const scale = Math.min(box / width, box / height);
  const dw = width * scale;
  const dh = height * scale;
  return { sx: 0, sy: 0, sw: width, sh: height, dx: (box - dw) / 2, dy: (box - dh) / 2, dw, dh };
}

export interface BuildingThumbs {
  /** Show the type's body in `image` at `boxPx` design px, as `tribe` builds it (the seat's own by
   *  default); false leaves the image empty (no sheet, no bound frame, or a GPU-only page) and the card
   *  shows its glyph instead. */
  paint(image: HTMLImageElement, typeId: number, boxPx: number, tribe?: number): boolean;
  /** Whether the sheet holds `tribe`'s own body of the type; a type it lacks paints the base tribe's. */
  holds(typeId: number, tribe: number): boolean;
}

export function createBuildingThumbs(sheet: SpriteSheet | undefined, seatTribe: number): BuildingThumbs {
  const pictures = createStaticPictures();
  return {
    holds: (typeId, tribe) => {
      const binding = sheet?.bindings.building;
      return typeof binding === 'object' && binding.byTribe?.[tribe]?.byType[typeId] !== undefined;
    },
    paint: (image, typeId, boxPx, tribe = seatTribe) => {
      if (sheet === undefined) return false;
      const ref = boundBuildingRef(sheet.bindings.building, typeId, tribe);
      if (ref === undefined) return false;
      const draw = typeof ref === 'number' ? { bob: ref, layer: undefined } : ref;
      const layer = draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.building;
      const frame = layer === undefined ? null : lookupFrame(layer.atlas, draw.bob);
      const drawable = frame === null || layer === undefined ? null : drawableFrame(layer.source, frame);
      if (frame === null || drawable === null) return false;
      const size = boxPx * THUMB_BACKING_SCALE;
      const picture = pictures.picture(`${typeId}:${tribe}:${size}`, size, size, (ctx) => {
        const fit = thumbFit(frame, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          drawable.image,
          drawable.x + fit.sx,
          drawable.y + fit.sy,
          fit.sw,
          fit.sh,
          fit.dx,
          fit.dy,
          fit.dw,
          fit.dh,
        );
      });
      if (picture === null) return false;
      showPicture(image, picture);
      return true;
    },
  };
}
