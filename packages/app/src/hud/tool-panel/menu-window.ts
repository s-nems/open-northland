import { Container, Graphics } from 'pixi.js';
import type { TextRun } from '../bitmap-text.js';
import {
  HEADLINE_FILL,
  WOOD_FILL,
  drawBevel,
  drawCloseX,
  drawHoverHighlight,
  drawPlateOutline,
  drawScrollbar,
  drawTabButton,
  drawWindowFrame,
  tileBitmap,
} from '../chrome.js';
import { type Rect, contains } from '../geometry.js';
import {
  type BuildingCategory,
  type BuildingMenuLayout,
  type MenuBuildingEntry,
  hitTestBuildingMenu,
  layoutBuildingMenu,
} from './building-menu.js';
import type { PanelContext } from './context.js';

/** Text sizes (design px) — a larger title/tab heading over the body-size building rows. */
const TITLE_PX = 13;
const TAB_PX = 11;
const ROW_PX = 11;
/** Approx. cap height (design px) of the body text — used to vertically centre a run in a chrome rect. */
const TEXT_CAP_H = 10;
/** Left inset (design px) for the left-aligned building rows. */
const ROW_INSET_X = 6;
/** Design-px inset of the headline strip inside the window frame (so the frame reads around it). */
const HEADLINE_INSET = 2;
/** How many rows one mouse-wheel event scrolls the list. */
const WHEEL_ROWS = 1;
/** Window left offset from the strip's right edge (design px), matching {@link WIN_PAD}. */
const MENU_GAP = 6;
/**
 * Bottom margin (design px) the list keeps clear of the screen foot. Combined with {@link MAX_LIST_ROWS} it
 * keeps the window a compact panel.
 */
const LIST_BOTTOM_MARGIN = 24;
/** Hard cap on visible rows so the window stays a tidy panel even on a very tall screen (the rest scroll). */
const MAX_LIST_ROWS = 13;
/** Floor on visible rows so a short screen still shows a usable list. */
const MIN_LIST_ROWS = 3;
/** Design-px chrome above the list (headline + tab row + gap) — mirrors `building-menu.ts` metrics. */
const CHROME_ABOVE_LIST = 18 + 18 + 3;
/** Building row height (design px) — mirrors `building-menu.ts` `MENU_ROW_H`. */
const ROW_H = 16;

export interface MenuWindowDeps {
  readonly ctx: PanelContext;
  /** The buildings the menu lists (typeId + localized label + kind); the rows draw their own label. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** The panel's window container the menu parents its graphics + text under. */
  readonly container: Container;
  /** A building row was clicked (the menu closes itself first) — the panel enters placement for it. */
  readonly onPick: (typeId: number) => void;
}

/** The pop-up building-menu window ("Zbuduj Okno"): open/close, category tabs, scroll, and the pick→place hand-off. */
export interface MenuWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; returns true when the menu consumed it. */
  handleClick(x: number, y: number): boolean;
  /** Route a wheel event; returns true when the menu consumed it (scrolled the list). */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Update the row-hover highlight from a canvas-space point (no-op when closed). */
  handleHover(x: number, y: number): void;
  /** Per-frame while open: re-place the text runs against the live canvas size. */
  place(): void;
}

/** The window origin: to the right of the strip, dropping from the buildings button (so it clears the
 *  top-left debug overlay instead of colliding with it). */
function menuOrigin(ctx: PanelContext): { x: number; y: number } {
  const buildingsBtn = ctx.layout.buttons.find((b) => b.id === 'buildings');
  return {
    x: ctx.layout.width + MENU_GAP * ctx.scale,
    y: buildingsBtn?.placed.y ?? ctx.layout.strip.y,
  };
}

