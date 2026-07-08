import { type Container, Graphics } from 'pixi.js';
import type { TextRun } from '../bitmap-text.js';
import { SELECT_ALPHA, WIN_PAD, drawCloseX, drawWindowPanel } from '../chrome.js';
import { HOVER_TINT } from '../chrome.js';
import { contains } from '../geometry.js';
import {
  type BuildingCategory,
  type BuildingMenuLayout,
  type MenuBuildingEntry,
  hitTestBuildingMenu,
  layoutBuildingMenu,
} from './building-menu.js';
import type { PanelContext } from './context.js';

/** Text insets (design px) tuning where a run sits inside its rect — ad-hoc nudges, named. */
const TITLE_INSET_Y = 2;
const TAB_INSET_X = 3;
const TAB_INSET_Y = 2;
const ROW_INSET_X = 2;
const ROW_INSET_Y = 1;

export interface MenuWindowDeps {
  readonly ctx: PanelContext;
  /** The buildings the menu lists (typeId + label + kind). */
  readonly buildings: readonly MenuBuildingEntry[];
  /** typeId → display label (shared with the placement banner). */
  readonly labelByType: ReadonlyMap<number, string>;
  /** The panel's window container the menu parents its graphics + text under. */
  readonly container: Container;
  /** A building row was clicked (the menu closes itself first) — the panel enters placement for it. */
  readonly onPick: (typeId: number) => void;
}

/** The pop-up building-menu window ("Zbuduj Okno"): open/close, category tabs, and the pick→place hand-off. */
export interface MenuWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; returns true when the menu consumed it. */
  handleClick(x: number, y: number): boolean;
  /** Per-frame while open: re-place the text runs against the live canvas size. */
  place(): void;
}

/**
 * Build the building-menu window controller over the pure {@link layoutBuildingMenu} geometry. Owns its
 * own `Graphics` + text runs inside `deps.container`; rebuilt on open and on a tab change, placed each
 * frame while open (cheap — placement only moves retained runs).
 */
export function createMenuWindow(deps: MenuWindowDeps): MenuWindow {
  const { ctx } = deps;
  const { scale } = ctx;

  let open = false;
  let category: BuildingCategory = 'all';
  let menuLayout: BuildingMenuLayout | null = null;
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
    menuLayout = layoutBuildingMenu(deps.buildings, { originX, originY, scale, selected: category });
    drawWindowPanel(graphics, menuLayout.window, scale);
    drawCloseX(graphics, menuLayout.closeRect, scale);

    const title = ctx.makeText(ctx.uiString('miscwindow', 0, 'Zbuduj Okno'), 'white');
    deps.container.addChild(title.container);
    runs.push(title);

    for (const tab of menuLayout.tabs) {
      if (tab.selected) {
        graphics
          .rect(tab.rect.x, tab.rect.y, tab.rect.w, tab.rect.h)
          .fill({ color: HOVER_TINT, alpha: SELECT_ALPHA });
      }
      const run = ctx.makeText(
        ctx.uiString('miscwindow', tab.stringId, tab.label),
        tab.selected ? 'white' : 'dimmed',
      );
      deps.container.addChild(run.container);
      runs.push(run);
    }
    for (const row of menuLayout.rows) {
      const run = ctx.makeText(deps.labelByType.get(row.typeId) ?? `#${row.typeId}`, 'white');
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
      const hit = hitTestBuildingMenu(menuLayout, x, y);
      if (hit === null) return false;
      if (hit.kind === 'close') close();
      else if (hit.kind === 'tab') {
        category = hit.category;
        rebuild();
        place();
      } else if (hit.kind === 'building') {
        close();
        deps.onPick(hit.typeId);
      }
      // 'window' → consumed, no-op
      return true;
    },
    place,
  };
}
