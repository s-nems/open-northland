import { PalettedSprite } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { guiPaletteRow } from '../../content/gui-gfx.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';

/**
 * The details panel's rope-and-knot window border, drawn through the `frame` palette. A no-op without
 * `content/` (`art === null`); the caller then strokes a flat window outline instead.
 */

/** The window-border rope strips' decoded native thickness (128×3 / 3×128 atlas rects). */
const FRAME_EDGE = 3;
/** The knot corners' decoded native size, tracking atlas frames 0-3 (10×10 top pair, 7×7 bottom pair). */
const CORNER_TOP = 10;
const CORNER_BOTTOM = 7;

interface FrameBorderDeps {
  readonly art: DetailsPanelAssets['art'];
  readonly front: Container;
  readonly scale: number;
  /** The off-screen texture's size in px, which every piece projects into and renders upright for. */
  readonly resolution: { readonly w: number; readonly h: number };
}

export function createFrameBorderKit(deps: FrameBorderDeps): { frameBorder: (r: Rect) => void } {
  const { art, front, scale, resolution } = deps;

  /** A border piece at an exact screen rect; `clipNative` passes a sub-frame so a strip can tile
   *  instead of stretching. */
  const framePiece = (gfx: number, r: Rect, clipNative?: { w: number; h: number }): void => {
    if (art === null) return;
    const frame = art.layer.atlas.frames.get(gfx);
    if (frame === undefined) return;
    const sprite = new PalettedSprite(art.lut, art.colours);
    const sub =
      clipNative === undefined
        ? { ...frame, offsetX: 0, offsetY: 0 }
        : { x: frame.x, y: frame.y, width: clipNative.w, height: clipNative.h, offsetX: 0, offsetY: 0 };
    sprite.setFrame(art.layer.source, sub, art.layer.atlas.width, art.layer.atlas.height);
    sprite.player = guiPaletteRow('frame');
    sprite.colorKey = 'magenta';
    sprite.flipY = true;
    front.addChild(sprite);
    const { w, h } = resolution;
    sprite.stretchToRect(
      Math.round(r.x),
      Math.round(r.y),
      Math.max(1, Math.round(r.w)),
      Math.max(1, Math.round(r.h)),
      w,
      h,
    );
  };

  /** Tile an edge strip along its length (thickness stretches to `r`, the rope pattern repeats). */
  const frameStrip = (gfx: number, r: Rect, vertical: boolean): void => {
    if (art === null) return;
    const frame = art.layer.atlas.frames.get(gfx);
    if (frame === undefined) return;
    const stepNative = vertical ? frame.height : frame.width;
    const len = vertical ? r.h : r.w;
    let covered = 0;
    while (covered < len) {
      const remainNative = Math.min(stepNative, Math.max(1, Math.ceil((len - covered) / scale)));
      const pieceLen = Math.min(remainNative * scale, len - covered);
      framePiece(
        gfx,
        vertical
          ? { x: r.x, y: r.y + covered, w: r.w, h: pieceLen }
          : { x: r.x + covered, y: r.y, w: pieceLen, h: r.h },
        vertical ? { w: frame.width, h: remainNative } : { w: remainNative, h: frame.height },
      );
      covered += pieceLen;
    }
  };

  const frameBorder = (r: Rect): void => {
    const e = Math.max(1, Math.round(FRAME_EDGE * scale));
    const ct = Math.round(CORNER_TOP * scale);
    const cb = Math.round(CORNER_BOTTOM * scale);
    frameStrip(GUI_FRAME.window_border_top, { x: r.x + ct, y: r.y, w: r.w - ct * 2, h: e }, false);
    frameStrip(
      GUI_FRAME.window_border_bottom,
      { x: r.x + cb, y: r.y + r.h - e, w: r.w - cb * 2, h: e },
      false,
    );
    frameStrip(GUI_FRAME.window_border_left, { x: r.x, y: r.y + ct, w: e, h: r.h - ct - cb }, true);
    frameStrip(
      GUI_FRAME.window_border_right,
      { x: r.x + r.w - e, y: r.y + ct, w: e, h: r.h - ct - cb },
      true,
    );
    framePiece(GUI_FRAME.knot_corner_tl, { x: r.x, y: r.y, w: ct, h: ct });
    framePiece(GUI_FRAME.knot_corner_tr, { x: r.x + r.w - ct, y: r.y, w: ct, h: ct });
    framePiece(GUI_FRAME.knot_corner_bl, { x: r.x, y: r.y + r.h - cb, w: cb, h: cb });
    framePiece(GUI_FRAME.knot_corner_br, { x: r.x + r.w - cb, y: r.y + r.h - cb, w: cb, h: cb });
  };

  return { frameBorder };
}
