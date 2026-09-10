import { contains, type Rect } from '../../geometry.js';
import { uiScaleFor } from '../../ui-scale.js';

/**
 * The mission window's geometry: a 500×420 window centred on the screen over the papyrus sheet, its
 * title bar and closer, three tabs, the text viewport, and the Up/Down buttons under it. The strings
 * (`miscwindow` 60-63, 66), the sheet and the history book come from the owned copy; the rects follow
 * a analysis reading of the engine build's element construction, unconfirmed against the running
 * original.
 */

export const MISSION_WINDOW_W = 500;
export const MISSION_WINDOW_H = 420;
/** Screen margin the window keeps when it has to shrink to fit (design px). */
const SCREEN_MARGIN = 8;
/** The title bar spans the top edge up to the closer's column. */
const TITLE_BAR_INSET = 2;
const TITLE_BAR_H = 14;
const TITLE_BAR_RIGHT_INSET = 22;
const CLOSE_RIGHT_INSET = 18;
const CLOSE_W = 16;
const CLOSE_H = 14;
/** The three tabs share one row, each 164 wide. */
const TAB_X = 4;
const TAB_Y = 22;
const TAB_H = 22;
const TAB_W = 164;
const TAB_GAP = 2;
/** The content element under the tabs, shrunk by its inset to the text viewport. */
const CONTENT_X = 4;
const CONTENT_Y = 52;
const CONTENT_W = 492;
const CONTENT_BOTTOM = 354;
const CONTENT_INSET = 5;
/** The Up and Down scroll buttons under the content; their rects overlap by 8 px, and the overlap
 *  belongs to Down. */
const BUTTON_Y = 358;
const BUTTON_W = 42;
const BUTTON_H = 58;
const SCROLL_UP_X = 212;
const SCROLL_DOWN_X = 246;
/** The previous and next briefing buttons at the row's two ends, shown once the shown-page history
 *  holds two pages (reading). */
const HISTORY_PREV_X = 8;
const HISTORY_NEXT_X = 450;
/** How many shown briefing pages the window remembers; the oldest drops off (reading). */
export const BRIEFING_HISTORY_LIMIT = 50;

/** The goal list's columns, in design px from the viewport origin; each wraps to the viewport's
 *  right edge. */
export const GOAL_LIST = {
  headingX: 11,
  listY: 23,
  bulletX: 11,
  textX: 31,
  gap: 4,
} as const;
/** The original prints an open goal as `o` and a done one as `X`. */
export const GOAL_OPEN_BULLET = 'o';
export const GOAL_DONE_BULLET = 'X';

const MISSION_TABS = ['task', 'goals', 'history'] as const;
export type MissionTab = (typeof MISSION_TABS)[number];

export const MISSION_TITLE_PX = 13;
export const MISSION_TAB_PX = 11;
export const MISSION_HEADLINE_PX = 16;
export const MISSION_HEADING_PX = 13;
export const MISSION_BODY_PX = 12;
/** Vertical rhythm (design px). */
export const HEADLINE_GAP = 10;
export const PARAGRAPH_GAP = 6;
/** One wheel notch scrolls this many design px (approximation), a button press this many (a reading of
 *  the original's step, pending a side-by-side check). */
export const WHEEL_STEP = 28;
export const BUTTON_SCROLL_STEP = 60;

