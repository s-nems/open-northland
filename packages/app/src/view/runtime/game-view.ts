import type { UiCue } from '@open-northland/audio';
import { BUILDING_KIND, type MapRelationFlag } from '@open-northland/data';
import type { SessionDriver } from '@open-northland/lockstep';
import type {
  DoorBadge,
  ElevationField,
  SceneTerrain,
  SpriteSheet,
  WorldRenderer,
} from '@open-northland/render';
import { fogTileVisible, projectNode } from '@open-northland/render';
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
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { pickerEntries } from '../../catalog/professions.js';
import { emblemBuildingType } from '../../content/building-gfx/emblems.js';
import type { FellingClips } from '../../content/felling-clips.js';
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
import { type MissionBriefSource, missionReader } from '../../game/mission-brief.js';
import type { ObserverSeatEntry } from '../../game/observer-seats.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { technologyName, vehicleLabel } from '../../game/technology.js';
import {
  fixedViewerSeat,
  overseerViewerSeat,
  switchableViewerSeat,
  type ViewerSeat,
} from '../../game/viewer-seat.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { createGoodIconPainter } from '../../hud/dom/good-art.js';
import { createHoverCard } from '../../hud/dom/hover-card.js';
import { mountHudDomRoot } from '../../hud/dom/root.js';
import { type BuildingHoverContext, buildingHoverModel } from '../../hud/hover-card/building.js';
import type { HoverOwnerContext } from '../../hud/hover-card/owner.js';
import { type SettlerHoverContext, settlerHoverModel } from '../../hud/hover-card/settler.js';
import { type MinimapHandle, mountMinimap } from '../../hud/minimap/index.js';
import { minimapFeatureOfGoodTypes } from '../../hud/minimap/live-objects.js';
import type { DiplomacyPanelRow } from '../../hud/tool-panel/diplomacy/index.js';
import type { GameSpeedControl } from '../../hud/tool-panel/game-speed.js';
import { type MetSeat, NOTICE_GALLERY_DEBUG_FLAG } from '../../hud/tool-panel/messages/index.js';
import { MEAD_GOOD_ID, residentRows } from '../../hud/tool-panel/residents/projection.js';
import type { ResidentRow } from '../../hud/tool-panel/residents/rows.js';
import { uiScaleFor } from '../../hud/ui-scale.js';
import { currentLocale } from '../../i18n/index.js';
import { presentationPack } from '../../presentation/pack.js';
import type { OffThreadTickCost, SessionHost } from '../../session/index.js';
import { setUpdateContinuation } from '../../update/watcher.js';
import type { AmbientWeather } from '../ambient-weather.js';
import { assistantCountersSeam } from '../assistant-counters.js';
import { assistantGrantsSeam } from '../assistant-grants.js';
import type { CameraController } from '../camera/index.js';
import {
  cameraCenteredOnTile,
  cameraCenteredOnWorld,
  clientToScreen as clientToScreenPx,
} from '../camera/index.js';
import { clearCanvasCursors } from '../cursors/element.js';
import {
  applyGameSpeed,
  buildingLabelsFromContent,
  goodLabelsFromContent,
  menuEntriesFromContent,
  mountGameToolPanel,
  palisadeToolsOf,
} from '../game-tool-panel.js';
import { createMatchResultOverlay, type MatchResultOverlay } from '../match-result.js';
import { floatParam, introParam, tintParam, weatherParam } from '../params.js';
import { mountPerfOverlay } from '../perf-overlay.js';
import { nodeBounds } from '../picking.js';
import {
  createFogGates,
  diplomacyMetSeats,
  diplomacyPanelRows,
  entityAnchor,
  memoBySnapshot,
  messageTargetAnchor,
} from '../projections/index.js';
import { createScriptEffects } from '../script-effects.js';
import { createScriptMarkers } from '../script-markers.js';
import { patchStoredSettings, readStoredSettings } from '../settings-store.js';
import { createSystemMenu } from '../system-menu.js';
import { createUnitControls, type UnitControls } from '../unit-controls/index.js';
import { createWeatherFeed } from '../weather-feed.js';
import { chestTooltipLines, createWorldHover } from '../world-hover.js';
import { installDebugHandle } from './debug-handle.js';
import { mountDebugOverlays } from './debug-mounts.js';
import { startFrameLoop } from './frame-loop.js';
import {
  createLiveGameSettings,
  debugPalettePositionForUiScale,
  perfCornerForUiScale,
} from './game-live-settings.js';
import { mountGamePresentation } from './game-presentation.js';
import { createHostAnswers } from './host-answers.js';
import { createMenuExit } from './menu-exit.js';
import type { NetReadout } from './net-readout.js';
import { ownRoadSiteAt } from './own-road-sites.js';
import { createPauseHolds } from './pause-holds.js';
import { createPlacementGates } from './placement-gates.js';
import { trackCanvasPointer } from './pointer-tracker.js';
import type { RafLoop } from './raf-loop.js';
import { createViewReadModels } from './read-models.js';
import { roadBuiltAt } from './road-nodes.js';
import { createSaveLoadSession, type SaveLoadSessionOptions } from './save-load/index.js';
import { relatedWorldLoader } from './save-load/related-world.js';
import { createScriptPresentation } from './script-presentation.js';
import { mountScriptTints } from './script-tints.js';
import { createSubMissions, type PrepareSubMission } from './sub-missions.js';
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
  /** The falling clips felled trees play; absent, a felled tree gives way to its trunk at once. */
  readonly fellingClips?: FellingClips;
  /** The world as the runtime reads it; the entry owns the simulation behind it. */
  readonly host: SessionHost;
  /** The session this client runs: it decides which ticks run, owns tempo and pause, and is where every
   *  HUD command goes. */
  readonly driver: SessionDriver;
  /** Present when the sim runs on another thread: what the ticks the driver delivered cost. */
  readonly offThreadTickCost?: () => OffThreadTickCost;
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
  /** Ambient weather for a map that authors none; absent, the sky stays as the map wrote it. */
  readonly ambientWeather?: AmbientWeather | null;
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
  /** The seats a read-only spectator may watch one at a time, which mounts the seat picker and starts
   *  the view on the whole map with nobody's figures; absent, a spectator keeps `localPlayer`'s. */
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
  /** Where the mission book's pages and goals come from; omitted, the book shows nothing. */
  readonly missionBriefSource?: MissionBriefSource;
  /** Open the mission book as the session starts, the original's mission briefing; the entry decides
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
  const { app, canvas, params, renderer, host, driver, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;
  // A spectator with a picker follows the seat it chose to watch; the overseer sees the whole map with
  // its own seat's figures; a played session's view is its own seat for good.
  const switchableSeat = deps.observerSeats === undefined ? null : switchableViewerSeat(null);
  const viewer: ViewerSeat =
    switchableSeat ??
    (deps.observer === true ? overseerViewerSeat(localPlayer) : fixedViewerSeat(localPlayer));
  /** The seat a read needing one answers for; watching the whole map reads as the fallback seat. */
  const viewerPlayer = (): number => viewer.seat() ?? localPlayer;
  const fogViewOf = (): FogView | null => {
    const seat = viewer.seat();
    return viewer.wholeMap() || seat === null ? null : host.fogView(seat);
  };
  const seatTribeOf = deps.seatTribeOf ?? ((): number => PRIMARY_TRIBE);
  const sharedClock = deps.sharedClock === true;
  const netReadout = deps.netReadout ?? ((): null => null);

  // Installed before the HUD mounts so the system menu sees an active recording.
  const profile = installSessionInstruments(host, params);

  let loop: RafLoop | null = null;
  let systemMenu: ReturnType<typeof createSystemMenu> | null = null;
  const cleanup: (() => void)[] = [];
  cleanup.push(() => clearCanvasCursors(canvas));
  let verdict: MatchResultOverlay | null = null;
  let destroyed = false;
  const lifetime = new AbortController();
  logGpuContextLoss(canvas, () => host.tick, lifetime.signal);
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
    host,
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
  // A local world carries over a reload into a new release; a relayed one lives on the relay.
  if (!sharedClock && deps.worldToken !== undefined && deps.worldToken !== null) {
    setUpdateContinuation(() => saveLoad.stageForReload());
    cleanup.push(() => setUpdateContinuation(null));
  }
  // Three overlays hold the sim paused - the menu, the mission book and the verdict - so
  // each holds under its own key and none can release another's.
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
    // Leaving the debug seams set would pin this world, renderer and stats for the document's lifetime.
    if (window.__opennorthland?.host === host) delete window.__opennorthland;
    if (currentDiagGameSession()?.host === host) setDiagGameSession(null);
    if (errors.length > 0) throw new AggregateError(errors, 'Game view cleanup failed');
  };
  const onReturnToMenu = deps.onReturnToMenu;
  const quitToMenu =
    onReturnToMenu !== undefined
      ? (): void => {
          destroy();
          onReturnToMenu();
        }
      : createMenuExit({ teardown: teardownWorld });

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

    const placementGates = createPlacementGates(host, fogGates, localPlayer);
    cleanup.push(() => placementGates.dispose());
    const {
      canPlaceAt,
      canPlaceSignpostAt,
      canPlacePalisadeAt,
      palisadeBuiltAt,
      palisadeAnswersKey,
      palisadeGateProbe,
      palisadeGateSites,
      canPlaceRoadAt,
      roadAnswersKey,
    } = placementGates;
    const roadNodeWidth = nodeBounds(deps.mapSize).width;
    const roadBuiltHere = (col: number, row: number): boolean =>
      roadBuiltAt(host.snapshot(), roadNodeWidth, col, row);

    // Assigned right after the tool panel mounts: stage order is draw order, and the minimap window
    // draws over the strip's lower buttons on a short screen.
    let minimap: MinimapHandle | undefined;

    // Client coords, null off-canvas. Tracked persistently so the frame loop reads it instead of probing
    // the sim on every mousemove.
    const pointerAt = trackCanvasPointer(canvas, lifetime.signal);

    // A read-only spectator drops every HUD command here. Setup commands enqueue on the world's builder.
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

    const goodLabelByType = goodLabelsFromContent(host.content);
    const answers = createHostAnswers(host, seatTribeOf);
    cleanup.push(() => answers.dispose());
    const { diplomacyView, buildAvailability } = answers;
    const nationEmblemType = emblemBuildingType(host.content.buildings);
    const diplomacyRows = (): readonly DiplomacyPanelRow[] =>
      diplomacyPanelRows(diplomacyView, {
        localPlayer: viewerPlayer(),
        rosterPlayers: deps.rosterPlayers ?? [],
        observer: viewer.wholeMap(),
        goodLabelOf: (goodType) => goodLabelByType.get(goodType),
        canPay: !readOnly,
        canDeclare: !readOnly,
        ...(deps.relationFlags !== undefined ? { relationFlags: deps.relationFlags } : {}),
        ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
        ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
        ...(deps.mapText !== undefined ? { tributeText: deps.mapText } : {}),
      });
    const metSeats = (): readonly MetSeat[] =>
      diplomacyMetSeats(diplomacyView, {
        localPlayer: viewerPlayer(),
        rosterPlayers: deps.rosterPlayers ?? [],
        observer: viewer.wholeMap(),
        ...(deps.relationFlags !== undefined ? { relationFlags: deps.relationFlags } : {}),
      });
    const mapText = deps.mapText ?? ((): undefined => undefined);
    const mission =
      deps.missionBriefSource === undefined
        ? undefined
        : missionReader(
            deps.missionBriefSource,
            {
              tick: () => host.tick,
              status: () => host.missionStatus(),
              outcome: () => host.matchOutcome(viewerPlayer()),
            },
            mapText,
          );

    // The unit controls mount after the panel and the minimap, so a note's Select and a minimap order
    // reach them through these slots.
    let selectEntity: ((id: number) => void) | null = null;
    let unitSelection: Pick<UnitControls, 'select' | 'selectedIds' | 'selectionVersion'> | null = null;
    const NO_SELECTION: ReadonlySet<number> = new Set();
    const meadGood = host.content.goods.find((good) => good.id === MEAD_GOOD_ID)?.typeId;
    const residentsFor = memoBySnapshot(
      (snapshot: WorldSnapshot) => {
        const seat = viewer.seat();
        return seat === null
          ? NO_RESIDENTS
          : residentRows(snapshot, { localPlayer: seat, content: host.content, mapText, meadGood });
      },
      () => viewer.version(),
    );
    let escapeClaimed: (() => boolean) | null = null;
    let overviewPress: UnitControls['overviewPress'] | null = null;
    // Assigned once every HUD part it hides has mounted.
    let toggleHud: (() => void) | null = null;
    let hudHidden = false;
    // The DOM plane the redesigned HUD regions mount on; it scales with the Pixi parts.
    const hudDom = mountHudDomRoot(uiscale);
    cleanup.push(() => hudDom.dispose());
    const vehicleSiteTypes = new Set(
      host.content.buildings.filter((b) => b.kind === BUILDING_KIND.vehicle).map((b) => b.typeId),
    );
    const toolPanel = await mountGameToolPanel({
      app,
      canvas,
      plane: hudDom.element,
      uiscale,
      camera: () => cameraCtl.camera(),
      enqueue: issueCommand,
      ...(sharedClock ? {} : { enqueueTrusted: issueTrusted }),
      grants: assistantGrantsSeam(host, host.content, viewer.seat, issueCommand, !readOnly),
      counters: assistantCountersSeam(host, viewer.seat, issueCommand, !readOnly),
      papers: {
        read: () => {
          const seat = viewer.seat();
          return seat === null ? NO_PAPERS : answers.papers(seat);
        },
      },
      residents: {
        rows: () => residentsFor(host.snapshot()),
        tick: () => host.snapshot().tick,
        canBecome: (id, pick) =>
          answers.canChooseJob(id, pick.jobType) &&
          (pick.goodType === null || answers.hasEarnedGood(id, pick.goodType)),
        answersVersion: answers.versions.jobChoices,
        selection: {
          ids: () => unitSelection?.selectedIds() ?? NO_SELECTION,
          version: () => unitSelection?.selectionVersion() ?? 0,
        },
        onSelect: (ids, show) => {
          unitSelection?.select(ids);
          const [only] = ids;
          if (!show || ids.length !== 1 || only === undefined) return;
          const at = entityAnchor(host.snapshot(), only, deps.elevation);
          if (at !== null) jumpToWorld(at.x, at.y);
        },
      },
      diplomacyRows,
      metSeats,
      onPayTribute: (slot) => issueCommand({ kind: 'payTribute', player: localPlayer, slot }),
      onDeclareDiplomacy: (other, state) =>
        issueCommand({ kind: 'declareDiplomacy', player: localPlayer, other, state }),
      canPlaceAt,
      canPlacePalisadeAt,
      palisadeBuiltAt,
      palisadeAnswersKey,
      palisadeGateProbe,
      palisadeGateSites,
      canPlaceRoadAt,
      roadBuiltAt: roadBuiltHere,
      roadAnswersKey,
      ownRoadSiteAt: (col, row) => ownRoadSiteAt(host.snapshot(), localPlayer, col, row),
      placementClickAsks: placementGates,
      palisadeTools: palisadeToolsOf(host),
      mapSize: deps.mapSize,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      buildings: menuEntriesFromContent(host.content, lang).map((entry) => ({
        ...entry,
        availability: (tribe) => buildAvailability(viewerPlayer(), entry.typeId, tribe),
      })),
      buildingLabels: buildingLabelsFromContent(host.content, lang),
      technologyName: (kind, typeId) => technologyName(host.content, kind, typeId),
      goodLabel: (typeId) => goodLabelByType.get(typeId),
      goods: host.content.goods,
      pack,
      vehicleLabel: (typeId) => vehicleLabel(host.content, typeId),
      lang,
      bindings: keyBindings,
      tribe: seatTribeOf(localPlayer),
      buildTribes: () => answers.buildTribes(viewerPlayer()),
      ...(nationEmblemType !== undefined ? { nationEmblemType } : {}),
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
      onSaveGame: () => systemMenu?.openPage('save'),
      ...(sharedClock ? {} : { onLoadGame: () => systemMenu?.openPage('load') }),
      onToggleHud: () => toggleHud?.(),
      systemMenuOpen: () => systemMenu?.isOpen() === true,
      escapeClaimed: () => escapeClaimed?.() === true,
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      ...(mission !== undefined ? { mission } : {}),
      missionBriefingHistory: answers.missionBriefingHistory,
      missionReplayPage: answers.missionBriefingPage,
      missionHuman: answers.missionHuman,
      missionAnswersVersion: answers.versions.mission,
      onMissionHold: (held) => {
        if (held) pauseHolds.hold(PAUSE_HOLDER_MISSION);
        else pauseHolds.release(PAUSE_HOLDER_MISSION);
      },
      pauseStopsClock: !sharedClock,
      onShowOnMap: (target) => {
        const at =
          target.kind === 'node'
            ? projectNode(deps.elevation, target.hx, target.hy)
            : entityAnchor(host.snapshot(), target.ref, deps.elevation);
        if (at !== null) jumpToWorld(at.x, at.y);
      },
      ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      onSelectMessageTarget: (target) => {
        const at = messageTargetAnchor(host.snapshot(), target, deps.elevation);
        if (at !== null) jumpToWorld(at.x, at.y);
        if (target.entity !== null) selectEntity?.(target.entity);
      },
      ...(hasDebugFlag(params, NOTICE_GALLERY_DEBUG_FLAG)
        ? { noticeGallery: { goodType: goodLabelByType.keys().next().value ?? null } }
        : {}),
      workshops: {
        types: host.content.buildings.filter((b) => b.recipes.length > 0).map((b) => b.typeId),
        workStatus: answers.workStatus,
      },
      isVehicleSite: (typeId) => vehicleSiteTypes.has(typeId),
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
    const scriptTints = await mountScriptTints(host, renderer, { pinnedIndex: tintParam(params) });
    cleanup.push(() => scriptTints.dispose());
    let presentation: ReturnType<typeof createScriptPresentation> | null = null;
    const subMissions = createSubMissions({
      host,
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
      scriptTints: scriptTints.onEvents,
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
      plane: hudDom.element,
      app,
      canvas,
      terrain: deps.terrainGrid,
      cellColours: deps.minimapCellColours,
      colourOf: deps.terrainColour,
      featureOfGoodType: minimapFeatureOfGoodTypes(host.content.goods),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      filters: storedSettings.minimapFilters,
      onFiltersChange: (minimapFilters) => patchStoredSettings({ minimapFilters }),
      isFighterJob: (jobType) => systems.isFighterJob(host.content, jobType),
      viewer: () => viewer.seat(),
      stanceToward: (owner) => host.diplomacyStance(viewerPlayer(), owner),
      uiscale,
      frame: storedSettings.minimapFrame,
      camera: () => cameraCtl.camera(),
      onJump: jumpToWorld,
      onOrder: (worldX, worldY, event) => overviewPress?.(worldX, worldY, event) ?? false,
      toScreenPx: clientToScreen,
    });

    // Open windows, the minimap and the DOM regions keep the wheel from zooming under them.
    const mountedMinimap = minimap;
    cleanup.push(() => mountedMinimap.dispose());
    const hudClaims = (clientX: number, clientY: number): boolean =>
      toolPanel.claimsWheel(clientX, clientY) ||
      mountedMinimap.claimsPointer(clientX, clientY) ||
      hudDom.claims(clientX, clientY);
    cameraCtl.setPointerGuard(hudClaims);
    // A minimap drag jumps the camera on every move, which an edge pan in between would fight.
    cameraCtl.setEdgeHold(() => mountedMinimap.dragging());

    // Late-bound: the badge projection below needs the fog gates and the building index.
    let pickableDoorBadges: (() => readonly DoorBadge[]) | undefined;

    const controls = await createUnitControls({
      technologyStatus: answers.technologyStatus,
      technologyVersion: answers.versions.technology,
      panelAnswersVersion: answers.versions.unitPanel,
      attachPicksVersion: answers.versions.attachPicks,
      canChooseJob: answers.canChooseJob,
      askCanChooseJob: answers.askCanChooseJob,
      jobChoicesVersion: answers.versions.jobChoices,
      app,
      canvas,
      uiscale,
      camera: () => cameraCtl.camera(),
      snapshot: () => host.snapshot(),
      mapSize: deps.mapSize,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      viewer,
      hostileToward: (owner) => host.diplomacyStance(viewerPlayer(), owner) === 'enemy',
      lang,
      bindings: keyBindings,
      professions: pickerEntries(),
      content: host.content,
      mapText,
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      enqueue: issueCommand,
      centerOn: jumpToWorld,
      drawnItems: () => renderer.drawnItems(),
      resourceVisible: (tileX, tileY) => {
        const fog = fogViewOf();
        return fog === null || fogTileVisible(fog, tileX, tileY);
      },
      doorBadges: () => pickableDoorBadges?.() ?? [],
      requestEquipPicks: (entity, group) => host.equipPickList(entity as Entity, group),
      standsTo: answers.standsTo,
      traderView: answers.traderView,
      tradeOffersAt: answers.tradeOffersAt,
      canAttachTradeHouse: answers.canAttachTradeHouse,
      askAttachTradeHouse: answers.askAttachTradeHouse,
      canAttachToVehicle: answers.canAttachToVehicle,
      askAttachToVehicle: answers.askAttachToVehicle,
      // The fog gate matches the overlay's, so a dimmed shore in the fog takes no dock click either.
      askMoorAt: placementGates.askMoorAt,
      boundsOf: (ref) => renderer.entityBounds(ref),
      pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy),
      claimPointer: (x: number, y: number) =>
        toolPanel.claimPointer(x, y) || mountedMinimap.claimsPointer(x, y),
      onUiCue: uiCue,
      domHud: {
        plane: hudDom.element,
        scale: hudDom.currentScale,
        pack,
        uiString: toolPanel.controller.uiString,
        residents: () => residentsFor(host.snapshot()),
        centralWindows: toolPanel.controller.centralWindows,
        ...(deps.sheet !== undefined
          ? { figures: { sheet: deps.sheet, frames: toolPanel.controller.figureFrames } }
          : {}),
      },
      workStatus: answers.workStatus,
      diplomacyStance: (owner) => host.diplomacyStance(viewerPlayer(), owner),
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
    });
    cleanup.push(() => controls.dispose());
    selectEntity = controls.selectEntity;
    unitSelection = controls;
    escapeClaimed = controls.claimsEscape;
    overviewPress = controls.overviewPress;

    const {
      goodLabel,
      buildingGeometry,
      overlayFrame,
      signpostOverlayFrame,
      litOverlayFrame,
      dockOverlayFrame,
      hudFor,
      hudModelFor,
      doorBadgesFor,
      constructionSignsFor,
      settlerBubblesFor,
      lifeHeartsFor,
    } = await createViewReadModels({
      probes: placementGates.probes,
      host,
      mapSize: deps.mapSize,
      localPlayer,
      viewer,
      fogGates,
      tribes: deps.tribes ?? [PRIMARY_TRIBE],
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      selection: { ids: controls.selectedIds, version: controls.selectionVersion },
    });
    pickableDoorBadges = () => doorBadgesFor(host.snapshot());

    // The script's markers draw over the world and under every HUD plane.
    const scriptOverlay = new Container();
    cleanup.push(() => scriptOverlay.destroy({ children: true }));
    scriptOverlay.zIndex = SCRIPT_OVERLAY_Z;
    app.stage.addChild(scriptOverlay);
    presentation = createScriptPresentation({
      host,
      missionTrace: hasDebugFlag(params, 'missions'),
      showBriefings: introParam(params),
      seat: viewer.seat,
      toolPanel,
      controls,
      centerOn: jumpToWorld,
      screen: () => app.screen,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      markers: createScriptMarkers(scriptOverlay, await loadGuiArt(), deps.elevation),
      effects: createScriptEffects(),
      weather: createWeatherFeed(
        deps.mapSize,
        (field) => renderer.setWeatherField(field),
        weatherParam(params),
        deps.ambientWeather ?? null,
      ),
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
      host,
      perf,
      initialToolsEnabled: storedSettings.debugToolsEnabled,
      palettePosition: debugPalettePositionForUiScale(uiscale),
      allowWorldEdits: !sharedClock,
      // The admin palette is a dev channel rather than part of the seat's HUD, so a read-only spectator
      // still pokes with it.
      enqueue: issueTrusted,
      renderer,
      cameraCtl,
      ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
      geometryOf: buildingGeometry,
      clientToScreen,
      clientToTile: (x, y) => toolPanel.clientToTile(x, y),
      claimPointer: (x, y) => controls.claimsPointer(x, y),
      goodLabel,
      seatTribeOf,
      enterStandingWall: (owner, tribe) => toolPanel.controller.enterStandingWall(owner, tribe),
      ...(sharedClock ? {} : { clock: driver }),
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
    const hoverOwners: HoverOwnerContext = {
      viewer,
      seatNameOf: deps.seatNameOf,
      diplomacyStance: (owner) => host.diplomacyStance(viewerPlayer(), owner),
      playerColourOf: deps.playerColourOf,
    };
    const settlerHoverContext: SettlerHoverContext = { ...controls.panelModelContext, ...hoverOwners };
    const hoverContext: BuildingHoverContext = {
      buildings: host.content.buildings,
      goods: host.content.goods,
      ...hoverOwners,
    };

    // The parchment card a hovered settler or building opens, on the DOM plane the redesigned regions
    // share.
    const hoverCard = createHoverCard({
      plane: hudDom.element,
      scale: hudDom.currentScale,
      icons: createGoodIconPainter(pack, host.content),
      uiString: toolPanel.controller.uiString,
    });
    cleanup.push(() => hoverCard.dispose());

    // Owns its own tooltip element, distinct from the details panel's stock-row tooltip above.
    const worldHover = createWorldHover({
      renderer,
      camera: () => cameraCtl.camera(),
      clientToScreen,
      goodLabel,
      vehicleLabel: (typeId) => vehicleLabel(host.content, typeId),
      ...chestTooltipLines(host.content, toolPanel.controller.uiString, viewerPlayer, controls.selectedIds),
      card: hoverCard,
      buildingModel: (snapshot, entityId) => buildingHoverModel(snapshot, entityId, hoverContext),
      settlerModel: (snapshot, entityId) => settlerHoverModel(snapshot, entityId, settlerHoverContext),
      // Both only grow, so their sum moves whenever either does.
      modelVersion: () => viewer.version() + answers.versions.unitPanel(),
      pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy),
      pointer: pointerAt,
      suppressed: (clientX, clientY) =>
        hudHidden ||
        toolPanel.controller.placementBuilding() !== null ||
        toolPanel.controller.palisadeGfxIndex() !== null ||
        toolPanel.controller.roadActive() ||
        toolPanel.claimPointer(clientX, clientY) ||
        controls.claimsPointer(clientX, clientY),
    });

    cleanup.push(() => worldHover.destroy());

    // A seat switch from the picker: the selection was the last seat's, and the view goes where the
    // new seat's people are.
    switchableSeat?.onSwitch((seat) => {
      uiCue('confirm');
      // The gates follow at once, so a click before the next frame reads the new seat's fog.
      fogGates.setFrame(fogViewOf());
      controls.select([]);
      if (seat === null) return;
      const focus = mapStartFocus(host.snapshot(), deps.mapSize.width, deps.mapSize.height, seat);
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
      setWeatherEnabled: (enabled) => {
        renderer.setWeatherEnabled(enabled);
        soundDriver?.setWeatherEnabled(enabled);
      },
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
      host,
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
      viewer,
      onMatchEnd: () => verdict?.finish(host.matchOutcome(localPlayer)),
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
      litOverlayFrame,
      dockOverlayFrame,
      hudFor,
      hudModelFor,
      doorBadgesFor,
      constructionSignsFor,
      settlerBubblesFor,
      lifeHeartsFor,
      canPlaceAt,
      canPlaceSignpostAt,
      soundDriver,
      presentation,
      perf,
      netReadout,
      updateSpeedStatus: (delivered, requested) => systemMenu?.updateSpeedStatus(delivered, requested),
      pointer: pointerAt,
      syncViewport: liveSettings.syncViewport,
    });

    // The window opens on the briefing the host names, so it waits for that answer.
    if (deps.introAtStart === true) {
      answers.missionBriefingHistory();
      answers.missionBriefingPage();
      await answers.settled();
      if (!destroyed) toolPanel.controller.openMission();
    }
    // A restored save of a decided match says so at once, since no event will repeat the verdict.
    if (deps.observer !== true) verdict?.announce(host.matchOutcome(localPlayer));

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
