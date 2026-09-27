import { bakeToSprite, oversampleFor } from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../../content/gui-art.js';
import { type GuiFrameName, guiFrameIndex } from '../../../content/gui-atlas-map.js';

/** Oversample bounds for the order discs: the floor keeps the rim smooth at small scales, the cap
 *  bounds the page. */
const MIN_SUPERSAMPLE = 3;
const MAX_SUPERSAMPLE = 6;

/** One glyph's box on the page, in page px. */
export interface IconCell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface IconPage {
  /** The page as an image URL, for a CSS background crop. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** Page px per canvas (screen) px of the drawn glyph. */
  readonly oversample: number;
  readonly cells: ReadonlyMap<GuiFrameName, IconCell>;
}

/**
 * Every order glyph baked onto one shared page, as the package rule asks of small images, or null when
 * none of the frames exists. The 'round' colour key hard-clips each disc, so the page is read back at
 * an integer oversample, where every alpha is 0 or 255 and the colours are exact, and the browser's
 * linear downscale smooths the rims.
 */
export function bakeIconPage(
  app: Application,
  art: GuiArt,
  frameNames: readonly GuiFrameName[],
  scale: number,
): IconPage | null {
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const made = [...new Set(frameNames)].flatMap((name) => {
    const sprite = makeGuiSprite(art, guiFrameIndex(name), { defaultPalette: 'context', colorKey: 'round' });
    return sprite === null ? [] : [{ name, ...sprite }];
  });
  if (made.length === 0) return null;
  // A square-ish grid of equal cells keeps the page well inside any texture size limit.
  const cellW = Math.max(...made.map((m) => Math.ceil(m.frame.width * ss)));
  const cellH = Math.max(...made.map((m) => Math.ceil(m.frame.height * ss)));
  const columns = Math.ceil(Math.sqrt(made.length));
  const width = cellW * columns;
  const height = cellH * Math.ceil(made.length / columns);
  const offscreen = new Container();
  const cells = new Map<GuiFrameName, IconCell>();
  made.forEach(({ name, sprite, frame }, i) => {
    const x = (i % columns) * cellW;
    const y = Math.floor(i / columns) * cellH;
    // Upright into the render texture, so the readback needs no flip; the offset cancels the frame's
    // draw offset so its content box starts at the cell corner.
    sprite.flipY = true;
    sprite.place(x - frame.offsetX * ss, y - frame.offsetY * ss, ss, width, height);
    offscreen.addChild(sprite);
    cells.set(name, { x, y, w: Math.ceil(frame.width * ss), h: Math.ceil(frame.height * ss) });
  });
  // The bake owns `offscreen` from here and frees it with its texture.
  const baked = bakeToSprite(app.renderer, offscreen, width, height, 1);
  let read: ReturnType<typeof app.renderer.extract.pixels>;
  try {
    read = app.renderer.extract.pixels(baked.display.texture);
  } finally {
    baked.display.destroy();
    baked.dispose();
  }
  const canvas = document.createElement('canvas');
  canvas.width = read.width;
  canvas.height = read.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const image = context.createImageData(read.width, read.height);
  image.data.set(read.pixels);
  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL(), width, height, oversample: ss / scale, cells };
}
