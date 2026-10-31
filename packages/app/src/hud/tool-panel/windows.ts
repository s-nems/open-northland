import type { HudModel } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import type { AssistantWindow } from '../dom/assistant-window/index.js';
import type { ConstructionWindow } from '../dom/construction-window.js';
import type { DiplomacyWindow } from '../dom/diplomacy-window/index.js';
import type { KnowledgeWindow } from '../dom/knowledge/window.js';
import type { MissionBook } from '../dom/mission-book/index.js';
import type { NetworkWindow } from '../dom/network/window.js';
import type { ResidentsWindow } from '../dom/residents-window.js';
import type { StatisticsWindow } from '../dom/statistics-window.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { HeldPaperController } from './held-paper.js';
import type { BuildingPick } from './placement.js';
import type { ToolWindow } from './window-shell.js';

/** The central windows in mount order. */
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

/** The entry of a window the session does not mount: never open, toggling does nothing. */
const NO_WINDOW: ToolWindow = {
  isOpen: () => false,
  toggle: () => undefined,
  close: () => undefined,
};

interface ToolWindowEntry {
  readonly window: ToolWindow;
  readonly perFrame: () => void;
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
  /** The Knowledge window, mounted on the DOM plane. */
  readonly knowledgeWindow: () => KnowledgeWindow;
  /** The construction window, mounted on the DOM plane. */
  readonly constructionWindow: (seam: ConstructionWindowSeam) => ConstructionWindow;
  /** The residents window, mounted on the DOM plane. */
  readonly residentsWindow: () => ResidentsWindow;
  /** The assistant window, mounted on the DOM plane. */
  readonly assistantWindow: () => AssistantWindow;
  /** The statistics window, mounted on the DOM plane. */
  readonly statisticsWindow: () => StatisticsWindow;
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
    readonly diplomacy: DiplomacyWindow;
    readonly knowledge: KnowledgeWindow;
  };
  /** The mission book itself, for the page a script opens it on. */
  readonly mission: MissionBook;
  /** The open central window, or null; the beam lights its entry. */
  openId(): ToolWindowId | null;
  closeAll(): void;
  /** Once a frame: re-place the open windows and redraw what changed. */
  refresh(): void;
  /** The tick's figures, for the construction window's cost marks, the assistant's stock and the
   *  statistics. */
  presentModel(model: HudModel): void;
  dispose(): void;
}

export function createToolWindows(deps: ToolWindowsDeps): ToolWindows {
  const { heldPaper } = deps;
  const stats = deps.statisticsWindow();
  const diplomacy = deps.diplomacyWindow();
  const residents = deps.residentsWindow();
  const assistant = deps.assistantWindow();
  const knowledge = deps.knowledgeWindow();
  const mission = deps.missionBook();
  const network = deps.networkWindow?.() ?? null;
  const networkEntry: ToolWindow = network ?? NO_WINDOW;
  /** Close every central window but `target`, as a beam press would. */
  const closeOthers = (target: ToolWindow): void => {
    for (const id of MOUNT_ORDER) {
      if (entries[id].window !== target) entries[id].window.close();
    }
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
    onHelp: (typeId) => {
      closeOthers(knowledge);
      knowledge.showBuilding(typeId);
    },
  });

  const entries: Readonly<Record<ToolWindowId, ToolWindowEntry>> = {
    menu: { window: menu, perFrame: () => menu.place() },
    assistant: { window: assistant, perFrame: () => assistant.refresh() },
    stats: { window: stats, perFrame: () => stats.place() },
    diplomacy: { window: diplomacy, perFrame: () => diplomacy.refresh() },
    residents: { window: residents, perFrame: () => residents.refresh() },
    knowledge: { window: knowledge, perFrame: () => knowledge.place() },
    mission: { window: mission, perFrame: () => mission.refresh() },
    network: { window: networkEntry, perFrame: () => network?.refresh() },
  };
  const mounted = MOUNT_ORDER.map((id) => entries[id]);

  return {
    byId: { menu, assistant, stats, diplomacy, residents, knowledge, mission, network: networkEntry },
    mission,
    openId: () => MOUNT_ORDER.find((id) => entries[id].window.isOpen()) ?? null,
    // A suspended construction window reports closed and keeps its placement's resume.
    closeAll: (): void => {
      for (const e of mounted) if (e.window.isOpen()) e.window.close();
    },
    refresh: (): void => {
      if (heldPaper.held() !== null && !menu.isOpen()) heldPaper.cancel();
      for (const e of mounted) e.perFrame();
    },
    presentModel: (model) => {
      menu.update(model);
      assistant.update(model);
      stats.update(model);
    },
    dispose: (): void => {
      menu.dispose();
      residents.dispose();
      assistant.dispose();
      stats.dispose();
      diplomacy.dispose();
      knowledge.dispose();
      mission.dispose();
      network?.dispose();
    },
  };
}
