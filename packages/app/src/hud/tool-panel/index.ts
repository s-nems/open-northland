import type { UiCue } from '@open-northland/audio';
import type { HypertextBook } from '@open-northland/data';
import type { HudLayout, HudModel, MapViewFrame, SpriteSheet } from '@open-northland/render';
import type { DiplomacyState, Paper, PlayerCommand, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Texture } from 'pixi.js';
import { professionDefForJob } from '../../catalog/professions.js';
import { loadGuiArt } from '../../content/gui-art.js';
import {
  type GuiBitmapName,
  type GuiStrings,
  loadGuiBitmap,
  loadGuiHistory,
  loadGuiStrings,
  type UiString,
  uiStringLookup,
} from '../../content/gui-gfx.js';
import { loadUiFont, type UiFont } from '../../content/ui-font.js';
import type { MissionBrief } from '../../game/mission-brief.js';
import { messages, professionLabel } from '../../i18n/index.js';
import type { AssetSet } from '../../view/settings-store.js';
import { createBuildingThumbs } from '../dom/building-thumb.js';
import { createConstructionWindow } from '../dom/construction-window.js';
import { ACTION_ART_PX, paintedIcon, RESIDENTS_TOKEN } from '../dom/icons.js';
import { createHudNav, type HudNavEntry } from '../dom/nav.js';
import { createPlacementStrip } from '../dom/placement-strip.js';
import { createHudSystemBar } from '../dom/system-bar.js';
import { clientToCanvas, type Rect } from '../geometry.js';
import type { KeyBindings } from '../keybindings.js';
import { FRAME_NATIVE, MINIMAP_ART_SCALE } from '../minimap/model.js';
import { makeUiParagraph, makeUiTextRun } from '../ui-text.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import type { DiplomacyPanelRow } from './diplomacy/index.js';
import type { ExtrasCountersSeam, ExtrasGrantsSeam } from './extras-window.js';
import type { GameSpeedChangeCause, GameSpeedControl, GameSpeedStateSpec } from './game-speed.js';
import { createHeldPaperController } from './held-paper.js';
import { createInfoLinesOverlay } from './info-lines.js';
import { createToolPanelInput, type HeldMode, type ToolPanelInput } from './input.js';
import { buildToolPanelLayout } from './layout.js';
import {
  createMessageCenter,
  type MessageFeedState,
  type MessageTarget,
  type NoticeGallery,
} from './messages/index.js';
import type { MissionHumanLookup } from './mission/index.js';
import { applyNavEntry, NAV_ENTRY_IDS, type NavEntryId, navEntryForWindow } from './nav-effects.js';
import type { PapersSeam } from './paper-cards.js';
import { paperLabel } from './paper-label.js';
import { createPendingWindow } from './pending-window.js';
import { createPlacementController } from './placement.js';
import { createSpeedControl } from './speed-control.js';
import { createToolWindows, type ToolWindowsState } from './windows.js';

/** Painted-icon size in a window head (design px). */
const TITLE_ART_PX = 43;
/** Design px between the notification column's foot and the minimap's top edge. */
const NOTICE_MINIMAP_GAP = 16;

