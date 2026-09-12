import type { SessionDriver } from '@open-northland/lockstep';
import type {
  DoorBadge,
  ElevationField,
  SceneTerrain,
  SpriteSheet,
  WorldRenderer,
} from '@open-northland/render';
import {
  adminCommand,
  type Command,
  type Entity,
  type OpenTribute,
  type PlayerCommand,
  playerCommand,
  type SimEvent,
  type Simulation,
  type WorldSnapshot,
} from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { pickerEntries } from '../../catalog/professions.js';
import {
  currentDiagGameSession,
  FrameStats,
  installSessionInstruments,
  setDiagGameSession,
} from '../../diag/index.js';
import { hasDebugFlag } from '../../diag/debug-flags.js';
import { type MissionBrief, type MissionBriefSource, missionBriefReader } from '../../game/mission-brief.js';
import { loadGuiArt } from '../../content/gui-art.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { type MinimapHandle, mountMinimap } from '../../hud/minimap/index.js';
import type { DiplomacyPanelRow } from '../../hud/tool-panel/diplomacy/index.js';
import type { GameSpeedControl } from '../../hud/tool-panel/game-speed.js';
import { uiScaleFor } from '../../hud/ui-scale.js';
import { currentLocale } from '../../i18n/index.js';
import { assistantCountersSeam } from '../assistant-counters.js';
import { assistantGrantsSeam } from '../assistant-grants.js';
import type { CameraController } from '../camera/index.js';
import { cameraCenteredOnWorld, clientToScreen as clientToScreenPx } from '../camera/index.js';
import {
  applyGameSpeed,
  menuEntriesFromContent,
  menuGoodsFromContent,
  mountGameToolPanel,
} from '../game-tool-panel.js';
import { createMatchResultOverlay, type MatchResultOverlay } from '../match-result.js';
import { floatParam, menuSearch } from '../params.js';
import { mountPerfOverlay } from '../perf-overlay.js';
import { createFogGates, type DiplomacySimView, diplomacyPanelRows, messageTargetAnchor } from '../projections/index.js';
import { createScriptEffects } from '../script-effects.js';
import { createScriptMarkers } from '../script-markers.js';
import { readStoredSettings } from '../settings-store.js';
import { createSystemMenu } from '../system-menu.js';
import { createTooltip } from '../tooltip.js';
import { createUnitControls, type UnitControls } from '../unit-controls/index.js';
import { chestTooltipLines, createWorldTooltip } from '../world-tooltip.js';
import { installDebugHandle } from './debug-handle.js';
import { mountDebugOverlays } from './debug-mounts.js';
import { startFrameLoop } from './frame-loop.js';
import { createLiveGameSettings, perfCornerForUiScale } from './game-live-settings.js';
import { mountGamePresentation } from './game-presentation.js';
import type { NetReadout } from './net-readout.js';
import { createPauseHolds } from './pause-holds.js';
import { createPlacementGates } from './placement-gates.js';
import { trackCanvasPointer } from './pointer-tracker.js';
import type { RafLoop } from './raf-loop.js';
import { createViewReadModels } from './read-models.js';
import { createSaveLoadSession, type SaveLoadSessionOptions } from './save-load/index.js';
import { createScriptPresentation } from './script-presentation.js';
import { mountScriptTerrainColors } from './script-terrain-colors.js';

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
  /** Owner slot to team-colour slot for player-coloured HUD bits. Default identity. */
  readonly playerColourOf?: (player: number) => number;
  /** Owner slot to the roster's authored seat name, which the stats header prefers over the slot id. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** The map roster's player slots; the diplomacy window lists the discovered ones. Default empty. */
  readonly rosterPlayers?: readonly number[];
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
  /** True when the world came from a save: the session opens paused, so the player reads the board
   *  they loaded before it moves. */
  readonly restored?: boolean;
  /** Where the mission window's briefs come from; omitted, the window shows nothing. */
  readonly missionBriefSource?: MissionBriefSource;
  /** Open the mission window as the session starts, the original's mission briefing; the entry decides
   *  (a fresh world, and no `?intro=off`). */
  readonly introAtStart?: boolean;
  /** The briefing page that start opens on, the entry's guess for a world whose script the sim does
   *  not run; a world that runs it opens the page the script names instead. */
  readonly introPage?: number | null;
  /** The map's `[misc_music]` code; omitted or null, the world plays no music. */
  readonly musicType?: number | null;
}

