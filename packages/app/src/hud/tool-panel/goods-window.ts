import { type Container, Graphics } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import type { TextRun } from '../bitmap-text.js';
import { drawCloseX, drawWindowPanel, HOVER_ALPHA, HOVER_TINT, WIN_PAD } from '../chrome.js';
import { contains } from '../geometry.js';
import type { PanelContext } from './context.js';
import { type GoodsMenuLayout, hitTestGoodsMenu, layoutGoodsMenu, type MenuGoodEntry } from './goods-menu.js';

/** Text insets (design px) — where a run sits inside its rect. Match the building menu's nudges. */
const TITLE_INSET_Y = 2;
const TAB_INSET_X = 3;
const TAB_INSET_Y = 2;
const ROW_INSET_X = 2;
const ROW_INSET_Y = 1;

/** Open on the raw-materials tab (wood/stone/iron/…) — the goods the user reaches for first. */
const DEFAULT_CATEGORY = 2;

export interface GoodsWindowDeps {
  readonly ctx: PanelContext;
  /** The goods the palette lists (goodType + id + label). */
  readonly goods: readonly MenuGoodEntry[];
  /** The panel's window container the palette parents its graphics + text under. */
  readonly container: Container;
  /** A good row was clicked (the palette closes itself first) — the panel enters good-drop mode for it. */
  readonly onPick: (goodType: number) => void;
}

/** The pop-up goods palette ("Surowce"): open/close, category tabs, and the pick→drop hand-off. */
export interface GoodsWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; returns true when the palette consumed it. */
  handleClick(x: number, y: number): boolean;
  /** Per-frame while open: re-place the text runs against the live canvas size. */
  place(): void;
}

/**
 * Build the goods-palette window controller over the pure {@link layoutGoodsMenu} geometry — the twin of
 * `createMenuWindow` (buildings), owning its own `Graphics` + text runs inside `deps.container`, rebuilt on
 * open and on a tab change, placed each frame while open.
 */
export function createGoodsWindow(deps: GoodsWindowDeps): GoodsWindow {
  const { ctx } = deps;
  const { scale } = ctx;

  let open = false;
  let category = DEFAULT_CATEGORY;
  let menuLayout: GoodsMenuLayout | null = null;
  const runs: TextRun[] = [];
  const graphics = new Graphics();
  deps.container.addChild(graphics);

  const clear = (): void => {
    for (const r of runs) r.destroy();
    runs.length = 0;
    graphics.clear();
  };

  const rebuild = (): void => {
    clear();
    const originX = ctx.layout.width + WIN_PAD * scale;
    const originY = ctx.layout.strip.y;
    menuLayout = layoutGoodsMenu(deps.goods, { originX, originY, scale, selected: category });
    drawWindowPanel(graphics, menuLayout.window, scale);
    drawCloseX(graphics, menuLayout.closeRect, scale);

    const title = ctx.makeText(messages().hud.resources, 'white');
    deps.container.addChild(title.container);
    runs.push(title);

    for (const tab of menuLayout.tabs) {
      if (tab.selected) {
        graphics
          .rect(tab.rect.x, tab.rect.y, tab.rect.w, tab.rect.h)
          .fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
      }
      const run = ctx.makeText(tab.label, tab.selected ? 'white' : 'dimmed');
      deps.container.addChild(run.container);
      runs.push(run);
    }
    for (const row of menuLayout.rows) {
      const run = ctx.makeText(row.label, 'white');
      deps.container.addChild(run.container);
      runs.push(run);
    }
  };

  const place = (): void => {
    if (menuLayout === null) return;
    const { width: rw, height: rh } = ctx.screen();
    // runs order: [title, ...tabs, ...rows]
    let i = 0;
    runs[i++]?.place(menuLayout.titleRect.x, menuLayout.titleRect.y + TITLE_INSET_Y * scale, scale, rw, rh);
    for (const tab of menuLayout.tabs)
      runs[i++]?.place(tab.rect.x + TAB_INSET_X * scale, tab.rect.y + TAB_INSET_Y * scale, scale, rw, rh);
    for (const row of menuLayout.rows)
      runs[i++]?.place(row.rect.x + ROW_INSET_X * scale, row.rect.y + ROW_INSET_Y * scale, scale, rw, rh);
  };

  const openMenu = (): void => {
    open = true;
    rebuild();
    place();
  };
  const close = (): void => {
    open = false;
    clear();
    menuLayout = null;
  };

  return {
    isOpen: () => open,
    toggle: () => (open ? close() : openMenu()),
    close,
    claims: (x, y) => open && menuLayout !== null && contains(menuLayout.window, x, y),
    handleClick: (x, y): boolean => {
      if (!open || menuLayout === null) return false;
      const hit = hitTestGoodsMenu(menuLayout, x, y);
      if (hit === null) return false;
      if (hit.kind === 'close') close();
      else if (hit.kind === 'tab') {
        category = hit.category;
        rebuild();
        place();
      } else if (hit.kind === 'good') {
        close();
        deps.onPick(hit.goodType);
      }
      // 'window' → consumed, no-op
      return true;
    },
    place,
  };
}
