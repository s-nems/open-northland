import type { HypertextBook } from '@open-northland/data';
import type { HudLayout, HudModel } from '@open-northland/render';
import type { DiplomacyState, Paper } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { GuiArt } from '../../content/gui-art.js';
import type { MissionBrief } from '../../game/mission-brief.js';
import type { ConstructionWindow } from '../dom/construction-window.js';
import type { ResidentsWindow } from '../dom/residents-window.js';
import type { ConstructionWindowState, MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import { createDiplomacyWindow, type DiplomacyPanelRow } from './diplomacy/index.js';
import { createExtrasWindow, type ExtrasCountersSeam, type ExtrasGrantsSeam } from './extras-window.js';
import type { HeldPaperController } from './held-paper.js';
import {
  createMissionWindow,
  type MissionHumanLookup,
  type MissionWindow,
  type MissionWindowState,
} from './mission/index.js';
import type { PendingWindow } from './pending-window.js';
import type { ResidentsWindowState } from './residents/rows.js';
import { createStatsWindow } from './stats-window.js';
import type { ClickModifiers, ToolWindow } from './window-shell.js';

/** The central windows in mount order, which is the legacy pop-ups' draw order. */
const MOUNT_ORDER = ['menu', 'extras', 'stats', 'diplomacy', 'residents', 'knowledge', 'mission'] as const;

export type ToolWindowId = (typeof MOUNT_ORDER)[number];

/** The central windows whose contents a later ticket owns; the registry shows a pending note for them. */
export type PendingWindowId = Extract<ToolWindowId, 'knowledge'>;

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: (hudFor: () => HudLayout) => void;
}

/** What the registry hands the construction window's factory: the entries and the presses the
 *  registry routes. */
export interface ConstructionWindowSeam {
  readonly entries: readonly MenuBuildingEntry[];
  readonly onPick: (typeId: number) => void;
  readonly onPickPaper: (paper: Paper) => void;
  readonly onHelp: (typeId: number) => void;
}

export interface ToolWindowsDeps {
  readonly ctx: PanelContext;
  /** Every pop-up mounts its own container under this one; child order is draw order. */
  readonly container: Container;
  /** The pending note window for an entry without contents yet, mounted on the DOM plane. */
  readonly pendingWindow: (id: PendingWindowId) => PendingWindow;
  /** The construction window, mounted on the DOM plane. */
  readonly constructionWindow: (seam: ConstructionWindowSeam) => ConstructionWindow;
  /** The residents window, mounted on the DOM plane. */
  readonly residentsWindow: () => ResidentsWindow;
  readonly buildings: readonly MenuBuildingEntry[];
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
  /** The diplomacy window's roster: one row per discovered player, pulled only while it is open. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  /** A live pay button in the diplomacy window was pressed for the tribute slot. */
  readonly onPayTribute: (slot: number) => void;
  /** A stance button in the diplomacy window was pressed: the seat's new stance toward the player. */
  readonly onDeclareDiplomacy: (player: number, state: DiplomacyState) => void;
  /** The decoded GUI sheet the mission window draws its papyrus from; null degrades to flat chrome. */
  readonly art: GuiArt | null;
  /** The mission window's brief for a briefing page, or for the map's fallback text with null. */
  readonly missionBrief: (page: number | null) => MissionBrief | null;
  readonly missionBriefingHistory: () => readonly number[];
  /** The briefing page the mission window opens on from the beam; null before any replayable one. */
  readonly missionReplayPage: () => number | null;
  /** The mission window's history book; null shows the tab empty. */
  readonly history: HypertextBook | null;
  /** The human a briefing picture of a mission id shows; absent, those pictures draw nothing. */
  readonly missionHuman?: MissionHumanLookup;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The place-any plan the construction window holds for its next catalogue pick. */
  readonly heldPaper: HeldPaperController;
  /** A building was picked for placement; `paper` is the plan the placement spends, when one is held. */
  readonly onPickBuilding: (typeId: number, paper?: Paper) => void;
}

export interface ToolWindows {
  /** Each window by id, as the beam entries toggle them. */
  readonly byId: Readonly<Record<ToolWindowId, ToolWindow>> & { readonly menu: ConstructionWindow };
  /** The mission window itself, for the page a script opens it on. */
  readonly mission: MissionWindow;
  /** The open central window, or null; the beam lights its entry. */
  openId(): ToolWindowId | null;
  claims(x: number, y: number): boolean;
  /** Offer a click to the top-drawn open pop-up over the point; true when it consumed it. */
  handleClick(x: number, y: number, mods?: ClickModifiers): boolean;
  /** Scroll a list under the point; true when an open pop-up owns the wheel there, even with nothing
   *  to scroll. */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  handleHover(x: number, y: number): void;
  refresh(hudFor: () => HudLayout): void;
  /** The tick's stock figures, for the construction window's cost marks. */
  presentStocks(model: HudModel): void;
  state(): ToolWindowsState;
  restore(state: ToolWindowsState): void;
  dispose(): void;
}

