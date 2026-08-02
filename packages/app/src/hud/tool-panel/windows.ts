import type { HudLayout } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { buildingTabbedList, type MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import { createExtrasWindow, type ExtrasGrantsSeam } from './extras-window.js';
import { goodsTabbedList, type MenuGoodEntry } from './goods-menu.js';
import { createStatsWindow } from './stats-window.js';
import { createTabbedListWindow, type TabbedListWindow } from './tabbed-list/index.js';
import type { ToolWindow } from './window-shell.js';

/**
 * The tool panel's pop-up window layer: one owned set, so what a press hits, what claims the wheel and
 * what a frame refreshes are answered from the same windows the strip buttons toggle by id.
 */

/** The pop-ups in mount order, which is their draw order: each parents one container of its own under the
 *  panel's window container in turn, so a rebuild re-appends text runs inside its own window only. */
const MOUNT_ORDER = ['menu', 'goods', 'extras', 'stats'] as const;

export type ToolWindowId = (typeof MOUNT_ORDER)[number];

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: (hudFor: () => HudLayout) => void;
}

export interface ToolWindowsDeps {
  readonly ctx: PanelContext;
  /** The panel's window container every pop-up mounts its own container under (child order = draw order). */
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
  const menu = createTabbedListWindow({
    ctx,
    container,
    source: buildingTabbedList(deps.buildings),
    onPick: (b) => deps.onPickBuilding(b.typeId),
  });
  const goods = createTabbedListWindow({
    ctx,
    container,
    source: goodsTabbedList(deps.goods),
    onPick: (g) => deps.onPickGood(g.goodType),
  });
  const extras = createExtrasWindow({ ctx, container, grants: deps.grants });
  const stats = createStatsWindow({ ctx, container });

  /** The pop-ups that own a scrollable, hoverable list - the wheel and hover routes. */
  const lists: readonly TabbedListWindow[] = [menu, goods];

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.refresh() },
    goods: { window: goods, perFrame: () => goods.refresh() },
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
      // Only a tabbed list scrolls, and only while it is the window the player can see at the point.
      for (const list of lists) {
        if (list === top) list.handleWheel(x, y, deltaY);
      }
      return true;
    },
    handleHover: (x, y): void => {
      const top = topAt(x, y);
      for (const list of lists) {
        if (list === top) list.handleHover(x, y);
        else list.clearHover(); // no row highlight under a window that would take the press
      }
    },
    refresh: (hudFor): void => {
      for (const e of mounted) e.perFrame(hudFor);
    },
  };
}
