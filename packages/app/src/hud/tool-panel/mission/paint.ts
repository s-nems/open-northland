import type { Container, Graphics } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../../content/gui-art.js';
import { drawBevel, WINDOW_BORDER } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { MissionWindowLayout, ScreenSize, SheetFrame } from './model.js';

/** The papyrus sheet the original draws behind this window only (`ls_gui_window` frame 25); its bob
 *  offsets hang the torn edges outside the window rect. */
const SHEET_GFX = 0x19;
const SCROLL_UP_GFX = 0x8a;
const SCROLL_DOWN_GFX = 0x8b;
/** The bobs the original's window builds its previous and next briefing buttons from (reading). */
const HISTORY_PREV_GFX = 0x8c;
const HISTORY_NEXT_GFX = 0x8d;
/** The flat parchment stand-in for the sheet when the decoded GUI art is absent. */
const FALLBACK_SHEET_FILL = 0xd8c8a2;
/** The flat fallback arrow (design px) when the decoded GUI sheet is absent. */
const FALLBACK_ARROW_HALF_W = 10;
const FALLBACK_ARROW_H = 14;
const FALLBACK_ARROW_COLOR = 0x5a3d1e;

/** The layers the window's chrome paints into: sprites behind, flat fallback strokes in front. */
export interface PaintTarget {
  readonly back: Container;
  readonly graphics: Graphics;
}

/** The sheet's atlas frame, so the layout can claim the whole sheet; null without decoded art. */
export function sheetFrame(art: GuiArt | null): SheetFrame | null {
  const frame = art?.layer.atlas.frames.get(SHEET_GFX);
  return frame === undefined ? null : frame;
}

/** The papyrus at the window's scale with its offsets honoured, or the flat panel over the window rect. */
export function paintSheet(
  target: PaintTarget,
  art: GuiArt | null,
  layout: MissionWindowLayout,
  screen: ScreenSize,
): void {
  const sheet =
    art === null ? null : makeGuiSprite(art, SHEET_GFX, { defaultPalette: 'papyrus', colorKey: 'full' });
  if (sheet === null) {
    const { x, y, w, h } = layout.window;
    target.graphics.rect(x, y, w, h).fill(FALLBACK_SHEET_FILL).stroke({ color: WINDOW_BORDER, width: 1 });
    drawBevel(target.graphics, layout.window, layout.scale, 'raised');
    return;
  }
  const { x, y, w, h } = layout.sheet;
  sheet.sprite.stretchToRect(x, y, w, h, screen.width, screen.height);
  target.back.addChild(sheet.sprite);
}

/** The Up and Down buttons: each arrow bob drawn from its rect's centre plus its atlas offsets, which
 *  staggers the pair (approximation pending a side-by-side check), or a flat triangle without art. */
export function paintScrollButtons(
  target: PaintTarget,
  art: GuiArt | null,
  layout: MissionWindowLayout,
  screen: ScreenSize,
): void {
  paintArrow(target, art, layout.scrollUp, SCROLL_UP_GFX, -1, layout.scale, screen);
  paintArrow(target, art, layout.scrollDown, SCROLL_DOWN_GFX, 1, layout.scale, screen);
}

/** The previous and next briefing buttons at the row's ends, the same bob treatment as the scroll pair. */
export function paintHistoryButtons(
  target: PaintTarget,
  art: GuiArt | null,
  layout: MissionWindowLayout,
  screen: ScreenSize,
): void {
  paintArrow(target, art, layout.historyPrev, HISTORY_PREV_GFX, -1, layout.scale, screen, 'x');
  paintArrow(target, art, layout.historyNext, HISTORY_NEXT_GFX, 1, layout.scale, screen, 'x');
}

function paintArrow(
  target: PaintTarget,
  art: GuiArt | null,
  rect: Rect,
  gfx: number,
  direction: -1 | 1,
  scale: number,
  screen: ScreenSize,
  axis: 'x' | 'y' = 'y',
): void {
  const sprite =
    art === null ? null : makeGuiSprite(art, gfx, { defaultPalette: 'context', colorKey: 'full' });
  if (sprite !== null) {
    const { frame } = sprite;
    sprite.sprite.stretchToRect(
      rect.x + rect.w / 2 + frame.offsetX * scale,
      rect.y + rect.h / 2 + frame.offsetY * scale,
      frame.width * scale,
      frame.height * scale,
      screen.width,
      screen.height,
    );
    target.back.addChild(sprite.sprite);
    return;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const halfW = FALLBACK_ARROW_HALF_W * scale;
  const halfH = (FALLBACK_ARROW_H * scale) / 2;
  if (axis === 'x') {
    target.graphics
      .moveTo(cx + direction * halfH, cy)
      .lineTo(cx - direction * halfH, cy - halfW)
      .lineTo(cx - direction * halfH, cy + halfW)
      .closePath()
      .fill(FALLBACK_ARROW_COLOR);
    return;
  }
  target.graphics
    .moveTo(cx, cy + direction * halfH)
    .lineTo(cx - halfW, cy - direction * halfH)
    .lineTo(cx + halfW, cy - direction * halfH)
    .closePath()
    .fill(FALLBACK_ARROW_COLOR);
}