export interface GameViewHandle {
  /** Stop the frame loop and remove this session's HUD overlays. Idempotent. */
  destroy(): void;
  /** Show a clock change another client made, so the speed button follows the session. */
  syncSpeed(control: GameSpeedControl): void;
  /** Left inset in px that clears the tool-panel strip, for overlays mounted beside this view. */
  readonly hudInsetLeftPx: number;
  readonly hudInsetBottomLeftPx: number;
}

const PAUSE_HOLDER_MENU = 'menu';
const PAUSE_HOLDER_MISSION = 'mission';
const PAUSE_HOLDER_VERDICT = 'verdict';
/** Above the world layers, below the HUD plane the tool panel and the minimap share. */
const SCRIPT_OVERLAY_Z = 900;

/** Mount the standard in-game HUD over the assembled world and start the session's frame loop. */
export async function startGameView(deps: GameViewDeps): Promise<GameViewHandle> {
  const { app, canvas, params, renderer, sim, driver, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;
  const seatTribeOf = deps.seatTribeOf ?? ((): number => PRIMARY_TRIBE);
  const sharedClock = deps.sharedClock === true;
  const netReadout = deps.netReadout ?? ((): null => null);

  // Installed before the HUD mounts so the system menu sees an active recording.
  const profile = installSessionInstruments(sim, params);

  let loop: RafLoop | null = null;
  let systemMenu: ReturnType<typeof createSystemMenu> | null = null;
  let disposeHud = (): void => undefined;
  let verdict: MatchResultOverlay | null = null;
  let destroyed = false;
  const saveLoad = createSaveLoadSession({
    ...deps.networkSave,
    captureSave: (options) => driver.captureSave(options),
    sim,
    worldToken: deps.worldToken ?? null,
    ...(deps.saveEntrySearch !== undefined ? { entrySearch: deps.saveEntrySearch } : {}),
    // A shared clock is nobody's to hold: the save dialog and the overlays above pause nothing.
    setPaused: (paused) => {
      if (!sharedClock) driver.setPaused(paused);
    },
    isPaused: () => driver.paused,
  });
  // Three overlays hold the sim paused - the menu, the mission sheet and the verdict - so each holds
  // under its own key and none can release another's.
  const pauseHolds = createPauseHolds(saveLoad);
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    loop?.stop();
    systemMenu?.dispose();
    disposeHud();
    verdict?.dispose();
    deps.cameraCtl.dispose();
    // Leaving the debug seams set would pin this sim, renderer and stats for the document's lifetime.
    delete window.__opennorthland;
    if (currentDiagGameSession()?.sim === sim) setDiagGameSession(null);
  };
  const quitToMenu = (): void => {
    destroy();
    if (deps.onReturnToMenu !== undefined) deps.onReturnToMenu();
    else window.location.search = menuSearch();
  };

  const storedSettings = readStoredSettings();
  // `?uiscale` pins an absolute HUD scale for reproducible diagnostics; only a positive value pins.
  const uiScaleParam = floatParam(params, 'uiscale', 0);
  const pinnedUiScale = uiScaleParam > 0 ? uiScaleParam : null;
  const uiscale = pinnedUiScale ?? uiScaleFor(deps.initialViewport.height, storedSettings.uiScaleFactor);

  const lang = currentLocale();
  const keyBindings = storedSettings.keyBindings;
  const frameStats = new FrameStats();

  // A checkout without a decoded sound bank degrades to silence.
  const soundDriver = await mountGamePresentation(params, renderer, deps.musicType ?? null);

  // Along the bottom edge between the minimap and the details panel, clear of the notes up top.
  const perfCorner = perfCornerForUiScale(uiscale);
  const perf = mountPerfOverlay(perfCorner.left, perfCorner.right, perfCorner.bottom);

  // Long-lived consumers close over these predicates; the frame loop refreshes them via `setFrame`.
  const fogGates = createFogGates();

  const { canPlaceAt, canPlaceSignpostAt } = createPlacementGates(sim, fogGates, localPlayer);

  // Assigned right after the tool panel mounts: stage order is draw order, and the minimap window
  // draws over the strip's lower buttons on a short screen.
  let minimap: MinimapHandle | undefined;

  // Client coords, null off-canvas. Tracked persistently so the frame loop reads it instead of probing
  // the sim on every mousemove.
  const pointerAt = trackCanvasPointer(canvas);

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
  };

  const menuGoods = menuGoodsFromContent(sim.content);
  const goodLabelByType = new Map(menuGoods.map((g) => [g.goodType, g.label]));
  // The open diplomacy window pulls its rows every frame; the tribute probe walks the payer's houses,
  // and nothing it reads moves between ticks.
  let owedMemo: {
    readonly tick: number;
    readonly payer: number;
    readonly owed: readonly OpenTribute[];
  } | null = null;
  const diplomacyView: DiplomacySimView = {
    hasMetPlayer: (viewer, other) => sim.hasMetPlayer(viewer, other),
    diplomacyStance: (from, to) => sim.diplomacyStance(from, to),
    openTributes: (payer) => {
      if (owedMemo === null || owedMemo.tick !== sim.tick || owedMemo.payer !== payer) {
        owedMemo = { tick: sim.tick, payer, owed: sim.openTributes(payer) };
      }
      return owedMemo.owed;
    },
  };
  const diplomacyRows = (): readonly DiplomacyPanelRow[] =>
    diplomacyPanelRows(diplomacyView, {
      localPlayer,
      rosterPlayers: deps.rosterPlayers ?? [],
      observer: deps.observer === true,
      goodLabelOf: (goodType) => goodLabelByType.get(goodType),
      canPay: !readOnly,
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
            outcome: () => sim.matchOutcome(localPlayer),
          },
          mapText,
        );

  // The unit controls mount after the panel and the minimap, so a note's Select and a minimap order
  // reach them through these slots.
  let selectEntity: ((id: number) => void) | null = null;
  let overviewPress: UnitControls['overviewPress'] | null = null;
  // Its own chip: the pile and stock-row tooltips hide whenever the pointer is over the HUD.
  const noteTooltip = createTooltip();
  let missionWindowOpen = false;
  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    enqueue: issueCommand,
    enqueueAdmin: (command) => {
      if (!readOnly) issueTrusted(command);
    },
    grants: assistantGrantsSeam(sim, sim.content, localPlayer, issueCommand, !readOnly),
    counters: assistantCountersSeam(sim, localPlayer, issueCommand, !readOnly),
    papers: { read: () => sim.papers(localPlayer) },
    diplomacyRows,
    onPayTribute: (slot) => issueCommand({ kind: 'payTribute', player: localPlayer, slot }),
    canPlaceAt,
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildings: menuEntriesFromContent(sim.content, lang),
    // The goods drop is a trusted world edit, which has no wire in a shared session.
    goods: sharedClock ? [] : menuGoods,
    lang,
    bindings: keyBindings,
    tribe: seatTribeOf(localPlayer),
    owner: localPlayer,
    onSpeed: (spec, cause) => applyGameSpeed(driver, spec, cause),
    deferToOverlay: (clientX, clientY) => minimap?.claimsPointer(clientX, clientY) ?? false,
    overlayReserve: () => minimap?.panelRect() ?? null,
    onSystemMenu: () => systemMenu?.toggle(),
    ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
    missionBrief: briefFor,
    missionBriefingHistory: () => sim.missionBriefingHistory(),
    missionReplayPage: () => sim.missionBriefingPage(),
    // The original stops game time behind its large windows.
    onLargeWindow: (open) => {
      missionWindowOpen = open;
      if (open) pauseHolds.hold(PAUSE_HOLDER_MISSION);
      else pauseHolds.release(PAUSE_HOLDER_MISSION);
    },
    ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    tooltip: noteTooltip,
    onSelectMessageTarget: (target) => {
      const at = messageTargetAnchor(sim.snapshot(), target, deps.elevation);
      if (at !== null) jumpToWorld(at.x, at.y);
      if (target.entity !== null) selectEntity?.(target.entity);
    },
  });

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
  const onEvents = (events: readonly SimEvent[]): void => {
    deps.onEvents?.(events);
    terrainColors(events);
    if (deps.observer !== true) verdict?.onEvents(events);
    presentation?.onEvents(events);
  };

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

  // Open windows and the minimap claim against both camera gestures. The tool-panel strip deliberately
  // does not, so edge-pan and wheel zoom keep working over it.
  const mountedMinimap = minimap;
  const hudClaims = (clientX: number, clientY: number): boolean =>
    toolPanel.claimsWheel(clientX, clientY) || mountedMinimap.claimsPointer(clientX, clientY);
  cameraCtl.setPointerGuard(hudClaims);
  cameraCtl.setEdgeGuard(hudClaims);

  // Late-bound: the badge projection below needs the fog gates and the building index.
  let pickableDoorBadges: (() => readonly DoorBadge[]) | undefined;

  const controls = await createUnitControls({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    humanPlayer: localPlayer,
    observer: deps.observer === true,
    hostileToward: (owner) => sim.diplomacyStance(localPlayer, owner) === 'enemy',
    lang,
    bindings: keyBindings,
    professions: pickerEntries(),
    content: sim.content,
    mapText,
    ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    enqueue: issueCommand,
    centerOn: jumpToWorld,
    drawnItems: () => renderer.drawnItems(),
    doorBadges: () => pickableDoorBadges?.() ?? [],
    equipPickList: (entity, group) => sim.equipPickList(entity as Entity, group),
    boundsOf: (ref) => renderer.entityBounds(ref),
    pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy),
    claimPointer: (x: number, y: number) =>
      toolPanel.claimPointer(x, y) || mountedMinimap.claimsPointer(x, y),
    // A separate instance from the ground tooltip below, which the frame loop hides whenever the
    // pointer is over the HUD - exactly when this one must stay shown.
    tooltip: createTooltip(),
  });
  selectEntity = controls.selectEntity;
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
    sim,
    mapSize: deps.mapSize,
    localPlayer,
    fogGates,
    tribes: deps.tribes ?? [PRIMARY_TRIBE],
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
    selection: { ids: controls.selectedIds, version: controls.selectionVersion },
  });
  pickableDoorBadges = () => doorBadgesFor(sim.snapshot());

  // The script's markers and washes draw over the world and under every HUD plane.
  const scriptOverlay = new Container();
  scriptOverlay.zIndex = SCRIPT_OVERLAY_Z;
  app.stage.addChild(scriptOverlay);
  presentation = createScriptPresentation({
    sim,
    missionTrace: hasDebugFlag(params, 'missions'),
    localPlayer,
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

  // Mounted after the unit controls, so an admin spawn click defers to their composed HUD claim.
  const debugMounts = mountDebugOverlays({
    app,
    canvas,
    params,
    sim,
    perf,
    initialToolsEnabled: storedSettings.debugToolsEnabled,
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

  // Owns its own tooltip element, distinct from the details panel's stock-row tooltip above.
  const worldTooltip = createWorldTooltip({
    renderer,
    camera: () => cameraCtl.camera(),
    clientToScreen,
    goodLabel,
    ...chestTooltipLines(sim.content, toolPanel.controller.uiString, localPlayer, controls.selectedIds),
    pointer: pointerAt,
    suppressed: (clientX, clientY) =>
      toolPanel.controller.placementType() !== null ||
      toolPanel.claimPointer(clientX, clientY) ||
      controls.claimsPointer(clientX, clientY),
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
    perf,
    sound: soundDriver,
    setDebugToolsEnabled: debugMounts.setToolsEnabled,
  });
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
  const mountedPresentation = presentation;
  disposeHud = (): void => {
    liveSettings.dispose();
    toolPanel.dispose();
    noteTooltip.destroy();
    mountedMinimap.dispose();
    controls.dispose();
    mountedPresentation.dispose();
    scriptOverlay.destroy({ children: true });
    perf.dispose();
    worldTooltip.destroy();
    soundDriver?.close();
  };

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
    fpsLimit: storedSettings.fpsLimit,
    onMatchEnd: () => verdict?.finish(sim.matchOutcome(localPlayer)),
    isDisposed: () => destroyed,
    driver,
    frameStats,
    fogGates,
    toolPanel,
    minimap: mountedMinimap,
    controls,
    worldTooltip,
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

  if (deps.introAtStart === true) toolPanel.controller.openMission(deps.introPage ?? undefined);
  // A restored save of a decided match says so at once, since no event will repeat the verdict.
  if (deps.observer !== true) verdict?.announce(sim.matchOutcome(localPlayer));

  return {
    destroy,
    syncSpeed: (control) => toolPanel.controller.syncSpeed(control),
    hudInsetLeftPx: perfCornerForUiScale(uiscale).left,
    get hudInsetBottomLeftPx() {
      const rect = mountedMinimap.panelRect();
      return Math.max(perfCornerForUiScale(uiscale).left, rect === null ? 0 : rect.x + rect.w + 12);
    },
  };
}
