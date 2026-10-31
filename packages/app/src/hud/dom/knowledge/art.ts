import type { AtlasManifest } from '@open-northland/render';
import type { ContentIr } from '../../../content/ir/rows.js';
import { animalPictureBob, servedAtlas } from '../../../content/sprite-good-icons.js';
import { diag } from '../../../diag/index.js';
import { buildingPicture, type PictureLayer } from '../../knowledge/picture.js';
import { type BuildingThumbs, THUMB_BACKING_SCALE, thumbFit } from '../building-thumb.js';
import type { GoodIconPainter } from '../good-art.js';
import { createStaticPictures, type StaticPicture, showPicture } from '../static-picture.js';
import type { KnowledgeArt } from './context.js';
import { ColouredPages, createKnowledgeMotion } from './motion.js';

interface PlacedFrame {
  readonly layer: PictureLayer;
  readonly rect: AtlasManifest['frames'][number]['rect'];
  readonly left: number;
  readonly top: number;
}

/** The frames of `layers` and their box from one anchor; null when the first, the body, draws nothing. */
export function placeLayers(
  layers: readonly PictureLayer[],
  framesOf: (layer: PictureLayer) => AtlasManifest['frames'][number] | undefined,
): { readonly frames: readonly PlacedFrame[]; readonly width: number; readonly height: number } | null {
  const frames: PlacedFrame[] = [];
  for (const layer of layers) {
    const frame = framesOf(layer);
    if (frame === undefined || frame.rect.width === 0) continue;
    frames.push({
      layer,
      rect: frame.rect,
      left: frame.offsetX + layer.x,
      top: frame.offsetY + layer.y,
    });
  }
  if (frames[0]?.layer !== layers[0]) return null;
  const left = Math.min(...frames.map((f) => f.left));
  const top = Math.min(...frames.map((f) => f.top));
  const width = Math.max(...frames.map((f) => f.left + f.rect.width)) - left;
  const height = Math.max(...frames.map((f) => f.top + f.rect.height)) - top;
  return {
    frames: frames.map((f) => ({ ...f, left: f.left - left, top: f.top - top })),
    width,
    height,
  };
}

/** Stills composed from the served sheets, kept as small images: a page is coloured once for its first
 *  picture and closed soon after the last, so an open tab holds pictures, not pages. */
function createServedPictures() {
  const pictures = createStaticPictures();
  const pages = new ColouredPages();
  const drawing = new Map<string, Promise<StaticPicture | null>>();
  const latest = new WeakMap<HTMLImageElement, string>();

  const compose = async (
    key: string,
    layers: readonly PictureLayer[],
    size: number,
  ): Promise<StaticPicture | null> => {
    const stems = [...new Set(layers.map((layer) => layer.stem))];
    const atlases = new Map<string, AtlasManifest | null>(
      await Promise.all(stems.map(async (stem) => [stem, await servedAtlas(stem)] as const)),
    );
    const placed = placeLayers(layers, (layer) =>
      atlases.get(layer.stem)?.frames.find((frame) => frame.bobId === layer.bob),
    );
    if (placed === null) return null;
    const held: string[] = [];
    const sheetOf = (atlas: AtlasManifest): Promise<CanvasImageSource | null> => {
      const page = pages.acquire(atlas);
      held.push(page.key);
      return page.bitmap;
    };
    try {
      const sheets = new Map(
        await Promise.all(
          [...atlases].map(async ([stem, atlas]) => [stem, atlas && (await sheetOf(atlas))] as const),
        ),
      );
      const fit = thumbFit(placed, size);
      const scale = fit.dw / placed.width;
      return pictures.picture(key, size, size, (ctx) => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const { layer, rect, left, top } of placed.frames) {
          const sheet = sheets.get(layer.stem);
          if (sheet === undefined || sheet === null) continue;
          ctx.drawImage(
            sheet,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            fit.dx + left * scale,
            fit.dy + top * scale,
            rect.width * scale,
            rect.height * scale,
          );
        }
      });
    } finally {
      for (const page of held) pages.release(page);
    }
  };

  return (image: HTMLImageElement, key: string, layers: readonly PictureLayer[], boxPx: number): void => {
    const size = boxPx * THUMB_BACKING_SCALE;
    const drawnKey = `${key}:${size}`;
    latest.set(image, drawnKey);
    let pending = drawing.get(drawnKey);
    if (pending === undefined) {
      pending = compose(drawnKey, layers, size);
      drawing.set(drawnKey, pending);
    }
    pending
      .then((picture) => {
        if (picture === null) drawing.delete(drawnKey);
        else if (latest.get(image) === drawnKey) showPicture(image, picture);
      })
      .catch((error: unknown) => {
        drawing.delete(drawnKey);
        diag.warn('hud', `knowledge picture ${key}: ${String(error)}`);
      });
  };
}

export interface KnowledgeArtInputs {
  /** The served IR (`loadIr()`); null leaves every picture empty and no film. */
  readonly ir: ContentIr | null;
  /** `createGoodIconPainter`: the HUD's in a game, `createGoodIconPainter(null, content)` in the menu. */
  readonly goodIcon: GoodIconPainter;
  /** The running map's thumbnails, whose pages are decoded already; absent in the main menu. A type or
   *  tribe the map's sheet lacks is composed from the served sheets either way. */
  readonly thumbs?: BuildingThumbs;
}

/** The pictures of the Knowledge window. Everything but the optional `thumbs` reads served sheets through
 *  a canvas and a worker, without a GPU context, so the menu and a game show the same art. */
export function createKnowledgeArt({ ir, goodIcon, thumbs }: KnowledgeArtInputs): KnowledgeArt {
  if (ir === null) {
    return { goodIcon, buildingThumb: () => false, animalPicture: () => false, motion: null };
  }
  const paint = createServedPictures();
  return {
    goodIcon,
    buildingThumb: (image, typeId, boxPx, tribe) => {
      const layers = buildingPicture(ir, typeId, tribe);
      if (layers === null) return false;
      // A wonder's parts are not one sheet frame, so only a plain body can come from the map's sheet.
      const plain = layers.length === 1 && thumbs?.holds(typeId, tribe) === true;
      if (plain && thumbs?.paint(image, typeId, boxPx, tribe) === true) return true;
      paint(image, `building:${typeId}:${tribe}`, layers, boxPx);
      return true;
    },
    animalPicture: (image, animalTribe, boxPx) => {
      const bob = animalPictureBob(ir, animalTribe);
      if (bob === null) return false;
      paint(image, `animal:${animalTribe}`, [{ stem: bob.stem, bob: bob.bobId, x: 0, y: 0 }], boxPx);
      return true;
    },
    motion: createKnowledgeMotion(ir),
  };
}
