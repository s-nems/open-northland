import type { UiCue } from '@open-northland/audio';
import type { HypertextBook } from '@open-northland/data';
import type { HudLayout, HudModel, MapViewFrame, MapViewTarget, SpriteSheet } from '@open-northland/render';
import type {
  Command,
  EntitySnapshot,
  HalfCellNode,
  Paper,
  PlayerCommand,
  SimEvent,
  WorldSnapshot,
} from '@open-northland/sim';
import { type Application, Container, Texture } from 'pixi.js';
import { professionDefForJob } from '../../catalog/professions.js';
import {
  type GuiBitmapName,
  type GuiStrings,
  hypertextPictureUrl,
  loadGuiBitmap,
  loadGuiHistory,
  loadGuiStrings,
  type UiString,
  uiStringLookup,
} from '../../content/gui-gfx.js';
import { loadUiFont, type UiFont } from '../../content/ui-font.js';
import type { MissionReader } from '../../game/mission-brief.js';
import type { ObserverSeatEntry } from '../../game/observer-seats.js';
import { canonicalJobType } from '../../game/sandbox/index.js';
import type { SnapshotEntity } from '../../game/snapshot.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { messages, professionLabel } from '../../i18n/index.js';
import type { PresentationPack } from '../../presentation/pack.js';
import { type AssistantSource, createAssistantWindow } from '../dom/assistant-window/index.js';
import type { BuildingPanelWindows } from '../dom/building-panel/actions.js';
import { createBuildingThumbs } from '../dom/building-thumb.js';
import { createConstructionWindow } from '../dom/construction-window.js';
import { createNationEmblems } from '../dom/diplomacy-window/emblems.js';
import { createDiplomacyWindow } from '../dom/diplomacy-window/index.js';
import type { DiplomacySource } from '../dom/diplomacy-window/model.js';
import { ACTION_ART_PX, paintedIcon, RESIDENTS_TOKEN } from '../dom/icons.js';
import { minimapReserve } from '../dom/minimap-reserve.js';
import {
  type BookView,
  createMissionBook,
  type MissionHumanLookup,
  NO_MISSION,
} from '../dom/mission-book/index.js';
import { createHudNav, type HudNavEntry } from '../dom/nav.js';
import { createNetworkWindow } from '../dom/network-window.js';
import { createPlacementStrip } from '../dom/placement-strip.js';
import type { ClientRect } from '../dom/portrait-hole.js';
import { createResidentsWindow } from '../dom/residents-window.js';
import { createHudSystemBar, type SpeedBarLook } from '../dom/system-bar.js';
import type { CentralWindows } from '../dom/trade-window/window.js';
import { FigureFrames } from '../figures/figure-frames.js';
import { LiveFigures } from '../figures/live-figures.js';
import { clientToCanvas, type Rect } from '../geometry.js';
import { type KeyBindings, keyDisplayLabel } from '../keybindings.js';
import type { NetPanelSource } from '../network/model.js';
import { makeUiParagraph, makeUiTextRun } from '../ui-text.js';
import { CONSTRUCTION_TOOLS, type ConstructionTool, type MenuBuildingEntry } from './building-menu.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import type { GameSpeedChangeCause, GameSpeedControl, GameSpeedStateSpec } from './game-speed.js';
import { createHeldPaperController } from './held-paper.js';
import { createInfoLinesOverlay } from './info-lines.js';
import { createToolPanelInput, type HeldMode, type ToolPanelInput } from './input.js';
import { buildToolPanelLayout } from './layout.js';
import type { ActiveLine, LineNode, LinePreviewNode, LitNodes } from './line-tool.js';
import {
  createMessageCenter,
  type MessageFeedState,
  type MessageTarget,
  type MetSeat,
  type NoticeGallery,
  type WorkshopSeam,
} from './messages/index.js';
import { applyNavEntry, NAV_ENTRY_IDS, type NavEntryId, navEntryForWindow } from './nav-effects.js';
import type { PapersSeam } from './paper-cards.js';
import { paperLabel } from './paper-label.js';
import { createPendingWindow } from './pending-window.js';
import {
  type BuildingPick,
  createPlacementController,
  type GatePreview,
  type GateSites,
  type PalisadeGateProbeView,
  type PalisadePlacementMode,
  type PlacementClickAsks,
  type PlacementState,
  type RoadPreview,
} from './placement.js';
import { canBecomeOptions } from './residents/can-become.js';
import { NO_RESIDENT_FILTERS } from './residents/rows.js';
import type { ResidentsSeam } from './residents/seam.js';
import { createSpeedControl } from './speed-control.js';
import { createToolWindows, type ToolWindowsState } from './windows.js';

/** Painted-icon size in a window head (design px). */
const TITLE_ART_PX = 43;
/** Design px between the notification column's foot and the minimap's top edge. */
const NOTICE_MINIMAP_GAP = 16;

/** Graphics rows for the quick row's palisade tools; null when the map catalog has no such row. */
export interface PalisadeTools {
  readonly wall: number | null;
  readonly gate: number | null;
}

