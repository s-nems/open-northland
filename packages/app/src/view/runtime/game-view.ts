import type { UiCue } from '@open-northland/audio';
import type { MapRelationFlag } from '@open-northland/data';
import type { SessionDriver } from '@open-northland/lockstep';
import type {
  DoorBadge,
  ElevationField,
  SceneTerrain,
  SpriteSheet,
  WorldRenderer,
} from '@open-northland/render';
import { fogTileVisible } from '@open-northland/render';
import {
  adminCommand,
  type Command,
  type Entity,
  type FogView,
  orderedSettler,
  type Paper,
  type PlayerCommand,
  playerCommand,
  type SaveGame,
  type SimEvent,
  type Simulation,
  type WorldSnapshot,
} from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { pickerEntries } from '../../catalog/professions.js';
import { loadGuiArt } from '../../content/gui-art.js';
import { hasDebugFlag } from '../../diag/debug-flags.js';
import {
  currentDiagGameSession,
  FrameStats,
  installSessionInstruments,
  logGpuContextLoss,
  setDiagGameSession,
} from '../../diag/index.js';
import { mapStartFocus } from '../../game/map-start.js';
import { type MissionBrief, type MissionBriefSource, missionBriefReader } from '../../game/mission-brief.js';
import type { ObserverSeatEntry } from '../../game/observer-seats.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { technologyLabel } from '../../game/technology.js';
import { fixedViewerSeat, switchableViewerSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { BuildingStockContext } from '../../hud/details-panel/model/context.js';
import { createHoverCard } from '../../hud/dom/hover-card.js';
import { mountHudDomRoot } from '../../hud/dom/root.js';
import { buildingHoverModel } from '../../hud/hover-card/building.js';
import { settlerHoverModel } from '../../hud/hover-card/settler.js';
import { type MinimapHandle, mountMinimap } from '../../hud/minimap/index.js';
import type { DiplomacyPanelRow } from '../../hud/tool-panel/diplomacy/index.js';
import type { GameSpeedControl } from '../../hud/tool-panel/game-speed.js';
import { NOTICE_GALLERY_DEBUG_FLAG } from '../../hud/tool-panel/messages/index.js';
import { MEAD_GOOD_ID, residentRows } from '../../hud/tool-panel/residents/projection.js';
import type { ResidentRow } from '../../hud/tool-panel/residents/rows.js';
import { uiScaleFor } from '../../hud/ui-scale.js';
import { currentLocale } from '../../i18n/index.js';
import { presentationPack } from '../../presentation/pack.js';
import { assistantCountersSeam } from '../assistant-counters.js';
import { assistantGrantsSeam } from '../assistant-grants.js';
import type { CameraController } from '../camera/index.js';
import {
  cameraCenteredOnTile,
  cameraCenteredOnWorld,
  clientToScreen as clientToScreenPx,
} from '../camera/index.js';
import {
  applyGameSpeed,
  buildingLabelsFromContent,
  goodLabelsFromContent,
  menuEntriesFromContent,
  mountGameToolPanel,
} from '../game-tool-panel.js';
import { createMatchResultOverlay, type MatchResultOverlay } from '../match-result.js';
import { floatParam, menuSearch } from '../params.js';
import { mountPerfOverlay } from '../perf-overlay.js';
import {
  createFogGates,
  diplomacyPanelRows,
  entityAnchor,
  memoBySnapshot,
  messageTargetAnchor,
} from '../projections/index.js';
import { createScriptEffects } from '../script-effects.js';
import { createScriptMarkers } from '../script-markers.js';
import { readStoredSettings } from '../settings-store.js';
import { createSystemMenu } from '../system-menu.js';
import { createTooltip } from '../tooltip.js';
import { createUnitControls, type UnitControls } from '../unit-controls/index.js';
import { chestTooltipLines, createWorldHover } from '../world-hover.js';
import { installDebugHandle } from './debug-handle.js';
import { mountDebugOverlays } from './debug-mounts.js';
import { startFrameLoop } from './frame-loop.js';
import {
  createLiveGameSettings,
  debugPaletteTopForUiScale,
  perfCornerForUiScale,
} from './game-live-settings.js';
import { mountGamePresentation } from './game-presentation.js';
import type { NetReadout } from './net-readout.js';
import { createPauseHolds } from './pause-holds.js';
import { createPlacementGates } from './placement-gates.js';
import { trackCanvasPointer } from './pointer-tracker.js';
import type { RafLoop } from './raf-loop.js';
import { createViewReadModels } from './read-models.js';
import { createSaveLoadSession, type SaveLoadSessionOptions } from './save-load/index.js';
import { relatedWorldLoader } from './save-load/related-world.js';
import { createScriptPresentation } from './script-presentation.js';
import { mountScriptTerrainColors } from './script-terrain-colors.js';
import { createSubMissions, type PrepareSubMission } from './sub-missions.js';
import { createTickMemoViews } from './tick-memo-views.js';
import { createWorldEventHandler } from './world-events.js';
import { createWorldTeardown } from './world-teardown.js';

/** The assembled world and per-session flags a playable entry (`?map=` or `?scene=`) hands the shared runtime. */
export interface GameViewDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  /** The viewport used to frame the initial camera, before asynchronous HUD mounts can observe a resize. */
  readonly initialViewport: { readonly width: number; readonly height: number };
  /** World renderer with its terrain already set. */
  readonly renderer: WorldRenderer;
  /** Absent in a checkout without decoded content, which leaves the animated worker field empty. */
  readonly sheet?: SpriteSheet;
  readonly sim: Simulation;
  /** The session this client runs: it decides which ticks run, owns tempo and pause, and is where every
   *  HUD command goes. */
  readonly driver: SessionDriver;
  /** True when the clock is shared with other clients: the menus and sheets that hold a local game
   *  paused hold nothing, and a file cannot be loaded over the shared world. */
  readonly sharedClock?: boolean;
  readonly confirmedMatchEnd?: () => number | null;
  readonly onReturnToMenu?: () => void;
  /** A relayed session's connection figures for the overlays; omitted in a local session. */
  readonly netReadout?: () => NetReadout | null;
  readonly parentSave?: SaveGame;
  readonly prepareSubMission?: PrepareSubMission;
  readonly validateSavedMap?: (save: SaveGame) => Promise<void>;
  readonly cameraCtl: CameraController;
  readonly terrainGrid: SceneTerrain;
  /** typeId to minimap ground colour; without it the minimap keeps its flat-tint default. */
  readonly terrainColour?: (typeId: number) => number | undefined;
  /** Per-cell minimap ground colours from a decoded map's baked ground lanes, preferred over the typeId palette. */
  readonly minimapCellColours?: Uint32Array;
  /** Map bounds in cells; half-cell consumers derive the 2x node bounds from it. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** Terrain-height field, so clicks on lifted hills resolve to the tile drawn there. */
  readonly elevation?: ElevationField;
  /** The controlled seat (`?player=N`): fog perspective, selection and orders, placement ownership, HUD economy. */
  readonly localPlayer?: number;
  /** Owner slot to its roster tribe, stamping the buildings a seat places and the admin panel's spawns.
   *  Default {@link PRIMARY_TRIBE} for every seat. */
  readonly seatTribeOf?: (player: number) => number;
  /** The civilizations this world fields - the tribes whose art the sheet loaded. */
  readonly tribes?: WorldTribes;
  /** Spectator session: no fog view, and every player's entities are pickable as if owned. */
  readonly observer?: boolean;
  /** Read-only spectator: the interactive HUD's command seam is a no-op, so a selection can inspect but never re-task. */
  readonly readOnly?: boolean;
  /** The seats a read-only spectator may watch one at a time, which mounts the seat picker; absent,
   *  the spectator watches the whole map alone. */
  readonly observerSeats?: readonly ObserverSeatEntry[];
  /** Owner slot to team-colour slot for player-coloured HUD bits. Default identity. */
  readonly playerColourOf?: (player: number) => number;
  /** Owner slot to the roster's authored seat name, which the stats header prefers over the slot id. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** The map roster's player slots; the diplomacy window lists the discovered ones. Default empty. */
  readonly rosterPlayers?: readonly number[];
  /** The map's `[playermisc]` relation rows, which hide players from the diplomacy window or its
   *  stance buttons. */
  readonly relationFlags?: readonly MapRelationFlag[];
  /** The map's own string by id: the tribute descriptions, the goal texts, the info lines and the
   *  names a map gives its settlers. */
  readonly mapText?: (stringId: number) => string | undefined;
  /** Extra per-frame hook after the standard updates. */
  readonly onFrame?: (snapshot: WorldSnapshot) => void;
  /** Sim events from the frame's step(s), delivered before the renderer draws. Skipped on frames that did not step. */
  readonly onEvents?: (events: readonly SimEvent[]) => void;
  /** The entry's world identity for save headers: the decoded map id, or `scene:<id>`. Omitted, saves
   *  carry no world token and only load back into another tokenless world. */
  readonly worldToken?: string | null;
  readonly saveEntrySearch?: string;
  readonly networkSave?: Pick<SaveLoadSessionOptions, 'sessionMetadata' | 'onSaved'>;
  /** Where the mission window's briefs come from; omitted, the window shows nothing. */
  readonly missionBriefSource?: MissionBriefSource;
  /** Open the mission window as the session starts, the original's mission briefing; the entry decides
   *  (a fresh world, and no `?intro=off`). */
  readonly introAtStart?: boolean;
  /** The map's `[misc_music]` code; omitted or null, the world plays no music. */
  readonly musicType?: number | null;
}

