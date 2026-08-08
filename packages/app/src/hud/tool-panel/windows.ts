import type { HudLayout } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { buildingTabbedList, type MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import { createDiplomacyWindow, type DiplomacyPanelRow } from './diplomacy/index.js';
import { createExtrasWindow, type ExtrasCountersSeam, type ExtrasGrantsSeam } from './extras-window.js';
import { goodsTabbedList, type MenuGoodEntry } from './goods-menu.js';
import { createStatsWindow } from './stats-window.js';
import { createTabbedListWindow, type TabbedListWindow } from './tabbed-list/index.js';
import type { ClickModifiers, ToolWindow } from './window-shell.js';

/** The pop-ups in mount order, which is their draw order. */
const MOUNT_ORDER = ['menu', 'goods', 'extras', 'stats', 'diplomacy'] as const;

export type ToolWindowId = (typeof MOUNT_ORDER)[number];

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: (hudFor: () => HudLayout) => void;
}

export interface ToolWindowsDeps {
  readonly ctx: PanelContext;
  /** Every pop-up mounts its own container under this one; child order is draw order. */
  readonly container: Container;
  readonly buildings: readonly MenuBuildingEntry[];
  readonly goods: readonly MenuGoodEntry[];
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
  /** The diplomacy window's roster: one row per discovered player, pulled only while it is open. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  readonly onPickBuilding: (typeId: number) => void;
  readonly onPickGood: (goodType: number) => void;
}

export interface ToolWindows {
  /** Each pop-up by id, as the strip buttons toggle them. */
  readonly byId: Readonly<Record<ToolWindowId, ToolWindow>>;
  claims(x: number, y: number): boolean;
  /** Offer a click to the top-drawn open pop-up over the point; true when it consumed it. */
  handleClick(x: number, y: number, mods?: ClickModifiers): boolean;
  /** Scroll a list under the point; true when an open pop-up owns the wheel there, even with nothing
   *  to scroll. */
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
  const extras = createExtrasWindow({ ctx, container, grants: deps.grants, counters: deps.counters });
  const stats = createStatsWindow({ ctx, container });
  const diplomacy = createDiplomacyWindow({ ctx, container, rows: deps.diplomacyRows });

  /** The pop-ups that own a scrollable, hoverable list. */
  const lists: readonly TabbedListWindow[] = [menu, goods];

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.refresh() },
    goods: { window: goods, perFrame: () => goods.refresh() },
    extras: { window: extras, perFrame: () => extras.refresh() },
    stats: { window: stats, perFrame: (hudFor) => stats.refresh(hudFor) },
    diplomacy: { window: diplomacy, perFrame: () => diplomacy.refresh() },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);
  // Reverse mount order is top-drawn first, so overlapping pop-ups route pointer input to the visible one.
  const probed = [...mounted].reverse();

  const topAt = (x: number, y: number): ToolWindow | null =>
    probed.find((e) => e.window.claims(x, y))?.window ?? null;

  return {
    byId: { menu, goods, extras, stats, diplomacy },
    claims: (x, y) => topAt(x, y) !== null,
    handleClick: (x, y, mods): boolean => topAt(x, y)?.handleClick(x, y, mods) ?? false,
    handleWheel: (x, y, deltaY): boolean => {
      const top = topAt(x, y);
      if (top === null) return false;
      for (const list of lists) {
        if (list === top) list.handleWheel(x, y, deltaY);
      }
      return true;
    },
    handleHover: (x, y): void => {
      const top = topAt(x, y);
      for (const list of lists) {
        if (list === top) list.handleHover(x, y);
        else list.clearHover(); // no row highlight under a window that would take the press instead
      }
    },
    refresh: (hudFor): void => {
      for (const e of mounted) e.perFrame(hudFor);
    },
  };
}