export interface ToolPanelOptions {
  readonly settlerName: (entity: SnapshotEntity) => string;
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The DOM plane the beam, the system bar, the notification column and the pending windows mount on. */
  readonly plane: HTMLElement;
  /** The resolved HUD scale; the pinned internal geometry is multiplied by this. May be fractional. */
  readonly uiscale: number;
  /** The buildings the construction window lists. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** Every building type's localized name, for the notes, the papers and the placement strip. */
  readonly buildingLabels: ReadonlyMap<number, string>;
  /** Localized name of a profession, good, or building a note names; undefined when no catalog names it. */
  readonly technologyName: (kind: 'job' | 'good' | 'house', typeId: number) => string | undefined;
  /** A good's localized name, for the paper that permits producing it. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** The content set's goods, so the summary can name a stock entry by its stable string id. */
  readonly goods: readonly { readonly typeId: number; readonly id: string }[];
  /** The pack the map draws with, or null for the original's art; DOM good icons follow it. */
  readonly pack: PresentationPack | null;
  /** Localized name of a vehicle type, which leads its refused-order notes. */
  readonly vehicleLabel: (typeId: number) => string | undefined;
  /** Language for the decoded UI strings (`pol`/`eng`/`ger`/`rus`); falls back to the authored catalog when absent. */
  readonly lang: string;
  /** Resolved player key bindings; the input layer reads the pause key from it. */
  readonly bindings: KeyBindings;
  /** The seat's own tribe: the construction window's default nation, and the one roads and walls lay
   *  for. */
  readonly tribe: number;
  /** The nations the seat may build houses of, its own first; the construction window reads it a tick. */
  readonly buildTribes: () => readonly number[];
  /** The building whose body stands for a nation on the construction window's switch. */
  readonly nationEmblemType?: number;
  /** The player slot a placed building is owned by. */
  readonly owner: number;
  /** Whose notes the column shows. */
  readonly viewer: ViewerSeat;
  /** A spectator's seat picker on the system bar: the seats it may watch and where its choice goes. */
  readonly observer?: {
    readonly seats: readonly ObserverSeatEntry[];
    readonly onWatch: (seat: number | null) => void;
  };
  /** Submit a seat command into the sim. */
  readonly enqueue: (command: PlayerCommand) => void;
  /** The admin channel, for the debug palette's standing-wall line; absent where world edits are off. */
  readonly enqueueTrusted?: (command: Command) => void;
  /** The assistant window's live state, commands and tooltip chip. */
  readonly assistant: AssistantSource;
  /** The construction window's papers seam (reads the sim's papers list, named for display). */
  readonly papers: PapersSeam;
  /** The residents window's seam: the seat's people, the sim's trade rule and the selection. */
  readonly residents: ResidentsSeam;
  /** The roster of discovered players, one row each, which the diplomacy window reads while it is open. */
  readonly diplomacy: DiplomacySource;
  /** The discovered players and their stance toward the viewer, which the message centre reads a tick. */
  readonly metSeats: () => readonly MetSeat[];
  /** A seat's roster name, which the diplomacy rows withhold for the viewer's own and unmet seats. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule (`SessionHost.placementProbe`), which gates the placement click. */
  readonly canPlaceAt: (typeId: number, tribe: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlacePalisadeAt?: (
    gfxIndex: number,
    col: number,
    row: number,
    overUpgradeGround?: boolean,
  ) => boolean;
  readonly palisadeBuiltAt?: (owner: number, col: number, row: number) => boolean;
  readonly palisadeAnswersKey?: () => string;
  readonly palisadeGateProbe?: (col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeGateSites?: () => GateSites;
  /** Where a road site may be ordered; absent, the road tool stays disabled. */
  readonly canPlaceRoadAt?: (col: number, row: number, overUpgradeGround?: boolean) => boolean;
  /** Whether a road or a road site already lies on a node. */
  readonly roadBuiltAt?: (col: number, row: number) => boolean;
  readonly roadAnswersKey?: () => string;
  /** The seat's own road site on a node, which the road tool's Alt line cancels. */
  readonly ownRoadSiteAt?: (col: number, row: number) => number | null;
  /** The placement rules a click asks the sim as it lands. */
  readonly placementClickAsks?: PlacementClickAsks;
  /** The wall and closed-gate graphics rows the quick row's palisade and gate tools place; a missing
   *  row leaves its button disabled. */
  readonly palisadeTools?: PalisadeTools;
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Whether the session clock stands, so the bar lights the pause for any stop, not only its own. */
  readonly clockPaused?: () => boolean;
  /** True while an overlay outside the panel holds the game paused; a speed press then waits. */
  readonly pauseHeld?: () => boolean;
  /** Client (CSS px) → Pixi screen px mapper, shared with the unit controls. */
  readonly screenScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  /** True when a higher HUD overlay covers this client point; the panel yields the left click there so
   *  hit priority follows draw order. Right-click (cancel placement) is deliberately not deferred. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** That same overlay's box, which the pop-up lists size against. */
  readonly overlayReserve?: () => Rect | null;
  readonly onSystemMenu?: () => void;
  /** Open the game menu on its load or save page; load is absent where the session cannot swap worlds. */
  readonly onLoadGame?: () => void;
  readonly onSaveGame?: () => void;
  /** The HUD-toggle hotkey was pressed. */
  readonly onToggleHud?: () => void;
  /** True while the system menu owns the keyboard, so Escape is not the shell's to take. */
  readonly systemMenuOpen?: () => boolean;
  /** True while the unit controls would take an Escape (a job list, an armed pick, a selection); the
   *  game menu's Escape waits for that too. */
  readonly escapeClaimed?: () => boolean;
  /** The mission book's pages and goals; absent, the book stays empty. */
  readonly mission?: MissionReader;
  readonly missionBriefingHistory?: () => readonly number[];
  /** The briefing page the mission book opens on from the beam; null before any replayable one. */
  readonly missionReplayPage?: () => number | null;
  /** The human a briefing picture of a mission id shows; absent, those pictures draw nothing. */
  readonly missionHuman?: MissionHumanLookup;
  /** Bumped when a mission read above lands anew, which rebuilds an open mission book. */
  readonly missionAnswersVersion?: () => number;
  /** The open mission book holds the game. */
  readonly onMissionHold?: (held: boolean) => void;
  /** Whether a held pause stops the clock; false on a shared clock. */
  readonly pauseStopsClock?: boolean;
  /** A world view's "show on map" was pressed. */
  readonly onShowOnMap?: (target: MapViewTarget) => void;
  /** The map's sprite sheet, which draws a settler on its notice card and a building on its
   *  construction card; absent leaves the thumbnails bare. */
  readonly sheet?: SpriteSheet;
  /** Owner slot to team-colour slot for those figures; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  /** A pressed card: centre the view on the target and select it. */
  readonly onSelectMessageTarget?: (target: MessageTarget) => void;
  /** An attack note just shown as a new card, at its hit. */
  readonly onAttackShown?: (at: HalfCellNode) => void;
  /** Set, the notification column shows one note of every type (`?debug=notices`). */
  readonly noticeGallery?: NoticeGallery;
  /** The seat's workshops and the sim's diagnosis of their workers, for the stalled-workshop notes. */
  readonly workshops?: WorkshopSeam;
  /** The vehicle build sites, which an unlock note lists as vehicles. */
  readonly isVehicleSite?: (typeId: number) => boolean;
  /** The GUI click feedback: every pressed button confirms, a cancelled hold fails. Absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
  /** A relayed game's network panel feed; absent, the network window and its hotkey do not exist. */
  readonly network?: NetPanelSource;
}

export interface ToolPanelController {
  /** The decoded UI string lookup the panel resolved for its language, shared with sibling overlays. */
  readonly uiString: UiString;
  /** The sheet's recoloured-frame cache, shared with the details panels' figure painters. */
  readonly figureFrames: FigureFrames;
  /** Open the mission book (the map's briefing and goals), as the session start does; on `page` when a
   *  script asked for one, which holds the game while it shows. */
  openMission(page?: number): void;
  /** The on-screen info lines a map script writes for the seat, top to bottom. */
  setInfoLines(lines: readonly string[]): void;
  /** Hide the info lines with the rest of the HUD. Hiding closes the open windows, so none is left
   *  taking presses unseen; a window opened while hidden shows. */
  setHudHidden(hidden: boolean): void;
  /** The central windows the beam opens, for a window opened elsewhere that shares the centre (the
   *  trade window): one central window at a time. The building panel opens two of them on its subject. */
  readonly centralWindows: CentralWindows & BuildingPanelWindows;
  /** True when a client point should be claimed by the HUD (over an open window or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an open pop-up window, which owns the wheel; unlike
   *  `claimsPointer` this excludes active placement. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The building being placed, its nation and paying plan, or null when not in build mode. */
  placementBuilding(): BuildingPick | null;
  /** The source wall/gate graphics row currently held for placement. */
  palisadeGfxIndex(): number | null;
  palisadeMode(): PalisadePlacementMode | null;
  /** The road tool is held. */
  roadActive(): boolean;
  roadPreview(tile: LineNode | null): RoadPreview | null;
  /** Arm the wall line tool to lay finished walls for `owner` through the admin channel; false when the
   *  map has no wall row or world edits are off. */
  enterStandingWall(owner: number, tribe: number): boolean;
  palisadePreview(tile: LineNode | null): readonly LinePreviewNode[] | null;
  gatePreview(tile: LineNode | null): GatePreview | null;
  /** The started wall line, for the reach wash; null before its first click. */
  activeLine(): ActiveLine | null;
  /** Where the wall tool's first click starts a line; null outside it or once a line started. */
  lineStarts(): LitNodes | null;
  /** The gate tool's lit spans; null outside the gate tool. */
  gateSites(): GateSites | null;
  /** Per-frame hook: the tick's model feeds the summary bar; the layout over it arrives as an accessor
   *  so a closed window never lays it out. */
  update(hudFor: () => HudLayout, model: HudModel): void;
  /** The world views the open mission book shows this frame; read after {@link update}. */
  mapViews(): readonly MapViewFrame[];
  /** Per-frame hook for the notification column: this frame's unfiltered sim events, the snapshot
   *  after them and the entities its steps removed. */
  presentMessages(
    snapshot: WorldSnapshot,
    events: readonly SimEvent[],
    departed: readonly EntitySnapshot[],
    alpha: number,
  ): void;
  /** Per-frame hook for the residents window's row figures; `alpha` is the frame's inter-tick
   *  fraction. */
  presentFigures(snapshot: WorldSnapshot, alpha: number): void;
  state(): ToolPanelState;
  restore(state: ToolPanelState): void;
  /** Show the session's clock as it stands, without pushing to the loop: a change made elsewhere. */
  syncSpeed(control: GameSpeedControl): void;
  /** How the speed segments read beside the control; while `held`, the pause and speed presses are
   *  refused, from the bar and the keys alike. */
  setSpeedLook(look: SpeedBarLook | null): void;
  /** Open the network window alone, as the game menu and the net status line do; nothing outside a
   *  relayed game. */
  openNetwork(): void;
  closeNetwork(): void;
  /** True while the network window is open; the chat log and the net status line step aside for it. */
  networkOpen(): boolean;
  /** Hang `node` just left of the top-right bar; null takes it down. */
  hangBesideBar(node: HTMLElement | null): void;
  dispose(): void;
}

export interface ToolPanelState {
  readonly speed: GameSpeedControl;
  readonly windows: ToolWindowsState;
  readonly placement: PlacementState;
  readonly messages: MessageFeedState;
  readonly hudHidden: boolean;
}

interface ToolPanelAssets {
  readonly strings: GuiStrings | null;
  readonly uiFont: UiFont;
  readonly bitmaps: PanelBitmaps;
  readonly history: HypertextBook | null;
}

/** The road button's tooltip: its key, when bound, and what a stone paves. */
function roadToolHint(key: string | null): string {
  const copy = messages().hud.construction;
  return key === null ? `${copy.road}: ${copy.roadHint}` : `${copy.road} (${key}): ${copy.roadHint}`;
}

/** The palisade button's tooltip: its label and key, when bound. */
function palisadeToolHint(key: string | null): string {
  const label = messages().hud.construction.palisade;
  return key === null ? label : `${label} (${key})`;
}

const assetsByLanguage = new Map<string, Promise<ToolPanelAssets>>();

function loadToolPanelAssets(lang: string): Promise<ToolPanelAssets> {
  let assets = assetsByLanguage.get(lang);
  if (assets !== undefined) return assets;
  const loadBitmap = async (name: GuiBitmapName): Promise<Texture | undefined> => {
    const source = await loadGuiBitmap(name);
    return source === undefined ? undefined : new Texture({ source });
  };
  assets = Promise.all([
    loadGuiStrings(lang),
    loadGuiHistory(lang),
    loadUiFont(),
    loadBitmap('bg'),
    loadBitmap('bg_button'),
    loadBitmap('bg_button_hilite'),
    loadBitmap('bg_headline'),
  ]).then(([strings, history, uiFont, bg, button, buttonHilite, headline]) => ({
    strings,
    uiFont,
    bitmaps: { bg, button, buttonHilite, headline },
    history,
  }));
  assetsByLanguage.set(lang, assets);
  // A rejected load would otherwise pin every later rebuild to the one transient failure.
  void assets.catch(() => assetsByLanguage.delete(lang));
  return assets;
}

const NO_FRAMES: readonly MapViewFrame[] = [];

/** The beam's seven entries: painted icons from the ui pack, the wooden token for the residents. */
function navEntries(): readonly HudNavEntry<NavEntryId>[] {
  const labels = messages().hud.shell.nav;
  return NAV_ENTRY_IDS.map((id) => ({
    id,
    label: labels[id],
    art: id === 'residents' ? RESIDENTS_TOKEN : paintedIcon(id, ACTION_ART_PX),
  }));
}

/** Mount the tool panel: the legacy pop-ups on the app stage and the shell regions on the DOM plane.
 *  Async because it loads the optional decoded GUI art and font. */
export async function mountToolPanel(opts: ToolPanelOptions): Promise<ToolPanelController> {
  const { app, canvas, enqueue, plane, network } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const { strings, uiFont, bitmaps, history } = await loadToolPanelAssets(opts.lang);

  const labelByType = opts.buildingLabels;

  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const infoContainer = new Container();
  const windowContainer = new Container();
  root.addChild(infoContainer, windowContainer);

  const domParts: { dispose(): void }[] = [];
  let input: ToolPanelInput | null = null;
  const disposeAll = (): void => {
    input?.dispose();
    for (const part of domParts.splice(0).reverse()) part.dispose();
    root.destroy({ children: true });
  };
  try {
    const uiString = uiStringLookup(strings);
    const ctx: PanelContext = {
      layout,
      scale,
      makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, scale, px),
      makeParagraph: (text, color, px, wrapWidth) =>
        makeUiParagraph(uiFont.family, text, color, scale, px, wrapWidth),
      bitmaps,
      uiString,
      screen: () => app.screen,
      cue: opts.onUiCue ?? ((): void => undefined),
      ...(opts.overlayReserve !== undefined ? { overlayReserve: opts.overlayReserve } : {}),
      toClient: (x, y) => {
        const { sx, sy, rect } = opts.screenScale(canvas);
        return { x: rect.left + x / sx, y: rect.top + y / sy };
      },
    };

    const nameOfPaper = (paper: Paper): string =>
      paperLabel(paper, {
        uiString: ctx.uiString,
        buildingLabel: (typeId) => labelByType.get(typeId),
        jobLabel: (typeId) => {
          const def = professionDefForJob(typeId);
          return def === undefined ? undefined : professionLabel(def.key);
        },
        goodLabel: opts.goodLabel,
      });
    const strip = createPlacementStrip(plane);
    domParts.push(strip);
    const placement = createPlacementController({
      ctx,
      strip,
      labelByType,
      enqueue,
      screenToTile: opts.screenToTile,
      canPlaceAt: opts.canPlaceAt,
      ...(opts.canPlacePalisadeAt !== undefined ? { canPlacePalisadeAt: opts.canPlacePalisadeAt } : {}),
      ...(opts.palisadeBuiltAt !== undefined ? { palisadeBuiltAt: opts.palisadeBuiltAt } : {}),
      ...(opts.palisadeAnswersKey !== undefined ? { palisadeAnswersKey: opts.palisadeAnswersKey } : {}),
      ...(opts.palisadeGateProbe !== undefined ? { palisadeGateProbe: opts.palisadeGateProbe } : {}),
      ...(opts.palisadeGateSites !== undefined ? { palisadeGateSites: opts.palisadeGateSites } : {}),
      ...(opts.canPlaceRoadAt !== undefined ? { canPlaceRoadAt: opts.canPlaceRoadAt } : {}),
      ...(opts.roadBuiltAt !== undefined ? { roadBuiltAt: opts.roadBuiltAt } : {}),
      ...(opts.roadAnswersKey !== undefined ? { roadAnswersKey: opts.roadAnswersKey } : {}),
      ...(opts.ownRoadSiteAt !== undefined ? { ownRoadSiteAt: opts.ownRoadSiteAt } : {}),
      ...(opts.placementClickAsks !== undefined ? { clickAsks: opts.placementClickAsks } : {}),
      ...(opts.enqueueTrusted !== undefined ? { enqueueTrusted: opts.enqueueTrusted } : {}),
      upgradeGroundKey: () => {
        const binding = opts.bindings.upgradeGround;
        return binding === null ? null : keyDisplayLabel(binding);
      },
      tribe: opts.tribe,
      owner: opts.owner,
      // A pick hid the window for the placement; its cancel brings it back where it was, and a place-any
      // plan back into the hand it was picked with, so the next pick still spends it.
      onCancel: (paper) => {
        windows.byId.menu.resume();
        if (paper?.kind === 'placeAny') heldPaper.hold(paper);
      },
    });
    const heldPaper = createHeldPaperController(ctx, strip);
    const palisadeToolRow = (tool: ConstructionTool): number | null =>
      tool === 'palisade'
        ? (opts.palisadeTools?.wall ?? null)
        : tool === 'gate'
          ? (opts.palisadeTools?.gate ?? null)
          : null;
    const roadOffered = opts.canPlaceRoadAt !== undefined;
    const wallRow = palisadeToolRow('palisade');
    const gateRow = palisadeToolRow('gate');
    const toolOffered = (tool: ConstructionTool): boolean =>
      tool === 'road' ? roadOffered : palisadeToolRow(tool) !== null;
    const keyLabel = (action: 'roadTool' | 'palisadeTool'): string | null => {
      const binding = opts.bindings[action];
      return binding === null ? null : keyDisplayLabel(binding);
    };
    // A cancel runs the modes in this order, so the plan a cancelled placement hands back stays held
    // until the next cancel drops it: one rung per press.
    const held: readonly HeldMode[] = [heldPaper, placement];
    const cancelHeld = (): void => {
      for (const mode of held) mode.cancel();
    };

    // The slip opens the book the way the beam does; the beam's surfaces exist once the windows do.
    let openGoals: (() => void) | null = null;
    // Closing a window returns keyboard focus to the beam entry that owns it.
    let focusOwner: ((id: NavEntryId | null) => void) | null = null;
    const shellCopy = messages().hud.shell;
    const goodIdByType = new Map(opts.goods.map((g) => [g.typeId, g.id]));
    const goodTypeById = new Map(opts.goods.map((g) => [g.id, g.typeId]));
    const thumbs = createBuildingThumbs(opts.sheet, opts.tribe);
    const figureFrames = new FigureFrames(opts.sheet);
    const residentFigures = new LiveFigures(opts.sheet, figureFrames, opts.playerColourOf);
    const windows = createToolWindows({
      ctx,
      container: windowContainer,
      pendingWindow: (id) => {
        const window = createPendingWindow(plane, {
          title: shellCopy.nav[id],
          art: paintedIcon(id, TITLE_ART_PX),
          kicker: shellCopy.pending,
          text: shellCopy.knowledgePending,
          closeLabel: shellCopy.close,
        });
        window.onDismiss(() => focusOwner?.(navEntryForWindow(id)));
        return window;
      },
      missionBook: () => {
        const book = createMissionBook({
          plane,
          reader: opts.mission ?? NO_MISSION,
          briefingHistory: opts.missionBriefingHistory ?? (() => []),
          replayPage: opts.missionReplayPage ?? ((): null => null),
          history,
          missionHuman: opts.missionHuman ?? ((): null => null),
          answersVersion: opts.missionAnswersVersion ?? ((): number => 0),
          pictureUrl: hypertextPictureUrl,
          pauseStopsClock: opts.pauseStopsClock ?? false,
          onHold: (held) => opts.onMissionHold?.(held),
          onShowOnMap: (target) => opts.onShowOnMap?.(target),
          onSlipOpen: () => openGoals?.(),
          bookKey: () => {
            const binding = opts.bindings.mission;
            return binding === null ? null : keyDisplayLabel(binding);
          },
          cue: ctx.cue,
        });
        book.onDismiss(() => focusOwner?.('mission'));
        return book;
      },
      residentsWindow: () => {
        const window = createResidentsWindow({
          plane,
          rows: opts.residents.rows,
          tick: opts.residents.tick,
          canBecome: opts.residents.canBecome,
          ...(opts.residents.answersVersion !== undefined
            ? { answersVersion: opts.residents.answersVersion }
            : {}),
          trades: canBecomeOptions(),
          selection: opts.residents.selection,
          onSelect: opts.residents.onSelect,
          ...(opts.residents.paintGood !== undefined ? { icons: opts.residents.paintGood } : {}),
          cue: ctx.cue,
        });
        window.onDismiss(() => focusOwner?.('residents'));
        return window;
      },
      ...(network !== undefined
        ? {
            networkWindow: () => createNetworkWindow({ plane, source: network, cue: ctx.cue }),
          }
        : {}),
      constructionWindow: (seam) => {
        const window = createConstructionWindow({
          plane,
          entries: seam.entries,
          thumbs,
          pack: opts.pack,
          goodIdOf: (goodType) => goodIdByType.get(goodType),
          goodLabel: (goodType) => opts.goodLabel(goodType) ?? `#${goodType}`,
          papers: () => opts.papers.read(),
          paperLabel: nameOfPaper,
          buildingLabel: (typeId) => labelByType.get(typeId) ?? `#${typeId}`,
          homeTribe: opts.tribe,
          buildTribes: opts.buildTribes,
          ...(opts.nationEmblemType !== undefined ? { emblemType: opts.nationEmblemType } : {}),
          onPick: seam.onPick,
          tools: CONSTRUCTION_TOOLS.filter(toolOffered),
          toolHints: {
            road: roadToolHint(keyLabel('roadTool')),
            palisade: palisadeToolHint(keyLabel('palisadeTool')),
          },
          onPickTool: (tool) => {
            if (tool === 'road') {
              placement.enterRoad();
              return;
            }
            const gfxIndex = palisadeToolRow(tool);
            if (gfxIndex !== null) placement.enterPalisade(gfxIndex, tool === 'gate' ? 'gate' : 'wall');
          },
          onPickPaper: seam.onPickPaper,
          onHelp: seam.onHelp,
          cue: ctx.cue,
        });
        window.onDismiss(() => focusOwner?.('build'));
        return window;
      },
      buildings: opts.buildings,
      assistantWindow: () => {
        const window = createAssistantWindow({
          ...opts.assistant,
          plane,
          art: paintedIcon('assistant', TITLE_ART_PX),
          goodTypeOf: (goodId) => goodTypeById.get(goodId),
          cue: ctx.cue,
        });
        window.onDismiss(() => focusOwner?.('assistant'));
        return window;
      },
      heldPaper,
      diplomacyWindow: () => {
        const window = createDiplomacyWindow({
          plane,
          source: opts.diplomacy,
          art: paintedIcon('diplomacy', TITLE_ART_PX),
          paintGood: opts.assistant.paintGood,
          tooltip: opts.assistant.tooltip,
          cue: ctx.cue,
          paintEmblem: createNationEmblems(
            opts.sheet,
            thumbs,
            figureFrames,
            opts.nationEmblemType,
            opts.playerColourOf,
          ),
        });
        window.onDismiss(() => focusOwner?.('diplomacy'));
        return window;
      },
      onPickBuilding: (pick) => placement.enter(pick),
    });
    domParts.push(windows);

    const surfaces = { windows: windows.byId, cancelHeld };
    /** Not a beam entry, but one central window at a time all the same: every other one closes.
     *  `open` true keeps an open window open; false toggles it, as its hotkey does. */
    const showNetwork = (open: boolean): void => {
      const target = windows.byId.network;
      for (const window of Object.values(windows.byId)) if (window !== target) window.close();
      if (!open || !target.isOpen()) target.toggle();
    };
    openGoals = () => applyNavEntry(surfaces, 'mission', () => windows.mission.openGoals());
    /** The book's views in canvas px, the same array while neither they nor the canvas moved. */
    let framed: { views: readonly BookView[]; key: string; frames: readonly MapViewFrame[] } | null = null;
    const bookFrames = (views: readonly BookView[]): readonly MapViewFrame[] => {
      if (views.length === 0) return NO_FRAMES;
      const { sx, sy, rect } = opts.screenScale(canvas);
      const key = `${sx},${sy},${rect.left},${rect.top}`;
      if (framed?.views === views && framed.key === key) return framed.frames;
      const frames = views.map((v): MapViewFrame => {
        const toCanvas = (r: ClientRect) => ({
          x: (r.left - rect.left) * sx,
          y: (r.top - rect.top) * sy,
          w: r.width * sx,
          h: r.height * sy,
        });
        const box = toCanvas(v.box);
        // Canvas px per design px of the book, which is the world's scale in a map view.
        const perDesign = v.designW === 0 ? 1 : box.w / v.designW;
        return {
          box,
          clip: toCanvas(v.clip),
          target: v.target,
          focusX: v.focusX * perDesign,
          focusY: v.focusY * perDesign,
          scale: perDesign * v.zoom,
          ...(v.soloFill !== undefined ? { soloFill: v.soloFill } : {}),
          ...(v.still !== undefined ? { still: v.still } : {}),
        };
      });
      framed = { views, key, frames };
      return frames;
    };
    const nav = createHudNav(plane, shellCopy.navLabel, navEntries(), (id) => {
      ctx.cue('confirm');
      applyNavEntry(surfaces, id);
    });
    domParts.push(nav);
    focusOwner = (id) => {
      if (id !== null) nav.focus(id);
    };

    let speedHeld = false;
    const speed = createSpeedControl({
      onSpeedChange: opts.onSpeedChange,
      onShow: (control) => systemBar.setSpeed(control),
      held: () => speedHeld || opts.pauseHeld?.() === true,
      ...(opts.clockPaused !== undefined ? { clockPaused: opts.clockPaused } : {}),
    });
    const systemBar = createHudSystemBar(plane, {
      ...(opts.observer !== undefined
        ? {
            observer: {
              seats: opts.observer.seats,
              viewer: opts.viewer,
              playerColourOf: opts.playerColourOf,
              onWatch: opts.observer.onWatch,
            },
          }
        : {}),
      summary: {
        pack: opts.pack,
        goodIdOf: (goodType) => goodIdByType.get(goodType),
        goodLabel: (goodId) => {
          const typeId = goodTypeById.get(goodId);
          return (typeId === undefined ? undefined : opts.goodLabel(typeId)) ?? goodId;
        },
      },
      onPauseToggle: () => ctx.cue(speed.togglePause() ? 'confirm' : 'fail'),
      onSpeed: (running) => ctx.cue(speed.setRunning(running) ? 'confirm' : 'fail'),
      onMenu: () => {
        ctx.cue('confirm');
        opts.onSystemMenu?.();
      },
    });
    domParts.push(systemBar);
    speed.refresh();

    const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
      clientToCanvas(opts.screenScale(canvas), clientX, clientY);

    const tradesByType = new Map(opts.buildings.map((entry) => [entry.typeId, entry.trades]));
    const messageCenter = createMessageCenter({
      settlerName: opts.settlerName,
      ctx,
      plane,
      bottomInset: () => {
        const reserve = minimapReserve(plane);
        return reserve === null ? NOTICE_MINIMAP_GAP : plane.clientHeight - reserve.y + NOTICE_MINIMAP_GAP;
      },
      sheet: opts.sheet,
      figureFrames,
      buildingThumbs: thumbs,
      playerColourOf: opts.playerColourOf,
      viewer: opts.viewer,
      buildingLabel: (typeId) => labelByType.get(typeId),
      paperLabel: nameOfPaper,
      technologyName: opts.technologyName,
      buildingTrades: (typeId) => tradesByType.get(typeId),
      vehicleLabel: opts.vehicleLabel,
      playerLabel: (player) =>
        opts.seatNameOf?.(player) ?? opts.diplomacy.rows().find((r) => r.player === player)?.name ?? null,
      metSeats: opts.metSeats,
      onSelect: (target) => opts.onSelectMessageTarget?.(target),
      onAttackShown: opts.onAttackShown,
      gallery: opts.noticeGallery,
      workshops: opts.workshops,
      isVehicleSite: opts.isVehicleSite,
    });
    domParts.push(messageCenter);

    const infoLines = createInfoLinesOverlay(ctx, infoContainer);
    let hudHidden = false;
    const applyHudHidden = (hidden: boolean): void => {
      hudHidden = hidden;
      infoContainer.visible = !hidden;
    };

    // Esc closes the open window and hands focus back to its beam entry.
    const closeWindow = (): boolean => {
      const open = windows.openId();
      if (open === null) return false;
      windows.byId[open].close();
      focusOwner?.(navEntryForWindow(open));
      return true;
    };

    input = createToolPanelInput({
      canvas,
      toCanvas,
      windows,
      held,
      bindings: opts.bindings,
      closeWindow,
      ...(opts.systemMenuOpen !== undefined ? { keyboardOwned: opts.systemMenuOpen } : {}),
      ...(opts.escapeClaimed !== undefined ? { escapeClaimed: opts.escapeClaimed } : {}),
      openMenu: () => {
        ctx.cue('confirm');
        opts.onSystemMenu?.();
      },
      toggleNav: (id) => {
        ctx.cue('confirm');
        nav.focus(id);
        applyNavEntry(surfaces, id);
      },
      togglePause: () => {
        speed.togglePause();
      },
      cycleSpeed: () => {
        speed.cycleRunning();
      },
      ...(opts.onLoadGame !== undefined
        ? {
            openLoad: () => {
              ctx.cue('confirm');
              opts.onLoadGame?.();
            },
          }
        : {}),
      ...(opts.onSaveGame !== undefined
        ? {
            openSave: () => {
              ctx.cue('confirm');
              opts.onSaveGame?.();
            },
          }
        : {}),
      toggleHud: () => opts.onToggleHud?.(),
      ...(network !== undefined
        ? {
            toggleNetwork: () => {
              ctx.cue('confirm');
              showNetwork(false);
            },
          }
        : {}),
      ...(roadOffered
        ? {
            roadTool: () => {
              ctx.cue('confirm');
              placement.enterRoad();
            },
          }
        : {}),
      ...(wallRow !== null
        ? {
            palisadeTool: () => {
              ctx.cue('confirm');
              placement.enterPalisade(wallRow, 'wall');
            },
          }
        : {}),
      ...(gateRow !== null
        ? {
            gateTool: () => {
              ctx.cue('confirm');
              placement.enterPalisade(gateRow, 'gate');
            },
          }
        : {}),
      cue: ctx.cue,
      deferToOverlay: (clientX, clientY) => opts.deferToOverlay?.(clientX, clientY) === true,
    });

    const claimsPointer = (clientX: number, clientY: number): boolean => {
      const { x, y } = toCanvas(clientX, clientY);
      if (windows.claims(x, y)) return true;
      return held.some((mode) => mode.isActive());
    };

    const claimsWheel = (clientX: number, clientY: number): boolean => {
      const { x, y } = toCanvas(clientX, clientY);
      return windows.claims(x, y);
    };

    return {
      uiString: ctx.uiString,
      figureFrames,
      openMission: (page) => {
        if (page !== undefined) applyNavEntry(surfaces, 'mission', () => windows.mission.showPage(page));
        else if (!windows.mission.isOpen()) applyNavEntry(surfaces, 'mission');
      },
      setInfoLines: (lines) => infoLines.set(lines),
      setHudHidden: (hidden) => {
        if (hidden) windows.closeAll();
        applyHudHidden(hidden);
      },
      centralWindows: {
        isOpen: () => windows.openId() !== null,
        close: () => windows.closeAll(),
        // Opened as the beam opens it, then narrowed; a trade the list cannot filter by lists everyone.
        residentsFor: (jobType) =>
          applyNavEntry(surfaces, 'residents', () => {
            const residents = windows.byId.residents;
            if (!residents.isOpen()) residents.toggle();
            // A sandbox slot's trade is rebased; the filter lists the raw trades.
            const trade = canonicalJobType(jobType);
            const offered = canBecomeOptions().find(
              ({ pick }) => pick.goodType === null && pick.jobType === trade,
            );
            residents.restore({
              ...residents.state(),
              filters: { ...NO_RESIDENT_FILTERS, canBecome: offered?.pick ?? null },
              scrollTop: 0,
            });
          }),
        // The building's Knowledge page is the knowledge ticket's; until then the pending note stands in.
        knowledge: () =>
          applyNavEntry(surfaces, 'knowledge', () => {
            if (!windows.byId.knowledge.isOpen()) windows.byId.knowledge.toggle();
          }),
      },
      claimsPointer,
      claimsWheel,
      placementBuilding: () => placement.activeBuilding(),
      palisadeGfxIndex: () => placement.activePalisade(),
      palisadeMode: () => placement.activePalisadeMode(),
      roadActive: () => placement.activeRoad(),
      roadPreview: (tile) => placement.roadPreview(tile),
      enterStandingWall: (owner, tribe): boolean => {
        const gfxIndex = opts.palisadeTools?.wall ?? null;
        if (gfxIndex === null || opts.enqueueTrusted === undefined) return false;
        placement.enterPalisade(gfxIndex, 'standingWall', { owner, tribe });
        return true;
      },
      palisadePreview: (tile) => placement.palisadePreview(tile),
      gatePreview: (tile) => placement.gatePreview(tile),
      activeLine: () => placement.activeLine(),
      lineStarts: () => placement.lineStarts(),
      gateSites: () => placement.gateSites(),
      update(hudFor, model): void {
        systemBar.update(model);
        speed.refresh();
        windows.presentStocks(model);
        windows.refresh(hudFor);
        const open = windows.openId();
        nav.setActive(open === null ? null : navEntryForWindow(open));
        nav.setMarked('mission', windows.mission.unread(), messages().hud.missionBook.beamMark);
        infoLines.refresh();
        windows.mission.dropSlip(infoLines.depth());
      },
      mapViews: () => bookFrames(windows.mission.views()),
      presentMessages: (snapshot, events, departed, alpha) =>
        messageCenter.present(snapshot, events, departed, alpha),
      presentFigures: (snapshot, alpha): void => {
        residentFigures.paint(snapshot, windows.byId.residents.figureSlots(), snapshot.tick, alpha);
      },
      state: () => ({
        speed: speed.state(),
        windows: windows.state(),
        placement: placement.state(),
        messages: messageCenter.state(),
        hudHidden,
      }),
      syncSpeed: (control) => speed.restore(control),
      setSpeedLook(look): void {
        speedHeld = look?.kind === 'held';
        systemBar.setLook(look);
      },
      openNetwork: () => showNetwork(true),
      closeNetwork: () => windows.byId.network.close(),
      networkOpen: () => windows.byId.network.isOpen(),
      hangBesideBar: (node) => systemBar.setAside(node),
      restore(state): void {
        speed.restore(state.speed);
        windows.restore(state.windows);
        placement.restore(state.placement);
        messageCenter.restore(state.messages);
        applyHudHidden(state.hudHidden);
      },
      dispose(): void {
        placement.dispose();
        infoLines.dispose();
        disposeAll();
      },
    };
  } catch (error: unknown) {
    disposeAll();
    throw error;
  }
}