export interface GameViewHandle {
  readonly updateNetStatus: ReturnType<typeof createSystemMenu>['updateNetStatus'];
  /** Stop the frame loop and remove this session's HUD overlays. Idempotent. */
  destroy(): void;
  /** Aborted by {@link destroy}, including the teardown a sub-mission swap runs, so a document-level
   *  binding made for this world can end with it. */
  readonly lifetime: AbortSignal;
  /** Show a clock change another client made, so the speed button follows the session. */
  syncSpeed(control: GameSpeedControl): void;
  /** Left inset in px along the bottom edge that clears the minimap window, for overlays mounted beside
   *  this view. */
  readonly hudInsetBottomLeftPx: number;
}

const PAUSE_HOLDER_MENU = 'menu';
const PAUSE_HOLDER_MISSION = 'mission';
const PAUSE_HOLDER_VERDICT = 'verdict';
const NO_PAPERS: readonly Paper[] = [];
const NO_RESIDENTS: readonly ResidentRow[] = [];
/** Above the world layers, below the HUD plane the tool panel and the minimap share. */
const SCRIPT_OVERLAY_Z = 900;
/** Clearance between the minimap window and an overlay mounted beside it. */
const BESIDE_MINIMAP_GAP_PX = 12;

/** Mount the standard in-game HUD over the assembled world and start the session's frame loop. */
export async function startGameView(deps: GameViewDeps): Promise<GameViewHandle> {
  const { app, canvas, params, renderer, sim, driver, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;
  // A spectator's view follows the seat it chose to watch; a played session's is its own seat for good.
  const switchableSeat = deps.observer === true ? switchableViewerSeat(null) : null;
  const viewer: ViewerSeat = switchableSeat ?? fixedViewerSeat(localPlayer);
  /** The seat a per-seat read answers for; watching the whole map reads as the fallback seat. */
  const viewerPlayer = (): number => viewer.seat() ?? localPlayer;
  const wholeMap = (): boolean => viewer.seat() === null;
  const fogViewOf = (): FogView | null => {
    const seat = viewer.seat();
    return seat === null ? null : sim.fogView(seat);
  };
  const seatTribeOf = deps.seatTribeOf ?? ((): number => PRIMARY_TRIBE);
  const sharedClock = deps.sharedClock === true;
  const netReadout = deps.netReadout ?? ((): null => null);

  // Installed before the HUD mounts so the system menu sees an active recording.
  const profile = installSessionInstruments(sim, params);

  let loop: RafLoop | null = null;
  let systemMenu: ReturnType<typeof createSystemMenu> | null = null;
  const cleanup: (() => void)[] = [];
  let verdict: MatchResultOverlay | null = null;
  let destroyed = false;
  const lifetime = new AbortController();
  logGpuContextLoss(canvas, () => sim.tick, lifetime.signal);
  const teardownWorld = createWorldTeardown({
    app,
    canvas,
    renderer,
    cameraCtl,
    disposeSession: () => destroy(),
  });
  const saveLoad = createSaveLoadSession({
    ...deps.networkSave,
    captureSave: (options) => driver.captureSave(options),
    sim,
    worldToken: deps.worldToken ?? null,
    ...(deps.saveEntrySearch !== undefined ? { entrySearch: deps.saveEntrySearch } : {}),
    // A shared clock is nobody's to hold: the save dialog and the overlays above pause nothing.
    ...(deps.validateSavedMap !== undefined
      ? { loadRelatedWorld: relatedWorldLoader(deps.validateSavedMap, teardownWorld) }
      : {}),
    ...(deps.parentSave !== undefined ? { parent: deps.parentSave } : {}),
    setPaused: (paused) => {
      if (!sharedClock) driver.setPaused(paused);
    },
    isPaused: () => driver.paused,
  });
  // Three overlays hold the sim paused - the menu, the mission sheet and the verdict - so each holds
  // under its own key and none can release another's.
  const pauseHolds = createPauseHolds(saveLoad, !sharedClock);
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    lifetime.abort();
    const errors: unknown[] = [];
    for (const dispose of [
      () => loop?.stop(),
      () => systemMenu?.dispose(),
      ...cleanup.splice(0).reverse(),
      () => verdict?.dispose(),
      () => cameraCtl.dispose(),
    ]) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    // Leaving the debug seams set would pin this sim, renderer and stats for the document's lifetime.
    if (window.__opennorthland?.sim === sim) delete window.__opennorthland;
    if (currentDiagGameSession()?.sim === sim) setDiagGameSession(null);
    if (errors.length > 0) throw new AggregateError(errors, 'Game view cleanup failed');
  };
  const quitToMenu = (): void => {
    destroy();
    if (deps.onReturnToMenu !== undefined) deps.onReturnToMenu();
    else window.location.search = menuSearch();
  };

  try {
    const storedSettings = readStoredSettings();
    // `?uiscale` pins an absolute HUD scale for reproducible diagnostics; only a positive value pins.
    const uiScaleParam = floatParam(params, 'uiscale', 0);
    const pinnedUiScale = uiScaleParam > 0 ? uiScaleParam : null;
    const uiscale = pinnedUiScale ?? uiScaleFor(deps.initialViewport.height, storedSettings.uiScaleFactor);

    const lang = currentLocale();
    const pack = presentationPack(params);
    // Input owners share this stable object, updated in place by the in-game settings page.
    const keyBindings = { ...storedSettings.keyBindings };
    const frameStats = new FrameStats();

    // A checkout without a decoded sound bank degrades to silence.
    const soundDriver = await mountGamePresentation(
      params,
      renderer,
      deps.musicType ?? null,
      lifetime.signal,
    );
    cleanup.push(() => soundDriver?.close());
    // The HUD's click feedback, played straight from the input event rather than through the sim.
    const uiCue = (cue: UiCue): void => soundDriver?.cue(cue);

    // Along the bottom edge between the minimap and the details panel, clear of the notes up top.
    const perfCorner = perfCornerForUiScale(uiscale);
    const perf = mountPerfOverlay(perfCorner.left, perfCorner.right, perfCorner.bottom);
    cleanup.push(() => perf.dispose());

    // Long-lived consumers close over these predicates; the frame loop refreshes them via `setFrame`.
    const fogGates = createFogGates();

    const { canPlaceAt, canPlaceSignpostAt } = createPlacementGates(
      sim,
      fogGates,
      localPlayer,
      seatTribeOf(localPlayer),
    );

    // Assigned right after the tool panel mounts: stage order is draw order, and the minimap window
    // draws over the strip's lower buttons on a short screen.
    let minimap: MinimapHandle | undefined;

    // Client coords, null off-canvas. Tracked persistently so the frame loop reads it instead of probing
    // the sim on every mousemove.
    const pointerAt = trackCanvasPointer(canvas, lifetime.signal);

    // A read-only spectator drops every HUD command here. Sim-init commands enqueue on the sim directly.
    // The overseer seat commands every player, so its orders enter as trusted admin input instead of one
    // seat reaching into another's units.
    const readOnly = deps.readOnly === true;
    const overseer = deps.observer === true && !readOnly;
    // A trusted command has no wire: a shared session drops it rather than hand it to the relay.
    const issueTrusted = (command: Command): void => {
      if (!sharedClock) driver.submit(adminCommand(command));
    };
    const issueCommand = (command: PlayerCommand): void => {
      if (readOnly) return;
      driver.submit(overseer ? adminCommand(command) : playerCommand(localPlayer, command));
      // The ordered settler answers at once, as in the original, whatever the sim then makes of the order.
      const settler = orderedSettler(command);
      if (settler !== undefined) soundDriver?.respond(settler);
    };

    const goodLabelByType = goodLabelsFromContent(sim.content);
    const { diplomacyView, buildAvailability } = createTickMemoViews(sim, seatTribeOf);
    const diplomacyRows = (): readonly DiplomacyPanelRow[] =>
      diplomacyPanelRows(diplomacyView, {
        localPlayer: viewerPlayer(),
        rosterPlayers: deps.rosterPlayers ?? [],
        observer: wholeMap(),
        goodLabelOf: (goodType) => goodLabelByType.get(goodType),
        canPay: !readOnly,
        canDeclare: !readOnly,
        ...(deps.relationFlags !== undefined ? { relationFlags: deps.relationFlags } : {}),
        ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
        ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
        ...(deps.mapText !== undefined ? { tributeText: deps.mapText } : {}),
      });
    const mapText = deps.mapText ?? ((): undefined => undefined);
    const briefFor: (page: number | null) => MissionBrief | null =
      deps.missionBriefSource === undefined
        ? () => null
        : missionBriefReader(
            deps.missionBriefSource,
            {
              tick: () => sim.tick,
              status: () => sim.missionStatus(),
              outcome: () => sim.matchOutcome(viewerPlayer()),
            },
            mapText,
          );

    // The unit controls mount after the panel and the minimap, so a note's Select and a minimap order
    // reach them through these slots.
    let selectEntity: ((id: number) => void) | null = null;
    let unitSelection: Pick<UnitControls, 'select' | 'selectedIds' | 'selectionVersion'> | null = null;
    const NO_SELECTION: ReadonlySet<number> = new Set();
    const meadGood = sim.content.goods.find((good) => good.id === MEAD_GOOD_ID)?.typeId;
    const residentsFor = memoBySnapshot(
      (snapshot: WorldSnapshot) => {
        const seat = viewer.seat();
        return seat === null
          ? NO_RESIDENTS
          : residentRows(snapshot, { localPlayer: seat, content: sim.content, mapText, meadGood });
      },
      () => viewer.version(),
    );
    let escapeClaimed: (() => boolean) | null = null;
    let overviewPress: UnitControls['overviewPress'] | null = null;
    // Assigned once every HUD part it hides has mounted.
    let toggleHud: (() => void) | null = null;
    let hudHidden = false;
    let missionWindowOpen = false;
    // The DOM plane the redesigned HUD regions mount on; it scales with the Pixi parts.
    const hudDom = mountHudDomRoot(uiscale);
    cleanup.push(() => hudDom.dispose());
    const toolPanel = await mountGameToolPanel({
      app,
      canvas,
      plane: hudDom.element,
      uiscale,
      camera: () => cameraCtl.camera(),
      enqueue: issueCommand,
      grants: assistantGrantsSeam(sim, sim.content, viewer.seat, issueCommand, !readOnly),
      counters: assistantCountersSeam(sim, viewer.seat, issueCommand, !readOnly),
      papers: { read: () => (wholeMap() ? NO_PAPERS : sim.papers(viewerPlayer())) },
      residents: {
        rows: () => residentsFor(sim.snapshot()),
        snapshot: () => sim.snapshot(),
        canBecome: (id, jobType) => sim.canChooseJob(id as Entity, jobType),
        selection: {
          ids: () => unitSelection?.selectedIds() ?? NO_SELECTION,
          version: () => unitSelection?.selectionVersion() ?? 0,
        },
        onSelect: (ids, show) => {
          unitSelection?.select(ids);
          const [only] = ids;
          if (!show || ids.length !== 1 || only === undefined) return;
          const at = entityAnchor(sim.snapshot(), only, deps.elevation);
          if (at !== null) jumpToWorld(at.x, at.y);
        },
      },
      diplomacyRows,
      onPayTribute: (slot) => issueCommand({ kind: 'payTribute', player: localPlayer, slot }),
      onDeclareDiplomacy: (other, state) =>
        issueCommand({ kind: 'declareDiplomacy', player: localPlayer, other, state }),
      canPlaceAt,
      mapSize: deps.mapSize,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      buildings: menuEntriesFromContent(sim.content, lang).map((entry) => ({
        ...entry,
        availability: () => buildAvailability(viewerPlayer(), entry.typeId),
      })),
      buildingLabels: buildingLabelsFromContent(sim.content, lang),
      technologyLabel: (kind, typeId) => technologyLabel(sim.content, kind, typeId),
      goodLabel: (typeId) => goodLabelByType.get(typeId),
      goods: sim.content.goods,
      pack,
      lang,
      bindings: keyBindings,
      tribe: seatTribeOf(localPlayer),
      owner: localPlayer,
      viewer,
      ...(switchableSeat !== null && deps.observerSeats !== undefined
        ? { observer: { seats: deps.observerSeats, onWatch: (seat) => switchableSeat.watch(seat) } }
        : {}),
      onSpeed: (spec, cause) => applyGameSpeed(driver, spec, cause),
      clockPaused: () => driver.paused,
      pauseHeld: pauseHolds.isHeld,
      deferToOverlay: (clientX, clientY) => minimap?.claimsPointer(clientX, clientY) ?? false,
      overlayReserve: () => minimap?.panelRect() ?? null,
      onSystemMenu: () => systemMenu?.toggle(),
      onToggleHud: () => toggleHud?.(),
      systemMenuOpen: () => systemMenu?.isOpen() === true,
      escapeClaimed: () => escapeClaimed?.() === true,
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      missionBrief: briefFor,
      missionBriefingHistory: () => sim.missionBriefingHistory(),
      missionReplayPage: () => sim.missionBriefingPage(),
      missionHuman: (missionId) => sim.missionHuman(missionId),
      // The original stops game time behind its large windows.
      onLargeWindow: (open) => {
        missionWindowOpen = open;
        if (open) pauseHolds.hold(PAUSE_HOLDER_MISSION);
        else pauseHolds.release(PAUSE_HOLDER_MISSION);
      },
      ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      onSelectMessageTarget: (target) => {
        const at = messageTargetAnchor(sim.snapshot(), target, deps.elevation);
        if (at !== null) jumpToWorld(at.x, at.y);
        if (target.entity !== null) selectEntity?.(target.entity);
      },
      ...(hasDebugFlag(params, NOTICE_GALLERY_DEBUG_FLAG)
        ? { noticeGallery: { goodType: goodLabelByType.keys().next().value ?? null } }
        : {}),
      onUiCue: uiCue,
    });

    cleanup.push(() => toolPanel.dispose());

    // The verdict panel rides the same event stream the entry's own hook does; a spectator seat has no
    // verdict to hear.
    if (deps.observer !== true || sharedClock) {
      verdict = createMatchResultOverlay({
        localPlayer,
        sharedClock,
        uiString: toolPanel.controller.uiString,
        pause: () => pauseHolds.hold(PAUSE_HOLDER_VERDICT),
        resume: () => pauseHolds.release(PAUSE_HOLDER_VERDICT),
        onQuit: quitToMenu,
      });
    }
    // Assembled below, once the controls and the camera it steers exist.
    const terrainColors = await mountScriptTerrainColors(sim, renderer);
    let presentation: ReturnType<typeof createScriptPresentation> | null = null;
    const subMissions = createSubMissions({
      sim,
      captureSave: (options) => driver.captureSave(options),
      params,
      worldToken: deps.worldToken ?? null,
      ...(deps.parentSave !== undefined ? { parent: deps.parentSave } : {}),
      ...(deps.prepareSubMission !== undefined ? { prepare: deps.prepareSubMission } : {}),
      pause: () => {
        if (!sharedClock) driver.setPaused(true);
      },
      resume: () => {
        if (!sharedClock) driver.setPaused(false);
      },
      teardown: teardownWorld,
    });
    const onEvents = createWorldEventHandler({
      forward: (events) => deps.onEvents?.(events),
      terrainColors,
      subMissions: (events) => !sharedClock && subMissions.onEvents(events),
      verdict: (events) => {
        if (deps.observer !== true) verdict?.onEvents(events);
      },
      presentation: (events) => presentation?.onEvents(events),
    });

    // Injected rather than imported: `hud/` never imports `view/`.
    const clientToScreen = (clientX: number, clientY: number): { x: number; y: number } =>
      clientToScreenPx(canvas, app.renderer.resolution, clientX, clientY);
    const jumpToWorld = (wx: number, wy: number): void => {
      const zoom = cameraCtl.camera().scale ?? 1;
      cameraCtl.jumpTo(cameraCenteredOnWorld(wx, wy, zoom, app.screen.width, app.screen.height));
    };
    // Mounted after the tool panel (draw order) and before the unit controls, so that a minimap click
    // never falls through to unit selection or a world order.
    minimap = await mountMinimap({
      app,
      canvas,
      terrain: deps.terrainGrid,
      cellColours: deps.minimapCellColours,
      colourOf: deps.terrainColour,
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      uiscale,
      camera: () => cameraCtl.camera(),
      onJump: jumpToWorld,
      onOrder: (worldX, worldY, event) => overviewPress?.(worldX, worldY, event) ?? false,
      toScreenPx: clientToScreen,
    });

    // Open windows, the minimap and the DOM regions claim against both camera gestures.
    const mountedMinimap = minimap;
    cleanup.push(() => mountedMinimap.dispose());
    const hudClaims = (clientX: number, clientY: number): boolean =>
      toolPanel.claimsWheel(clientX, clientY) ||
      mountedMinimap.claimsPointer(clientX, clientY) ||
      hudDom.claims(clientX, clientY);
    cameraCtl.setPointerGuard(hudClaims);
    cameraCtl.setEdgeGuard(hudClaims);

    // Late-bound: the badge projection below needs the fog gates and the building index.
    let pickableDoorBadges: (() => readonly DoorBadge[]) | undefined;

    const detailsTooltip = createTooltip();
    cleanup.push(() => detailsTooltip.destroy());
    const controls = await createUnitControls({
      technologyStatus: (kind, typeId, tribe, player) => sim.unlockStatus(kind, typeId, tribe, player),
      canChooseJob: (id, jobType) => sim.canChooseJob(id as Entity, jobType),
      app,
      canvas,
      uiscale,
      camera: () => cameraCtl.camera(),
      snapshot: () => sim.snapshot(),
      mapSize: deps.mapSize,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      viewer,
      hostileToward: (owner) => sim.diplomacyStance(viewerPlayer(), owner) === 'enemy',
      lang,
      bindings: keyBindings,
      professions: pickerEntries(),
      content: sim.content,
      mapText,
      ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
      ...(pack !== null ? { packGoods: pack.goodTextures(deps.sheet) } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      enqueue: issueCommand,
      centerOn: jumpToWorld,
      drawnItems: () => renderer.drawnItems(),
      resourceVisible: (tileX, tileY) => {
        const fog = fogViewOf();
        return fog === null || fogTileVisible(fog, tileX, tileY);
      },
      doorBadges: () => pickableDoorBadges?.() ?? [],
      equipPickList: (entity, group) => sim.equipPickList(entity as Entity, group),
      standsTo: (entity) => sim.standsTo(entity as Entity),
      traderView: (entity) => sim.traderView(entity as Entity),
      tradeOffersAt: (house) => sim.tradeOffersAt(house as Entity),
      boundsOf: (ref) => renderer.entityBounds(ref),
      pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy),
      claimPointer: (x: number, y: number) =>
        toolPanel.claimPointer(x, y) || mountedMinimap.claimsPointer(x, y),
      // A separate instance from the ground tooltip below, which the frame loop hides whenever the
      // pointer is over the HUD - exactly when this one must stay shown.
      tooltip: detailsTooltip,
      onUiCue: uiCue,
    });
    cleanup.push(() => controls.dispose());
    selectEntity = controls.selectEntity;
    unitSelection = controls;
    escapeClaimed = controls.claimsEscape;
    overviewPress = controls.overviewPress;

    const {
      goodLabel,
      buildingDoors,
      overlayFrame,
      signpostOverlayFrame,
      hudFor,
      hudModelFor,
      doorBadgesFor,
      constructionSignsFor,
      settlerBubblesFor,
      lifeHeartsFor,
    } = await createViewReadModels({
      placementTribe: seatTribeOf(localPlayer),
      sim,
      mapSize: deps.mapSize,
      localPlayer,
      viewer,
      fogGates,
      tribes: deps.tribes ?? [PRIMARY_TRIBE],
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      selection: { ids: controls.selectedIds, version: controls.selectionVersion },
    });
    pickableDoorBadges = () => doorBadgesFor(sim.snapshot());

    // The script's markers and washes draw over the world and under every HUD plane.
    const scriptOverlay = new Container();
    cleanup.push(() => scriptOverlay.destroy({ children: true }));
    scriptOverlay.zIndex = SCRIPT_OVERLAY_Z;
    app.stage.addChild(scriptOverlay);
    presentation = createScriptPresentation({
      sim,
      missionTrace: hasDebugFlag(params, 'missions'),
      seat: viewerPlayer,
      toolPanel,
      controls,
      centerOn: jumpToWorld,
      screen: () => app.screen,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      markers: createScriptMarkers(scriptOverlay, await loadGuiArt(), deps.elevation),
      effects: createScriptEffects(scriptOverlay, deps.elevation),
      mapText,
      now: () => performance.now(),
      exit: () => queueMicrotask(quitToMenu),
    });

    const mountedPresentation = presentation;
    cleanup.push(() => mountedPresentation.dispose());

    // Mounted after the unit controls, so an admin spawn click defers to their composed HUD claim.
    const debugMounts = mountDebugOverlays({
      app,
      canvas,
      params,
      sim,
      perf,
      initialToolsEnabled: storedSettings.debugToolsEnabled,
      paletteTop: debugPaletteTopForUiScale(uiscale),
      allowWorldEdits: !sharedClock,
      // The admin palette is a dev channel rather than part of the seat's HUD, so a read-only spectator
      // still pokes with it.
      enqueue: issueTrusted,
      renderer,
      cameraCtl,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      buildingsByType: buildingDoors,
      clientToScreen,
      clientToTile: (x, y) => toolPanel.clientToTile(x, y),
      claimPointer: (x, y) => controls.claimsPointer(x, y),
      goodLabel,
      seatTribeOf,
    });

    cleanup.push(() => debugMounts.dispose());

    // For screenshots and recordings: the always-on HUD hides, the world and its markers stay.
    toggleHud = () => {
      hudHidden = !hudHidden;
      hudDom.setChromeHidden(hudHidden);
      toolPanel.controller.setHudHidden(hudHidden);
      mountedMinimap.setHidden(hudHidden);
      controls.setHudHidden(hudHidden);
      debugMounts.setHudHidden(hudHidden);
    };

    // A building's card reads content alone: names, store slots and construction bills. No species
    // filter, so a farm's herd is one of its store lines, as the original's card lists it; the details
    // panel filters it out only because its own Produkcja window already counts the herd.
    const hoverContext: BuildingStockContext = {
      buildings: sim.content.buildings,
      goods: sim.content.goods,
    };

    // The parchment card a hovered settler or building opens, on the DOM plane the redesigned regions
    // share.
    const hoverCard = createHoverCard({
      plane: hudDom.element,
      scale: hudDom.currentScale,
      pack,
      uiString: toolPanel.controller.uiString,
    });
    cleanup.push(() => hoverCard.dispose());

    // Owns its own tooltip element, distinct from the details panel's stock-row tooltip above.
    const worldHover = createWorldHover({
      renderer,
      camera: () => cameraCtl.camera(),
      clientToScreen,
      goodLabel,
      ...chestTooltipLines(sim.content, toolPanel.controller.uiString, viewerPlayer, controls.selectedIds),
      card: hoverCard,
      buildingModel: (snapshot, entityId) => buildingHoverModel(snapshot, entityId, hoverContext),
      settlerModel: (snapshot, entityId) =>
        settlerHoverModel(snapshot, entityId, { jobs: sim.content.jobs, mapText }),
      pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy),
      pointer: pointerAt,
      suppressed: (clientX, clientY) =>
        hudHidden ||
        toolPanel.controller.placementType() !== null ||
        toolPanel.claimPointer(clientX, clientY) ||
        controls.claimsPointer(clientX, clientY),
    });

    cleanup.push(() => worldHover.destroy());

    // A seat switch from the picker: the selection was the last seat's, and the view goes where the
    // new seat's people are.
    switchableSeat?.onSwitch((seat) => {
      uiCue('confirm');
      controls.select([]);
      if (seat === null) return;
      const focus = mapStartFocus(sim.snapshot(), deps.mapSize.width, deps.mapSize.height, seat);
      const zoom = cameraCtl.camera().scale ?? 1;
      cameraCtl.jumpTo(cameraCenteredOnTile(focus.x, focus.y, zoom, app.screen.width, app.screen.height));
    });

    const liveSettings = createLiveGameSettings({
      screen: app.screen,
      initialViewport: deps.initialViewport,
      params,
      stored: storedSettings,
      pinnedUiScale,
      camera: cameraCtl,
      toolPanel,
      minimap: mountedMinimap,
      controls,
      hudDom,
      perf,
      placeDebugPalette: debugMounts.placePalette,
      sound: soundDriver,
      setDebugToolsEnabled: debugMounts.setToolsEnabled,
      setGraphicsEnhancements: (next) => renderer.setGraphicsEnhancements(next),
      setKeyBindings: (next) => {
        Object.assign(keyBindings, next);
        cameraCtl.setBindings(next);
      },
    });
    cleanup.push(() => liveSettings.dispose());

    systemMenu = createSystemMenu({
      onQuit: quitToMenu,
      saveLoad: {
        ...saveLoad,
        forcePause: () => pauseHolds.hold(PAUSE_HOLDER_MENU),
        releaseForcedPause: () => pauseHolds.release(PAUSE_HOLDER_MENU),
      },
      settings: liveSettings.settings,
      setCameraSuspended: cameraCtl.setSuspended,
      canLoad: !sharedClock,
    });

    installDebugHandle({
      sim,
      renderer,
      sheet: deps.sheet,
      cameraCtl,
      canvas,
      driver,
      netReadout,
      frameStats,
      profile,
    });

    // This mount owns construction; the loop owns the pinned per-frame order.
    loop = startFrameLoop({
      deps: { ...deps, onEvents },
      suspended: subMissions.isPending,
      fpsLimit: storedSettings.fpsLimit,
      fogView: fogViewOf,
      seat: viewerPlayer,
      wholeMap,
      onMatchEnd: () => verdict?.finish(sim.matchOutcome(localPlayer)),
      isDisposed: () => destroyed,
      driver,
      frameStats,
      fogGates,
      toolPanel,
      minimap: mountedMinimap,
      controls,
      worldHover,
      geometryDebug: debugMounts.geometryDebug,
      overlayFrame,
      signpostOverlayFrame,
      hudFor,
      hudModelFor,
      doorBadgesFor,
      constructionSignsFor,
      settlerBubblesFor,
      lifeHeartsFor,
      canPlaceAt,
      canPlaceSignpostAt,
      placementTribe: seatTribeOf(localPlayer),
      soundDriver,
      presentation,
      portraitVisible: () => !missionWindowOpen,
      perf,
      netReadout,
      pointer: pointerAt,
      syncViewport: liveSettings.syncViewport,
    });

    if (deps.introAtStart === true) toolPanel.controller.openMission();
    // A restored save of a decided match says so at once, since no event will repeat the verdict.
    if (deps.observer !== true) verdict?.announce(sim.matchOutcome(localPlayer));

    return {
      destroy,
      lifetime: lifetime.signal,
      updateNetStatus: (rows, readout) => systemMenu?.updateNetStatus(rows, readout),
      syncSpeed: (control) => toolPanel.controller.syncSpeed(control),
      get hudInsetBottomLeftPx() {
        const rect = mountedMinimap.panelRect();
        return Math.max(
          perfCornerForUiScale(uiscale).left,
          rect === null ? 0 : rect.x + rect.w + BESIDE_MINIMAP_GAP_PX,
        );
      },
    };
  } catch (error) {
    try {
      destroy();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Game view mount and cleanup failed');
    }
    throw error;
  }
}
