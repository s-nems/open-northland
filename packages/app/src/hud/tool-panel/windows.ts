import type { HypertextBook } from '@open-northland/data';
import type { HudLayout } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { GuiArt } from '../../content/gui-art.js';
import type { MissionBrief } from '../../game/mission-brief.js';
import { type BuildingCategory, buildingTabbedList, type MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import { createDiplomacyWindow, type DiplomacyPanelRow } from './diplomacy/index.js';
import type { ExtrasTab } from './extras-menu.js';
import {
  createExtrasWindow,
  type ExtrasCountersSeam,
  type ExtrasGrantsSeam,
  type ExtrasPapersSeam,
} from './extras-window.js';
import { goodsTabbedList, type MenuGoodEntry } from './goods-menu.js';
import type { HeldPaperController } from './held-paper.js';
import { createMissionWindow } from './mission/index.js';
import { createStatsWindow } from './stats-window.js';
import {
  createTabbedListWindow,
  type TabbedListWindow,
  type TabbedListWindowState,
} from './tabbed-list/index.js';
import type { ClickModifiers, ToolWindow } from './window-shell.js';

/** The pop-ups in mount order, which is their draw order. */
const MOUNT_ORDER = ['menu', 'goods', 'extras', 'stats', 'diplomacy', 'mission'] as const;

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
  readonly papers: ExtrasPapersSeam;
  readonly paperLabel: (paper: Paper) => string;
  /** The diplomacy window's roster: one row per discovered player, pulled only while it is open. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  /** The decoded GUI sheet the mission window draws its papyrus from; null degrades to flat chrome. */
  readonly art: GuiArt | null;
  readonly missionBrief: () => MissionBrief | null;
  /** The mission window's history book; null shows the tab empty. */
  readonly history: HypertextBook | null;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The place-any paper a plans-tab click hands to the build menu. */
  readonly heldPaper: HeldPaperController;
  /** A building was picked for placement; `paper` is the paper the placement spends, when one is held. */
  readonly onPickBuilding: (typeId: number, paper?: Paper) => void;
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
  state(): ToolWindowsState;
  restore(state: ToolWindowsState): void;
}

export interface ToolWindowsState {
  readonly openIds: readonly ToolWindowId[];
  readonly buildings: TabbedListWindowState<BuildingCategory>;
  readonly goods: TabbedListWindowState<number>;
  readonly extras: ExtrasTab;
  readonly diplomacy: number | null;
  /** The paper the build menu holds for its next pick, restored with its banner. */
  readonly heldPaper: Paper | null;
}

export function createToolWindows(deps: ToolWindowsDeps): ToolWindows {
  const { ctx, container, heldPaper } = deps;
  const menu = createTabbedListWindow({
    ctx,
    container,
    source: buildingTabbedList(deps.buildings),
    onPick: (b) => {
      const paper = heldPaper.take();
      if (paper === null) deps.onPickBuilding(b.typeId);
      else deps.onPickBuilding(b.typeId, paper);
    },
  });
  const goods = createTabbedListWindow({
    ctx,
    container,
    source: goodsTabbedList(deps.goods),
    onPick: (g) => deps.onPickGood(g.goodType),
  });
  const extras = createExtrasWindow({
    ctx,
    container,
    grants: deps.grants,
    counters: deps.counters,
    papers: deps.papers,
    paperLabel: deps.paperLabel,
    // A house paper names its house, so it goes straight to placement; a place-any paper opens the build
    // menu to choose one, as the original's paper window does.
    onUsePaper: (paper) => {
      if (paper.kind === 'placeAny') {
        heldPaper.hold(paper);
        if (!menu.isOpen()) menu.toggle();
        return;
      }
      deps.onPickBuilding(paper.param, paper);
    },
  });
  const stats = createStatsWindow({ ctx, container });
  const diplomacy = createDiplomacyWindow({ ctx, container, rows: deps.diplomacyRows });
  const mission = createMissionWindow({
    ctx,
    container,
    art: deps.art,
    brief: deps.missionBrief,
    history: deps.history,
    ...(deps.onLargeWindow !== undefined ? { onOpenChange: deps.onLargeWindow } : {}),
  });

  /** The pop-ups that own a scrollable, hoverable list. */
  const lists: readonly TabbedListWindow<BuildingCategory | number>[] = [menu, goods];

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.refresh() },
    goods: { window: goods, perFrame: () => goods.refresh() },
    extras: { window: extras, perFrame: () => extras.refresh() },
    stats: { window: stats, perFrame: (hudFor) => stats.refresh(hudFor) },
    diplomacy: { window: diplomacy, perFrame: () => diplomacy.refresh() },
    mission: { window: mission, perFrame: () => mission.refresh() },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);
  // Reverse mount order is top-drawn first, so overlapping pop-ups route pointer input to the visible one.
  const probed = [...mounted].reverse();

  const topAt = (x: number, y: number): ToolWindow | null =>
    probed.find((e) => e.window.claims(x, y))?.window ?? null;

  return {
    byId: { menu, goods, extras, stats, diplomacy, mission },
    claims: (x, y) => topAt(x, y) !== null,
    handleClick: (x, y, mods): boolean => topAt(x, y)?.handleClick(x, y, mods) ?? false,
    handleWheel: (x, y, deltaY): boolean => {
      const top = topAt(x, y);
      if (top === null) return false;
      if (top === mission) return mission.handleWheel(x, y, deltaY);
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
      if (top === mission) mission.handleHover(x, y);
      else mission.clearHover();
    },
    refresh: (hudFor): void => {
      if (heldPaper.held() !== null && !menu.isOpen()) heldPaper.cancel();
      for (const e of mounted) e.perFrame(hudFor);
    },
    state: () => ({
      openIds: MOUNT_ORDER.filter((id) => entries[id].window.isOpen()),
      buildings: menu.state(),
      goods: goods.state(),
      extras: extras.state(),
      diplomacy: diplomacy.state(),
      heldPaper: heldPaper.held(),
    }),
    restore: (state): void => {
      menu.restore(state.buildings);
      goods.restore(state.goods);
      extras.restore(state.extras);
      diplomacy.restore(state.diplomacy);
      if (state.heldPaper === null) heldPaper.cancel();
      else heldPaper.hold(state.heldPaper);
      const open = new Set(state.openIds);
      for (const id of MOUNT_ORDER) {
        const window = entries[id].window;
        if (open.has(id) !== window.isOpen()) window.toggle();
      }
    },
  };
}
