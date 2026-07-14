import { type Container, Text } from 'pixi.js';
import type { FontColorName } from '../../content/font-gfx.js';
import { CAP_TOP_RATIO, UI_TEXT_FILL } from '../../content/ui-font.js';
import type { Rect } from '../geometry.js';

/**
 * The details panel's vector-text primitives — the placement half of the drawing kit
 * ({@link import('./chrome.js')}). Text draws in the bundled vector serif (`content/ui-font.ts`, always
 * present), not the original bitmap `.fnt`: a larger `title` size for headlines/buttons/the building name,
 * a `body` size for the rest. Lines are placed by Pixi `Text` anchors (top-left / centred / right) rather
 * than the bitmap face's baseline metrics. Each `Text` is Pixi-native, so it bakes upright with no `flipY`
 * and is disposed with the offscreen root each rebuild.
 */

/** Which of the two panel text sizes a call draws at. */
export type FontVariant = 'body' | 'title';

/**
 * The vector text sizes in native (pre-scale) px, multiplied by the chrome scale (the bake oversample) at
 * draw time. Calibrated against the original's font-10 body / font-12 title cap heights, then nudged for
 * the serif's smaller x-height.
 */
const FONT_PX: Readonly<Record<FontVariant, number>> = { body: 11, title: 13 };
/**
 * A tiny vertical nudge (native px) added when centring a line in a rect: Pixi measures a `Text` by its
 * full ascent+descent line box, so the visible caps sit a hair high — this drops them to the optical centre.
 */
const CENTER_BIAS = 0.5;

/** The panel's text placement primitives (see {@link createTextKit}). */
export interface TextKit {
  /** Draw a line of text with its top-left at `(x, y)`. */
  textAt(text: string, x: number, y: number, color: FontColorName, variant?: FontVariant): void;
  /** Center a line of text in `r` (both axes). `maxWidth` (in `r`'s px) shrinks an over-long line to fit
   *  the box instead of overflowing it — the seam for long personalized names in the section headline. */
  textCentered(text: string, r: Rect, color: FontColorName, variant?: FontVariant, maxWidth?: number): void;
  /** Left-anchor a line of text at `x`, vertically centred on `centerY` — a left-aligned value that must
   *  still sit on a field's centre line (the stock amount in its plate). */
  textLeftMiddle(text: string, x: number, centerY: number, color: FontColorName, variant?: FontVariant): void;
  /** Right-align a line of text's end at `rightX` (top at `y`). */
  textRight(text: string, rightX: number, y: number, color: FontColorName, variant?: FontVariant): void;
}

/**
 * Build the text-placement kit over the panel's `text` layer container. Each `Text` renders at
 * `FONT_PX * scale` (so the bake's oversample keeps it sharp) and is anchored per call — Pixi
 * centres/right-aligns by its own measured bounds, so no bitmap-baseline math is needed.
 */
export function createTextKit(textLayer: Container, fontFamily: string, scale: number): TextKit {
  const makeText = (text: string, color: FontColorName, variant: FontVariant): Text => {
    const t = new Text({
      text,
      style: {
        fontFamily,
        fontSize: FONT_PX[variant] * scale,
        fill: UI_TEXT_FILL[color],
      },
    });
    textLayer.addChild(t);
    return t;
  };

  const textAt = (
    text: string,
    x: number,
    y: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0, 0);
    t.position.set(Math.round(x), Math.round(y - CAP_TOP_RATIO * FONT_PX[variant] * scale));
  };

  const textCentered = (
    text: string,
    r: Rect,
    color: FontColorName,
    variant: FontVariant = 'body',
    maxWidth?: number,
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0.5, 0.5);
    // Shrink a line that would overflow (a long patronymic name in the headline). Scaling the whole node
    // around its centre anchor keeps it centred; short lines are left at their native size.
    if (maxWidth !== undefined && t.width > maxWidth) t.scale.set(maxWidth / t.width);
    t.position.set(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2 + CENTER_BIAS * scale));
  };

  const textLeftMiddle = (
    text: string,
    x: number,
    centerY: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0, 0.5);
    t.position.set(Math.round(x), Math.round(centerY + CENTER_BIAS * scale));
  };

  const textRight = (
    text: string,
    rightX: number,
    y: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(1, 0);
    t.position.set(Math.round(rightX), Math.round(y - CAP_TOP_RATIO * FONT_PX[variant] * scale));
  };

  return { textAt, textCentered, textLeftMiddle, textRight };
}
