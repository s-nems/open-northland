import { PalettedSprite } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { guiPaletteRow } from '../../content/gui-gfx.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';

/**
 * The details panel's rope-and-knot window border — the {@link import('./chrome.js')} drawing kit's
 * self-contained border sub-concern. Edge strips are TILED along their length (stretching smears the rope
 * pattern) and the knot corners drawn at native size, all through the `frame` palette. No-op when
 * `content/` is absent (`art === null`); the caller then strokes a flat window outline instead.
 */

/** The window-border rope strips' decoded native thickness (128×3 / 3×128 atlas rects). */
const FRAME_EDGE = 3;
/**
 * The knot corners' decoded native size — must track atlas frames 0–3 (7×7 bottom pair / 10×10 top
 * pair); if the step-3 pass reassigns those frames, update these with them.
 */
const CORNER_TOP = 10;
const CORNER_BOTTOM = 7;

/** What the frame-border kit draws over (see {@link createFrameBorderKit}). */
interface FrameBorderDeps {
  readonly art: DetailsPanelAssets['art'];
  readonly front: Container;
  readonly scale: number;
  readonly flipY: boolean;
  readonly screen: () => { readonly w: number; readonly h: number };
}

/**
 * Build the rope-and-knot border drawer over the panel's `front` sprite layer. Returns `frameBorder(r)` —
 * the only piece the window fill needs; the strip-tiling and per-piece placement stay private to this kit.
 */
export function createFrameBorderKit(deps: FrameBorderDeps): { frameBorder: (r: Rect) => void } {
  const { art, front, scale, flipY, screen } = deps;

  /**
   * A border piece placed at an exact screen rect through the `frame` palette. Corners draw at native
   * size; edge strips pass a CLIPPED sub-frame so the rope pattern tiles instead of stretching.
   */
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
    sprite.flipY = flipY;
    front.addChild(sprite);
    const { w, h } = screen();
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

  /**
   * The rope-and-knot window border. Frame ids: rope strips 5–8, knot corners 0–3 (10×10 top pair,
   * 7×7 bottom pair) — corner placement and strip orientation are montage-calibrated guesses pending
   * the plan's step-3 human pass over the sheet.
   */
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