export interface ToolPanelOptions {
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
  /** Localized name of a profession, good, or building announced by a discovery note. */
  readonly technologyLabel: (kind: 'job' | 'good' | 'house', typeId: number) => string;
  /** A good's localized name, for the paper that permits producing it. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** The content set's goods, so the summary can name a stock entry by its stable string id. */
  readonly goods: readonly { readonly typeId: number; readonly id: string }[];
  /** The asset set the map draws with; the DOM surfaces' good icons come from the same. */
  readonly assetSet: AssetSet;
  /** Language for the decoded UI strings (`pol`/`eng`); falls back to the pinned Polish labels when absent. */
  readonly lang: string;
  /** Resolved player key bindings; the input layer reads the pause key from it. */
  readonly bindings: KeyBindings;
  /** The tribe a placed building is stamped with. */
  readonly tribe: number;
  /** The player slot a placed building is owned by. */
  readonly owner: number;
  /** Submit a seat command into the sim. */
  readonly enqueue: (command: PlayerCommand) => void;
  /** The chest window's grant-switch seam (reads the sim's assistant grants, toggles one). */
  readonly grants: ExtrasGrantsSeam;
  /** The chest window's counter seam (reads the sim's assistant queues, sets one). */
  readonly counters: ExtrasCountersSeam;
  /** The construction window's papers seam (reads the sim's papers list, named for display). */
  readonly papers: PapersSeam;
  /** The roster of discovered players, one row each: read by the diplomacy window while it is open,
   *  and once a tick by the message centre. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  /** A seat's roster name, which the diplomacy rows withhold for the viewer's own and unmet seats. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** The diplomacy window's pay button: the seat pays the tribute slot. */
  readonly onPayTribute: (slot: number) => void;
  /** The diplomacy window's stance buttons: the seat declares its stance toward the player. */
  readonly onDeclareDiplomacy: (player: number, state: DiplomacyState) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule (`Simulation.placementProbe`), which gates the placement click. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Client (CSS px) → Pixi screen px mapper, shared with the unit controls. */
  readonly screenScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  /** True when a higher HUD overlay covers this client point; the panel yields the left click there so
   *  hit priority follows draw order. Right-click (cancel placement) is deliberately not deferred. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** That same overlay's box, which the pop-up lists size against. */
  readonly overlayReserve?: () => Rect | null;
  readonly onSystemMenu?: () => void;
  /** True while the system menu owns the keyboard, so Escape is not the shell's to take. */
  readonly systemMenuOpen?: () => boolean;
  /** True while the unit controls would take an Escape (a job list, an armed pick, a selection); the
   *  game menu's Escape waits for that too. */
  readonly escapeClaimed?: () => boolean;
  /** The mission window's brief for a briefing page, or the map's fallback text with null. */
  readonly missionBrief?: (page: number | null) => MissionBrief | null;
  readonly missionBriefingHistory?: () => readonly number[];
  /** The briefing page the mission window opens on from the beam; null before any replayable one. */
  readonly missionReplayPage?: () => number | null;
  /** The human a briefing picture of a mission id shows; absent, those pictures draw nothing. */
  readonly missionHuman?: MissionHumanLookup;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The map's sprite sheet, which draws a settler on its notice card and a building on its
   *  construction card; absent leaves the thumbnails bare. */
  readonly sheet?: SpriteSheet;
  /** Owner slot to team-colour slot for those figures; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  /** A pressed card: centre the view on the target and select it. */
  readonly onSelectMessageTarget?: (target: MessageTarget) => void;
  /** Set, the notification column shows one note of every type (`?debug=notices`). */
  readonly noticeGallery?: NoticeGallery;
  /** The GUI click feedback: every pressed button confirms, a cancelled hold fails. Absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
}

export interface ToolPanelController {
  /** The decoded UI string lookup the panel resolved for its language, shared with sibling overlays. */
  readonly uiString: UiString;
  /** Open the mission window (the map's briefing and goals), as the session start does; on `page`
   *  when a script asked for one. */
  openMission(page?: number): void;
  /** The on-screen info lines a map script writes for the seat, top to bottom. */
  setInfoLines(lines: readonly string[]): void;
  /** True when a client point should be claimed by the HUD (over an open window or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an open pop-up window, which owns the wheel; unlike
   *  `claimsPointer` this excludes active placement. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The building typeId currently being placed, or null when not in build mode. */
  placementType(): number | null;
  /** The paper paying for the active placement, or null for normal construction. */
  placementPaper(): Paper | null;
  /** Per-frame hook: the tick's model feeds the summary bar; the layout over it arrives as an accessor
   *  so a closed window never lays it out. */
  update(hudFor: () => HudLayout, model: HudModel): void;
  /** The world views an open briefing's pictures paint this frame; read after {@link update}. */
  mapViews(): readonly MapViewFrame[];
  /** Per-frame hook for the notification column: this frame's unfiltered sim events and the snapshot
   *  after them. */
  presentMessages(snapshot: WorldSnapshot, events: readonly SimEvent[], alpha: number): void;
  state(): ToolPanelState;
  restore(state: ToolPanelState): void;
  /** Show the session's clock as it stands, without pushing to the loop: a change made elsewhere. */
  syncSpeed(control: GameSpeedControl): void;
  dispose(): void;
}

export interface ToolPanelState {
  readonly speed: GameSpeedControl;
  readonly windows: ToolWindowsState;
  readonly placementType: number | null;
  readonly placementPaper: Paper | null;
  readonly messages: MessageFeedState;
}

