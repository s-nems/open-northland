import type { HudLayout, HudModel } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { AssistantWindow } from '../dom/assistant-window/index.js';
import type { ConstructionWindow } from '../dom/construction-window.js';
import type { DiplomacyWindow } from '../dom/diplomacy-window/index.js';
import type { MissionBook, MissionWindowState } from '../dom/mission-book/index.js';
import type { NetworkWindow } from '../dom/network-window.js';
import type { ResidentsWindow } from '../dom/residents-window.js';
import type { ConstructionWindowState, MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import type { HeldPaperController } from './held-paper.js';
import type { PendingWindow } from './pending-window.js';
import type { BuildingPick } from './placement.js';
import type { ResidentsWindowState } from './residents/rows.js';
import { createStatsWindow } from './stats-window.js';
import type { ClickModifiers, ToolWindow } from './window-shell.js';

/** The central windows in mount order, which is the legacy pop-ups' draw order. */
const MOUNT_ORDER = [
  'menu',
  'assistant',
  'stats',
  'diplomacy',
  'residents',
  'knowledge',
  'mission',
  'network',
] as const;

export type ToolWindowId = (typeof MOUNT_ORDER)[number];

/** The central windows whose contents a later ticket owns; the registry shows a pending note for them. */
export type PendingWindowId = Extract<ToolWindowId, 'knowledge'>;

/** The entry of a window the session does not mount: never open, toggling does nothing. */
const NO_WINDOW: ToolWindow = {
  isOpen: () => false,
  toggle: () => undefined,
  close: () => undefined,
  claims: () => false,
  handleClick: () => false,
};

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: (hudFor: () => HudLayout) => void;
}

/** What the registry hands the construction window's factory: the entries and the presses the
 *  registry routes. */
export interface ConstructionWindowSeam {
  readonly entries: readonly MenuBuildingEntry[];
  readonly onPick: (typeId: number, tribe: number) => void;
  readonly onPickPaper: (paper: Paper, tribe: number) => void;
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
  /** The assistant window, mounted on the DOM plane. */
  readonly assistantWindow: () => AssistantWindow;
  /** The mission book with its goal slip, mounted on the DOM plane. */
  readonly missionBook: () => MissionBook;
  /** The network window, mounted on the DOM plane in a relayed game only; absent, its entry stays
   *  shut. */
  readonly networkWindow?: () => NetworkWindow;
  readonly buildings: readonly MenuBuildingEntry[];
  readonly diplomacyWindow: () => DiplomacyWindow;
  /** The place-any plan the construction window holds for its next catalogue pick. */
  readonly heldPaper: HeldPaperController;
  /** A building was picked for placement, with the plan the placement spends when one is held. */
  readonly onPickBuilding: (pick: BuildingPick) => void;
}

