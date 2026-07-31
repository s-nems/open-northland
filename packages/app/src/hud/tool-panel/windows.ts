import type { HudLayout } from '@open-northland/render';
import type { Container } from 'pixi.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import { createExtrasWindow, type ExtrasGrantsSeam } from './extras-window.js';
import type { MenuGoodEntry } from './goods-menu.js';
import { createGoodsWindow } from './goods-window.js';
import { createMenuWindow } from './menu-window.js';
import { createStatsWindow } from './stats-window.js';
import type { ToolWindow } from './window-shell.js';

/**
 * The tool panel's pop-up window layer: one owned set, so what a press hits, what claims the wheel and
 * what a frame refreshes are answered from the same windows the strip buttons toggle by id.
 */

/** The pop-ups in mount order, which is the draw order of their frames: each parents its layers under the
 *  panel's window container in turn. Text runs are re-appended on rebuild, so they land above every frame
 *  regardless of this order. */
const MOUNT_ORDER = ['menu', 'goods', 'extras', 'stats'] as const;

export type ToolWindowId = (typeof MOUNT_ORDER)[number];

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: (hudFor: () => HudLayout) => void;
}

export interface ToolWindowsDeps {
  readonly ctx: PanelContext;
  /** The panel's window container every pop-up parents its layers under (child order = draw order). */
  readonly container: Container;
  readonly buildings: readonly MenuBuildingEntry[];
  readonly goods: readonly MenuGoodEntry[];
  readonly grants: ExtrasGrantsSeam;
  readonly onPickBuilding: (typeId: number) => void;
  readonly onPickGood: (goodType: number) => void;
}

export interface ToolWindows {
  /** Each pop-up by id, as a strip button toggles and closes them (see `button-effects.ts`). */
  readonly byId: Readonly<Record<ToolWindowId, ToolWindow>>;
  claims(x: number, y: number): boolean;
  /** Offer a click to the top-drawn open pop-up over the point; true when it consumed it. */
  handleClick(x: number, y: number): boolean;
  /** Scroll a list the point is over, and report whether an open pop-up owns the wheel there (a window
   *  with nothing to scroll still owns it). */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  handleHover(x: number, y: number): void;
  refresh(hudFor: () => HudLayout): void;
}

export function createToolWindows(deps: ToolWindowsDeps): ToolWindows {
  const { ctx, container } = deps;
  const menu = createMenuWindow({
    ctx,
    buildings: deps.buildings,
    container,
    onPick: deps.onPickBuilding,
  });
  const goods = createGoodsWindow({ ctx, goods: deps.goods, container, onPick: deps.onPickGood });
  const extras = createExtrasWindow({ ctx, container, grants: deps.grants });
  const stats = createStatsWindow({ ctx, container });

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.refresh() },
    goods: {
      window: goods,
      perFrame: () => {
        if (goods.isOpen()) goods.place();
      },
    },
    extras: {
      window: extras,
      perFrame: () => {
        if (extras.isOpen()) extras.place();
      },
    },
    stats: { window: stats, perFrame: (hudFor) => stats.refresh(hudFor) },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);
  // Reverse mount order is top-drawn first: where two open pop-ups overlap, pointer input goes to the one
  // the player can see, not to the window drawn underneath it.
  const probed = [...mounted].reverse();

  const topAt = (x: number, y: number): ToolWindow | null =>
    probed.find((e) => e.window.claims(x, y))?.window ?? null;

  return {
    byId: { menu, goods, extras, stats },
    claims: (x, y) => topAt(x, y) !== null,
    handleClick: (x, y): boolean => topAt(x, y)?.handleClick(x, y) ?? false,
    handleWheel: (x, y, deltaY): boolean => {
      const top = topAt(x, y);
      if (top === null) return false;
      // The build menu is the only pop-up with a scrollable list, and it scrolls only while uncovered.
      if (top === menu) menu.handleWheel(x, y, deltaY);
      return true;
    },
    handleHover: (x, y): void => {
      if (topAt(x, y) === menu) menu.handleHover(x, y);
      else menu.clearHover(); // no row highlight under a window that would take the press
    },
    refresh: (hudFor): void => {
      for (const e of mounted) e.perFrame(hudFor);
    },
  };
}