export interface ToolWindowsState {
  readonly openIds: readonly ToolWindowId[];
  readonly buildings: ConstructionWindowState;
  readonly residents: ResidentsWindowState;
  readonly diplomacy: number | null;
  /** The plan the construction window holds for its next pick, restored with its strip. */
  readonly heldPaper: Paper | null;
  readonly mission: MissionWindowState;
}

export function createToolWindows(deps: ToolWindowsDeps): ToolWindows {
  const { ctx, container, heldPaper } = deps;
  const extras = createExtrasWindow({ ctx, container, grants: deps.grants, counters: deps.counters });
  const stats = createStatsWindow({ ctx, container });
  const diplomacy = createDiplomacyWindow({
    ctx,
    container,
    rows: deps.diplomacyRows,
    onPayTribute: deps.onPayTribute,
    onDeclareDiplomacy: deps.onDeclareDiplomacy,
  });
  const residents = deps.residentsWindow();
  const knowledge = deps.pendingWindow('knowledge');
  const mission = createMissionWindow({
    ctx,
    container,
    art: deps.art,
    brief: deps.missionBrief,
    briefingHistory: deps.missionBriefingHistory,
    replayPage: deps.missionReplayPage,
    history: deps.history,
    ...(deps.missionHuman !== undefined ? { missionHuman: deps.missionHuman } : {}),
    ...(deps.onLargeWindow !== undefined ? { onOpenChange: deps.onLargeWindow } : {}),
  });
  /** Show `target` alone, as a beam press would. */
  const openOnly = (target: ToolWindow): void => {
    for (const id of MOUNT_ORDER) {
      if (entries[id].window !== target) entries[id].window.close();
    }
    if (!target.isOpen()) target.toggle();
  };
  const menu = deps.constructionWindow({
    entries: deps.buildings,
    onPick: (typeId) => {
      const paper = heldPaper.take();
      if (paper === null) deps.onPickBuilding(typeId);
      else deps.onPickBuilding(typeId, paper);
    },
    // A plan naming its house goes straight to placement; a place-any plan is held for the catalogue
    // pick, as the original's papers window does. The plan pays for the house, and nothing more: the
    // catalogue keeps its technology locks (the original's selection window keeps them too).
    onPickPaper: (paper) => {
      heldPaper.cancel(); // a plan already in hand goes back: one plan at a time
      if (paper.kind === 'placeAny') heldPaper.hold(paper);
      else deps.onPickBuilding(paper.param, paper);
    },
    // The building's Knowledge page is the knowledge ticket's; until then the pending note stands in.
    onHelp: () => openOnly(knowledge),
  });

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.place() },
    extras: { window: extras, perFrame: () => extras.refresh() },
    stats: { window: stats, perFrame: (hudFor) => stats.refresh(hudFor) },
    diplomacy: { window: diplomacy, perFrame: () => diplomacy.refresh() },
    residents: { window: residents, perFrame: () => residents.refresh() },
    knowledge: { window: knowledge, perFrame: () => knowledge.place() },
    mission: { window: mission, perFrame: () => mission.refresh() },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);
  // Reverse mount order is top-drawn first, so overlapping pop-ups route pointer input to the visible one.
  const probed = [...mounted].reverse();

  const topAt = (x: number, y: number): ToolWindow | null =>
    probed.find((e) => e.window.claims(x, y))?.window ?? null;

  return {
    byId: { menu, extras, stats, diplomacy, residents, knowledge, mission },
    mission,
    openId: () => MOUNT_ORDER.find((id) => entries[id].window.isOpen()) ?? null,
    claims: (x, y) => topAt(x, y) !== null,
    handleClick: (x, y, mods): boolean => topAt(x, y)?.handleClick(x, y, mods) ?? false,
    handleWheel: (x, y, deltaY): boolean => {
      const top = topAt(x, y);
      if (top === null) return false;
      if (top === mission) return mission.handleWheel(x, y, deltaY);
      if (top === diplomacy) return diplomacy.handleWheel(x, y, deltaY);
      return true;
    },
    handleHover: (x, y): void => {
      if (topAt(x, y) === mission) mission.handleHover(x, y);
      else mission.clearHover();
    },
    refresh: (hudFor): void => {
      if (heldPaper.held() !== null && !menu.isOpen()) heldPaper.cancel();
      for (const e of mounted) e.perFrame(hudFor);
    },
    presentStocks: (model) => menu.update(model),
    state: () => ({
      openIds: MOUNT_ORDER.filter((id) => entries[id].window.isOpen()),
      buildings: menu.state(),
      residents: residents.state(),
      diplomacy: diplomacy.state(),
      heldPaper: heldPaper.held(),
      mission: mission.state(),
    }),
    restore: (state): void => {
      menu.restore(state.buildings);
      residents.restore(state.residents);
      diplomacy.restore(state.diplomacy);
      if (state.heldPaper === null) heldPaper.cancel();
      else heldPaper.hold(state.heldPaper);
      mission.restore(state.mission);
      const open = new Set(state.openIds);
      for (const id of MOUNT_ORDER) {
        const window = entries[id].window;
        if (open.has(id) !== window.isOpen()) window.toggle();
      }
    },
    dispose: (): void => {
      menu.dispose();
      residents.dispose();
      knowledge.dispose();
    },
  };
}