export interface ToolWindows {
  /** Each window by id, as the beam entries toggle them. */
  readonly byId: Readonly<Record<ToolWindowId, ToolWindow>> & {
    readonly menu: ConstructionWindow;
    readonly residents: ResidentsWindow;
    readonly assistant: AssistantWindow;
  };
  /** The mission book itself, for the page a script opens it on. */
  readonly mission: MissionBook;
  /** The open central window, or null; the beam lights its entry. */
  openId(): ToolWindowId | null;
  closeAll(): void;
  claims(x: number, y: number): boolean;
  /** Offer a click to the top-drawn open pop-up over the point; true when it consumed it. */
  handleClick(x: number, y: number, mods?: ClickModifiers): boolean;
  /** Scroll a list under the point; true when an open pop-up owns the wheel there, even with nothing
   *  to scroll. */
  handleWheel(x: number, y: number, deltaY: number): boolean;
  refresh(hudFor: () => HudLayout): void;
  /** The tick's stock figures, for the construction window's cost marks and the assistant's stock. */
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
  const stats = createStatsWindow({ ctx, container });
  const diplomacy = deps.diplomacyWindow();
  const residents = deps.residentsWindow();
  const assistant = deps.assistantWindow();
  const knowledge = deps.pendingWindow('knowledge');
  const mission = deps.missionBook();
  const network = deps.networkWindow?.() ?? null;
  const networkEntry: ToolWindow = network ?? NO_WINDOW;
  /** Show `target` alone, as a beam press would. */
  const openOnly = (target: ToolWindow): void => {
    for (const id of MOUNT_ORDER) {
      if (entries[id].window !== target) entries[id].window.close();
    }
    if (!target.isOpen()) target.toggle();
  };
  const menu = deps.constructionWindow({
    entries: deps.buildings,
    onPick: (typeId, tribe) => deps.onPickBuilding({ typeId, tribe, paper: heldPaper.take() }),
    // A plan naming its house goes straight to placement; a place-any plan is held for the catalogue
    // pick, as the original's papers window does. The plan pays for the house, and nothing more: the
    // catalogue keeps its technology locks (the original's selection window keeps them too).
    onPickPaper: (paper, tribe) => {
      heldPaper.cancel(); // a plan already in hand goes back: one plan at a time
      if (paper.kind === 'placeAny') heldPaper.hold(paper);
      else deps.onPickBuilding({ typeId: paper.param, tribe, paper });
    },
    // The building's Knowledge page is the knowledge ticket's; until then the pending note stands in.
    onHelp: () => openOnly(knowledge),
  });

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.place() },
    assistant: { window: assistant, perFrame: () => assistant.refresh() },
    stats: { window: stats, perFrame: (hudFor) => stats.refresh(hudFor) },
    diplomacy: { window: diplomacy, perFrame: () => diplomacy.refresh() },
    residents: { window: residents, perFrame: () => residents.refresh() },
    knowledge: { window: knowledge, perFrame: () => knowledge.place() },
    mission: { window: mission, perFrame: () => mission.refresh() },
    network: { window: networkEntry, perFrame: () => network?.refresh() },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);
  // Reverse mount order is top-drawn first, so overlapping pop-ups route pointer input to the visible one.
  const probed = [...mounted].reverse();

  const topAt = (x: number, y: number): ToolWindow | null =>
    probed.find((e) => e.window.claims(x, y))?.window ?? null;

  return {
    byId: { menu, assistant, stats, diplomacy, residents, knowledge, mission, network: networkEntry },
    mission,
    openId: () => MOUNT_ORDER.find((id) => entries[id].window.isOpen()) ?? null,
    // A suspended construction window reports closed and keeps its placement's resume.
    closeAll: (): void => {
      for (const e of mounted) if (e.window.isOpen()) e.window.close();
    },
    claims: (x, y) => topAt(x, y) !== null,
    handleClick: (x, y, mods): boolean => topAt(x, y)?.handleClick(x, y, mods) ?? false,
    handleWheel: (x, y, _deltaY): boolean => {
      const top = topAt(x, y);
      if (top === null) return false;
      return true;
    },
    refresh: (hudFor): void => {
      if (heldPaper.held() !== null && !menu.isOpen()) heldPaper.cancel();
      for (const e of mounted) e.perFrame(hudFor);
    },
    presentStocks: (model) => {
      menu.update(model);
      assistant.update(model);
    },
    state: () => ({
      openIds: MOUNT_ORDER.filter((id) => entries[id].window.isOpen()),
      buildings: menu.state(),
      residents: residents.state(),
      diplomacy: diplomacy.state(),
      heldPaper: heldPaper.held(),
      mission: mission.state(),
    }),
    restore: (state): void => {
      const open = new Set(state.openIds);
      if (!open.has('menu')) menu.restore(state.buildings);
      if (!open.has('residents')) residents.restore(state.residents);
      diplomacy.restore(state.diplomacy);
      if (state.heldPaper === null) heldPaper.cancel();
      else heldPaper.hold(state.heldPaper);
      mission.restore(state.mission);
      for (const id of MOUNT_ORDER) {
        const window = entries[id].window;
        if (open.has(id) !== window.isOpen()) window.toggle();
      }
      if (open.has('menu')) menu.restore(state.buildings);
      if (open.has('residents')) residents.restore(state.residents);
    },
    dispose: (): void => {
      menu.dispose();
      residents.dispose();
      assistant.dispose();
      diplomacy.dispose();
      knowledge.dispose();
      mission.dispose();
      network?.dispose();
    },
  };
}
