import { bakeToSprite, oversampleFor } from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../../content/gui-art.js';
import { type GuiFrameName, guiFrameIndex } from '../../../content/gui-atlas-map.js';

/** Oversample bounds for an order disc, as `bakeRoundIcon` picks them: the floor keeps the rim smooth at
 *  small scales, the cap bounds the canvas. */
const MIN_SUPERSAMPLE = 3;
const MAX_SUPERSAMPLE = 6;

export interface IconCanvas {
  readonly canvas: HTMLCanvasElement;
  /** The drawn size in canvas (screen) px: the frame's native size times the ring scale. */
  readonly width: number;
  readonly height: number;
}

/**
 * One order glyph as a 2D canvas for a DOM button, or null when its frame is missing. The 'round' colour
 * key hard-clips the disc, so the glyph is read back at an integer oversample, where every alpha is 0 or
 * 255 and the colours are exact, and the browser's linear downscale smooths the rim.
 */
export function orderIconCanvas(
  app: Application,
  art: GuiArt,
  frameName: GuiFrameName,
  scale: number,
): IconCanvas | null {
  const made = makeGuiSprite(art, guiFrameIndex(frameName), { defaultPalette: 'context', colorKey: 'round' });
  if (made === null) return null;
  const { sprite, frame } = made;
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(frame.width * ss);
  const texH = Math.ceil(frame.height * ss);
  // Upright into the render texture, so the readback needs no flip; the offset cancels the frame's draw
  // offset so its content box fills the texture.
  sprite.flipY = true;
  sprite.place(-frame.offsetX * ss, -frame.offsetY * ss, ss, texW, texH);
  const offscreen = new Container();
  offscreen.addChild(sprite);
  const baked = bakeToSprite(app.renderer, offscreen, texW, texH, 1);
  let read: ReturnType<typeof app.renderer.extract.pixels>;
  try {
    read = app.renderer.extract.pixels(baked.display.texture);
  } finally {
    baked.display.destroy();
    baked.dispose();
    offscreen.destroy({ children: true });
  }
  const canvas = document.createElement('canvas');
  canvas.width = read.width;
  canvas.height = read.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const image = context.createImageData(read.width, read.height);
  image.data.set(read.pixels);
  context.putImageData(image, 0, 0);
  return { canvas, width: frame.width * scale, height: frame.height * scale };
}