/** The papyrus sheet's atlas frame: its size and the bob offsets that hang it around the window. */
export interface SheetFrame {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MissionTabRect {
  readonly tab: MissionTab;
  readonly rect: Rect;
}

export interface MissionWindowLayout {
  readonly scale: number;
  readonly window: Rect;
  /** The papyrus sheet's on-screen box, which the window claims whole; the window rect without art. */
  readonly sheet: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly MissionTabRect[];
  /** The scrolling text viewport. */
  readonly viewport: Rect;
  /** The wrap width the text runs take (design px, pre-scale). */
  readonly wrapWidth: number;
  readonly scrollUp: Rect;
  readonly scrollDown: Rect;
  readonly historyPrev: Rect;
  readonly historyNext: Rect;
}

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The window's scale: the height-derived HUD base without the player's factor, so the sheet keeps the
 * screen share it had on the original's largest mode, shrunk further only when the screen cannot hold it.
 */
export function missionWindowScale(screen: ScreenSize): number {
  const margin = 2 * SCREEN_MARGIN;
  const fit = Math.min(
    (screen.width - margin) / MISSION_WINDOW_W,
    (screen.height - margin) / MISSION_WINDOW_H,
  );
  return Math.max(Number.EPSILON, Math.min(uiScaleFor(screen.height), fit));
}

export function layoutMissionWindow(screen: ScreenSize, sheet: SheetFrame | null): MissionWindowLayout {
  const scale = missionWindowScale(screen);
  const px = (v: number): number => Math.round(v * scale);
  const w = px(MISSION_WINDOW_W);
  const h = px(MISSION_WINDOW_H);
  const x = Math.round((screen.width - w) / 2);
  const y = Math.round((screen.height - h) / 2);
  const at = (dx: number, dy: number, dw: number, dh: number): Rect => ({
    x: x + px(dx),
    y: y + px(dy),
    w: px(dw),
    h: px(dh),
  });
  const window: Rect = { x, y, w, h };
  return {
    scale,
    window,
    sheet: sheet === null ? window : at(sheet.offsetX, sheet.offsetY, sheet.width, sheet.height),
    titleRect: at(TITLE_BAR_INSET, TITLE_BAR_INSET, MISSION_WINDOW_W - TITLE_BAR_RIGHT_INSET, TITLE_BAR_H),
    closeRect: at(MISSION_WINDOW_W - CLOSE_RIGHT_INSET, TITLE_BAR_INSET, CLOSE_W, CLOSE_H),
    tabs: MISSION_TABS.map((tab, i) => ({
      tab,
      rect: at(TAB_X + i * (TAB_W + TAB_GAP), TAB_Y, TAB_W, TAB_H),
    })),
    viewport: at(
      CONTENT_X + CONTENT_INSET,
      CONTENT_Y + CONTENT_INSET,
      CONTENT_W - 2 * CONTENT_INSET,
      CONTENT_BOTTOM - CONTENT_Y - 2 * CONTENT_INSET,
    ),
    wrapWidth: CONTENT_W - 2 * CONTENT_INSET,
    scrollUp: at(SCROLL_UP_X, BUTTON_Y, BUTTON_W, BUTTON_H),
    scrollDown: at(SCROLL_DOWN_X, BUTTON_Y, BUTTON_W, BUTTON_H),
    historyPrev: at(HISTORY_PREV_X, BUTTON_Y, BUTTON_W, BUTTON_H),
    historyNext: at(HISTORY_NEXT_X, BUTTON_Y, BUTTON_W, BUTTON_H),
  };
}

export type MissionHit =
  | { readonly kind: 'close' }
  | { readonly kind: 'tab'; readonly tab: MissionTab }
  | { readonly kind: 'scroll'; readonly direction: -1 | 1 }
  | { readonly kind: 'history'; readonly direction: -1 | 1 }
  | { readonly kind: 'text'; readonly x: number; readonly y: number }
  | { readonly kind: 'window' }
  | null;

/** What a click lands on; a text hit carries its offset from the viewport origin in screen px, and the
 *  sheet's torn margin counts as the window so a click there never reaches the world. */
export function hitTestMissionWindow(layout: MissionWindowLayout, x: number, y: number): MissionHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  const tab = layout.tabs.find((t) => contains(t.rect, x, y));
  if (tab !== undefined) return { kind: 'tab', tab: tab.tab };
  if (contains(layout.scrollDown, x, y)) return { kind: 'scroll', direction: 1 };
  if (contains(layout.scrollUp, x, y)) return { kind: 'scroll', direction: -1 };
  if (contains(layout.historyPrev, x, y)) return { kind: 'history', direction: -1 };
  if (contains(layout.historyNext, x, y)) return { kind: 'history', direction: 1 };
  if (contains(layout.viewport, x, y))
    return { kind: 'text', x: x - layout.viewport.x, y: y - layout.viewport.y };
  if (contains(layout.sheet, x, y)) return { kind: 'window' };
  return null;
}

/**
 * The shown-page history with `page` added: a page already in it stays where it was, a new one goes
 * on the end, and past {@link BRIEFING_HISTORY_LIMIT} the oldest drops off (reading).
 */
export function withShownPage(history: readonly number[], page: number): number[] {
  if (history.includes(page)) return [...history];
  const next = [...history, page];
  return next.length > BRIEFING_HISTORY_LIMIT ? next.slice(next.length - BRIEFING_HISTORY_LIMIT) : next;
}

/** The page `direction` steps from `page` in the history, or null at either end or off the list. */
export function neighbouringPage(
  history: readonly number[],
  page: number | null,
  direction: -1 | 1,
): number | null {
  if (page === null) return null;
  const at = history.indexOf(page);
  if (at < 0) return null;
  return history[at + direction] ?? null;
}

/** The scroll offset clamped to what the content can scroll by; zero when it fits. */
export function clampScroll(offset: number, contentHeight: number, viewportHeight: number): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.min(max, Math.max(0, offset));
}

/** Where a run sits, in screen px from the viewport origin (unscrolled), and what it links to. */
export interface PlacedLink {
  /** Left edge of a left-aligned run; a centred run is placed from the viewport's middle instead. */
  readonly x: number;
  readonly width: number;
  readonly centred: boolean;
  readonly y: number;
  readonly h: number;
  readonly link: string | null;
}

/** The left edge a run is placed at, for a viewport `viewportW` wide. */
export function placedLeft(run: PlacedLink, viewportW: number): number {
  return run.centred ? (viewportW - run.width) / 2 : run.x;
}

/** The linked run under (`x`, `y`) (content px), or null off a link. */
export function linkedRunAt(
  placed: readonly PlacedLink[],
  viewportW: number,
  x: number,
  y: number,
): PlacedLink | null {
  for (const p of placed) {
    if (p.link === null) continue;
    const left = placedLeft(p, viewportW);
    if (y >= p.y && y < p.y + p.h && x >= left && x < left + p.width) return p;
  }
  return null;
}