/**
 * Build the building-menu window controller over the pure {@link layoutBuildingMenu} geometry. Owns a
 * `back` container (the tiled wood/rust/button bitmap fills), a `Graphics` (frame + bevels + scrollbar), a
 * separate hover `Graphics`, and vector text runs inside `deps.container`. The chrome is rebuilt on open,
 * tab change and scroll; the hover layer redraws on its own (cheap); the runs are placed each frame while
 * open (cheap — placement only moves retained runs). Every bitmap fill degrades to flat Graphics when the
 * decoded art is absent.
 */
export function createMenuWindow(deps: MenuWindowDeps): MenuWindow {
  const { ctx } = deps;
  const { scale } = ctx;

  let open = false;
  let category: BuildingCategory = 'all';
  let scrollTop = 0;
  let menuLayout: BuildingMenuLayout | null = null;
  let hoveredType: number | null = null;
  const runs: TextRun[] = [];
  const back = new Container();
  const graphics = new Graphics();
  const hoverG = new Graphics();
  deps.container.addChild(back, graphics, hoverG);

  /** The viewport height in rows, from the live screen height (bounded to a tidy compact panel). */
  const listRows = (): number => {
    const { height } = ctx.screen();
    const rowH = ROW_H * scale;
    const avail = height - menuOrigin(ctx).y - (CHROME_ABOVE_LIST + LIST_BOTTOM_MARGIN) * scale;
    const fit = Math.floor(avail / rowH);
    return Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, fit));
  };

  const clear = (): void => {
    for (const r of runs) r.destroy();
    runs.length = 0;
    graphics.clear();
    for (const child of back.removeChildren()) child.destroy();
  };

  /** Centre a run horizontally in `rect` (uses its native-px width) and vertically by the cap height. */
  const centre = (run: TextRun, rect: Rect, rw: number, rh: number): void => {
    const x = rect.x + Math.max(0, (rect.w - run.width * scale) / 2);
    const y = rect.y + (rect.h - TEXT_CAP_H * scale) / 2;
    run.place(Math.round(x), Math.round(y), scale, rw, rh);
  };

  const rebuild = (): void => {
    clear();
    const { x: originX, y: originY } = menuOrigin(ctx);
    menuLayout = layoutBuildingMenu(deps.buildings, {
      originX,
      originY,
      scale,
      selected: category,
      scrollTop,
      maxListRows: listRows(),
    });
    scrollTop = menuLayout.scroll.top; // clamp back (a category change can shrink the range)

    // Window body: tiled wood, framed in gilt (flat warm fill when the bitmap is absent).
    if (!tileBitmap(back, ctx.bitmaps.bg, menuLayout.window, scale)) {
      graphics
        .rect(menuLayout.window.x, menuLayout.window.y, menuLayout.window.w, menuLayout.window.h)
        .fill(WOOD_FILL);
    }
    drawWindowFrame(graphics, menuLayout.window, scale);

    // Headline band: tiled rust (flat fill fallback), inset so the frame reads around it.
    const inset = Math.round(HEADLINE_INSET * scale);
    const band: Rect = {
      x: menuLayout.titleRect.x + inset,
      y: menuLayout.titleRect.y + inset,
      w: menuLayout.titleRect.w - 2 * inset,
      h: menuLayout.titleRect.h - inset,
    };
    if (!tileBitmap(back, ctx.bitmaps.headline, band, scale)) {
      graphics.rect(band.x, band.y, band.w, band.h).fill(HEADLINE_FILL);
    }
    drawCloseX(graphics, menuLayout.closeRect, scale);

    const title = ctx.makeText(ctx.uiString('miscwindow', 0, 'Zbuduj Okno'), 'white', TITLE_PX);
    deps.container.addChild(title.container);
    runs.push(title);

    for (const tab of menuLayout.tabs) {
      const tex = tab.selected ? ctx.bitmaps.buttonHilite : ctx.bitmaps.button;
      if (tileBitmap(back, tex, tab.rect, scale)) {
        drawPlateOutline(graphics, tab.rect, scale);
        if (!tab.selected) drawBevel(graphics, tab.rect, scale, 'pressed'); // recede the inactive tabs
      } else {
        drawTabButton(graphics, tab.rect, scale, tab.selected);
      }
      const run = ctx.makeText(
        ctx.uiString('miscwindow', tab.stringId, tab.label),
        tab.selected ? 'white' : 'dimmed',
        TAB_PX,
      );
      deps.container.addChild(run.container);
      runs.push(run);
    }
    for (const row of menuLayout.rows) {
      const run = ctx.makeText(row.label, 'white', ROW_PX);
      deps.container.addChild(run.container);
      runs.push(run);
    }
    if (menuLayout.scrollbar !== undefined) {
      drawScrollbar(graphics, menuLayout.scrollbar.track, menuLayout.scrollbar.thumb, scale);
    }
    drawHover();
  };

  /** Redraw only the hover highlight (over the hovered row), leaving the chrome untouched. */
  const drawHover = (): void => {
    hoverG.clear();
    if (menuLayout === null || hoveredType === null) return;
    const row = menuLayout.rows.find((r) => r.typeId === hoveredType);
    if (row !== undefined) drawHoverHighlight(hoverG, row.rect);
  };

  const place = (): void => {
    if (menuLayout === null) return;
    const { width: rw, height: rh } = ctx.screen();
    // runs order: [title, ...tabs, ...rows]
    let i = 0;
    const title = runs[i++];
    if (title !== undefined) centre(title, menuLayout.titleRect, rw, rh);
    for (const tab of menuLayout.tabs) {
      const run = runs[i++];
      if (run !== undefined) centre(run, tab.rect, rw, rh);
    }
    for (const row of menuLayout.rows) {
      const run = runs[i++];
      if (run === undefined) continue;
      const y = row.rect.y + (row.rect.h - TEXT_CAP_H * scale) / 2;
      run.place(Math.round(row.rect.x + ROW_INSET_X * scale), Math.round(y), scale, rw, rh);
    }
  };

  const openMenu = (): void => {
    open = true;
    rebuild();
    place();
  };
  const close = (): void => {
    open = false;
    hoveredType = null;
    clear();
    hoverG.clear();
    menuLayout = null;
  };

  const scrollBy = (rows: number): void => {
    if (menuLayout === null || menuLayout.scroll.max === 0) return;
    const next = Math.max(0, Math.min(menuLayout.scroll.max, scrollTop + rows));
    if (next === scrollTop) return;
    scrollTop = next;
    rebuild();
    place();
  };

  return {
    isOpen: () => open,
    toggle: () => (open ? close() : openMenu()),
    close,
    claims: (x, y) => open && menuLayout !== null && contains(menuLayout.window, x, y),
    handleClick: (x, y): boolean => {
      if (!open || menuLayout === null) return false;
      const hit = hitTestBuildingMenu(menuLayout, x, y);
      if (hit === null) return false;
      if (hit.kind === 'close') close();
      else if (hit.kind === 'tab') {
        category = hit.category;
        scrollTop = 0;
        rebuild();
        place();
      } else if (hit.kind === 'scroll') {
        scrollBy(hit.dir * menuLayout.scroll.visible); // page toward the click
      } else if (hit.kind === 'building') {
        close();
        deps.onPick(hit.typeId);
      }
      // 'window' → consumed, no-op
      return true;
    },
    handleWheel: (x, y, deltaY): boolean => {
      if (!open || menuLayout === null || !contains(menuLayout.window, x, y)) return false;
      scrollBy(Math.sign(deltaY) * WHEEL_ROWS);
      return true;
    },
    handleHover: (x, y): void => {
      if (!open || menuLayout === null) return;
      const hit = hitTestBuildingMenu(menuLayout, x, y);
      const next = hit !== null && hit.kind === 'building' ? hit.typeId : null;
      if (next === hoveredType) return;
      hoveredType = next;
      drawHover();
    },
    place,
  };
}