interface ToolPanelAssets {
  readonly art: Awaited<ReturnType<typeof loadGuiArt>>;
  readonly strings: GuiStrings | null;
  readonly uiFont: UiFont;
  readonly bitmaps: PanelBitmaps;
  readonly history: HypertextBook | null;
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
    loadGuiArt(),
    loadGuiStrings(lang),
    loadGuiHistory(lang),
    loadUiFont(),
    loadBitmap('bg'),
    loadBitmap('bg_button'),
    loadBitmap('bg_button_hilite'),
    loadBitmap('bg_headline'),
  ]).then(([art, strings, history, uiFont, bg, button, buttonHilite, headline]) => ({
    art,
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
  const { app, canvas, enqueue, plane } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const { art, strings, uiFont, bitmaps, history } = await loadToolPanelAssets(opts.lang);

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
    const contextAt = (at: number): PanelContext => ({
      layout,
      scale: at,
      makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, at, px),
      makeParagraph: (text, color, px, wrapWidth, align, face) =>
        makeUiParagraph(uiFont.family, text, color, at, px, wrapWidth, align, face),
      bitmaps,
      uiString,
      screen: () => app.screen,
      cue: opts.onUiCue ?? ((): void => undefined),
      ...(opts.overlayReserve !== undefined ? { overlayReserve: opts.overlayReserve } : {}),
      toClient: (x, y) => {
        const { sx, sy, rect } = opts.screenScale(canvas);
        return { x: rect.left + x / sx, y: rect.top + y / sy };
      },
      atScale: contextAt,
    });
    const ctx = contextAt(scale);

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
      tribe: opts.tribe,
      owner: opts.owner,
      // A pick hid the window for the placement; a cancel brings it back where it was, and a place-any
      // plan back into the hand it was picked with, so the next pick still spends it.
      onCancel: (paper) => {
        windows.byId.menu.resume();
        if (paper?.kind === 'placeAny') heldPaper.hold(paper);
      },
    });
    const heldPaper = createHeldPaperController(ctx, strip);
    // A cancel runs the modes in this order, so the plan a cancelled placement hands back stays held
    // until the next cancel drops it: one rung per press.
    const held: readonly HeldMode[] = [heldPaper, placement];
    const cancelHeld = (): void => {
      for (const mode of held) mode.cancel();
    };

    // Closing a window returns keyboard focus to the beam entry that owns it.
    let focusOwner: ((id: NavEntryId) => void) | null = null;
    const shellCopy = messages().hud.shell;
    const goodIdByType = new Map(opts.goods.map((g) => [g.typeId, g.id]));
    const goodTypeById = new Map(opts.goods.map((g) => [g.id, g.typeId]));
    const thumbs = createBuildingThumbs(opts.sheet, opts.tribe);
    const windows = createToolWindows({
      ctx,
      container: windowContainer,
      pendingWindow: (id) => {
        const window = createPendingWindow(plane, {
          title: shellCopy.nav[id],
          art: id === 'residents' ? RESIDENTS_TOKEN : paintedIcon(id, TITLE_ART_PX),
          kicker: shellCopy.pending,
          text: id === 'residents' ? shellCopy.residentsPending : shellCopy.knowledgePending,
          closeLabel: shellCopy.close,
        });
        window.onDismiss(() => focusOwner?.(navEntryForWindow(id)));
        return window;
      },
      constructionWindow: (seam) => {
        const window = createConstructionWindow({
          plane,
          entries: seam.entries,
          thumbs,
          assetSet: opts.assetSet,
          goodIdOf: (goodType) => goodIdByType.get(goodType),
          goodLabel: (goodType) => opts.goodLabel(goodType) ?? `#${goodType}`,
          papers: () => opts.papers.read(),
          paperLabel: nameOfPaper,
          buildingLabel: (typeId) => labelByType.get(typeId) ?? `#${typeId}`,
          onPick: seam.onPick,
          onPickPaper: seam.onPickPaper,
          onHelp: seam.onHelp,
          cue: ctx.cue,
        });
        window.onDismiss(() => focusOwner?.('build'));
        return window;
      },
      buildings: opts.buildings,
      grants: opts.grants,
      counters: opts.counters,
      heldPaper,
      diplomacyRows: opts.diplomacyRows,
      onPayTribute: opts.onPayTribute,
      onDeclareDiplomacy: opts.onDeclareDiplomacy,
      art,
      missionBrief: opts.missionBrief ?? ((): null => null),
      missionBriefingHistory: opts.missionBriefingHistory ?? (() => []),
      missionReplayPage: opts.missionReplayPage ?? ((): null => null),
      history,
      ...(opts.missionHuman !== undefined ? { missionHuman: opts.missionHuman } : {}),
      onLargeWindow: (open) => {
        // A briefing must cover the selected unit's details and its worker sprites.
        root.zIndex = open ? 1004 : 1000;
        opts.onLargeWindow?.(open);
      },
      onPickBuilding: (typeId, paper) => placement.enter(typeId, paper),
    });
    domParts.push(windows);

    const surfaces = { windows: windows.byId, cancelHeld };
    const nav = createHudNav(plane, shellCopy.navLabel, navEntries(), (id) => {
      ctx.cue('confirm');
      applyNavEntry(surfaces, id);
    });
    domParts.push(nav);
    focusOwner = (id) => nav.focus(id);

    const speed = createSpeedControl({
      onSpeedChange: opts.onSpeedChange,
      onShow: (control) => systemBar.setSpeed(control),
    });
    const systemBar = createHudSystemBar(plane, {
      summary: {
        assetSet: opts.assetSet,
        goodIdOf: (goodType) => goodIdByType.get(goodType),
        goodLabel: (goodId) => {
          const typeId = goodTypeById.get(goodId);
          return (typeId === undefined ? undefined : opts.goodLabel(typeId)) ?? goodId;
        },
      },
      onPauseToggle: () => {
        ctx.cue('confirm');
        speed.togglePause();
      },
      onSpeed: (running) => {
        ctx.cue('confirm');
        speed.setRunning(running);
      },
      onMenu: () => {
        ctx.cue('confirm');
        opts.onSystemMenu?.();
      },
    });
    domParts.push(systemBar);
    systemBar.setSpeed(speed.state());

    const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
      clientToCanvas(opts.screenScale(canvas), clientX, clientY);

    const messageCenter = createMessageCenter({
      ctx,
      plane,
      // The minimap's frame scales with the HUD like the plane does, so its design-px height is the
      // native frame at the art scale.
      bottomInset: FRAME_NATIVE.h * MINIMAP_ART_SCALE + NOTICE_MINIMAP_GAP,
      sheet: opts.sheet,
      buildingThumbs: thumbs,
      playerColourOf: opts.playerColourOf,
      localPlayer: opts.owner,
      buildingLabel: (typeId) => labelByType.get(typeId),
      paperLabel: nameOfPaper,
      technologyLabel: opts.technologyLabel,
      playerLabel: (player) =>
        opts.seatNameOf?.(player) ?? opts.diplomacyRows().find((r) => r.player === player)?.name ?? null,
      metSeats: opts.diplomacyRows,
      onSelect: (target) => opts.onSelectMessageTarget?.(target),
      gallery: opts.noticeGallery,
    });
    domParts.push(messageCenter);

    const infoLines = createInfoLinesOverlay(ctx, infoContainer);

    // Esc closes the open window and hands focus back to its beam entry.
    const closeWindow = (): boolean => {
      const open = windows.openId();
      if (open === null) return false;
      windows.byId[open].close();
      nav.focus(navEntryForWindow(open));
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
      toggleConstruction: () => {
        ctx.cue('confirm');
        applyNavEntry(surfaces, 'build');
        nav.focus('build');
      },
      togglePause: () => speed.togglePause(),
      cue: ctx.cue,
      deferToOverlay: (clientX, clientY) => {
        const { x, y } = toCanvas(clientX, clientY);
        return !windows.mission.claims(x, y) && opts.deferToOverlay?.(clientX, clientY) === true;
      },
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
      openMission: (page) => {
        if (page !== undefined) applyNavEntry(surfaces, 'mission', () => windows.mission.showPage(page));
        else if (!windows.mission.isOpen()) applyNavEntry(surfaces, 'mission');
      },
      setInfoLines: (lines) => infoLines.set(lines),
      claimsPointer,
      claimsWheel,
      placementType: () => placement.activeType(),
      placementPaper: () => placement.activePaper(),
      update(hudFor, model): void {
        systemBar.update(model);
        windows.presentStocks(model);
        windows.refresh(hudFor);
        const open = windows.openId();
        nav.setActive(open === null ? null : navEntryForWindow(open));
        infoLines.refresh();
      },
      mapViews: () => windows.mission.mapViews(),
      presentMessages: (snapshot, events, alpha) => messageCenter.present(snapshot, events, alpha),
      state: () => ({
        speed: speed.state(),
        windows: windows.state(),
        placementType: placement.activeType(),
        placementPaper: placement.activePaper(),
        messages: messageCenter.state(),
      }),
      syncSpeed(control): void {
        speed.restore(control);
      },
      restore(state): void {
        speed.restore(state.speed);
        windows.restore(state.windows);
        if (state.placementType !== null)
          placement.enter(state.placementType, state.placementPaper ?? undefined);
        messageCenter.restore(state.messages);
      },
      dispose(): void {
        infoLines.dispose();
        disposeAll();
      },
    };
  } catch (error: unknown) {
    disposeAll();
    throw error;
  }
}
