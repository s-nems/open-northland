import type { Rect } from '../../geometry.js';
import type { DiplomacyWindowLayout } from './model.js';

export interface FittedDiplomacyWindow extends DiplomacyWindowLayout {
  readonly viewport: Rect;
  readonly scrollTabs: boolean;
  readonly scroll: number;
  readonly maxScroll: number;
}

/** Screen px the window keeps clear of every screen edge (approximation). */
const SCREEN_INSET_PX = 4;
/** Design px of body a shrunken window must keep below the tabs before the tabs scroll away with it
 *  (approximation: about two rows). */
const MIN_BODY_UNDER_TABS = 72;

export function fitDiplomacyWindow(
  layout: DiplomacyWindowLayout,
  screen: { readonly width: number; readonly height: number },
  reserve: Rect | null,
  requestedScroll: number,
): FittedDiplomacyWindow {
  const inset = SCREEN_INSET_PX;
  let x = Math.max(inset, Math.min(layout.window.x, screen.width - layout.window.w - inset));
  let bottom = screen.height - inset;
  let height = Math.min(layout.window.h, bottom - inset);
  let y = Math.max(inset, Math.min(layout.window.y, bottom - height));
  if (
    reserve !== null &&
    x < reserve.x + reserve.w &&
    x + layout.window.w > reserve.x &&
    y + height > reserve.y
  ) {
    const beside = reserve.x + reserve.w;
    if (beside + layout.window.w <= screen.width) x = beside;
    else {
      bottom = Math.max(inset, reserve.y - inset);
      height = Math.min(height, bottom - inset);
      y = Math.max(inset, Math.min(y, bottom - height));
    }
  }
  const dx = x - layout.window.x;
  const dy = y - layout.window.y;
  const first = layout.bodyLines[0];
  const bodyTop = first?.y ?? layout.window.y;
  const scrollTabs = y + height - (bodyTop + dy) < MIN_BODY_UNDER_TABS * layout.scale;
  const sourceTop = scrollTabs ? layout.titleRect.y + layout.titleRect.h : bodyTop;
  const contentTop = sourceTop + dy;
  const padding = first === undefined ? 0 : first.x - layout.window.x;
  const viewport: Rect = {
    x: (first?.x ?? layout.window.x) + dx,
    y: contentTop,
    w: first?.w ?? layout.window.w,
    h: Math.max(0, y + height - padding - contentTop),
  };
  const fullHeight = layout.window.y + layout.window.h - padding - sourceTop;
  const maxScroll = Math.max(0, fullHeight - viewport.h);
  const scroll = Math.max(0, Math.min(maxScroll, requestedScroll));
  const move = (rect: Rect, offset = 0): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy - offset });
  return {
    ...layout,
    window: { ...layout.window, x, y, h: height },
    titleRect: move(layout.titleRect),
    closeRect: move(layout.closeRect),
    tabs: layout.tabs.map((tab) => ({ ...tab, rect: move(tab.rect, scrollTabs ? scroll : 0) })),
    bodyLines: layout.bodyLines.map((line) => move(line, scroll)),
    tributes: layout.tributes.map((tribute) => ({
      ...tribute,
      card: move(tribute.card, scroll),
      pay: move(tribute.pay, scroll),
      text: { x: tribute.text.x + dx, y: tribute.text.y + dy - scroll },
      lines: tribute.lines.map((line) => ({ x: line.x + dx, y: line.y + dy - scroll })),
    })),
    viewport,
    scrollTabs,
    scroll,
    maxScroll,
  };
}
