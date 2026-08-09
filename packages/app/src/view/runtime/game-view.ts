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
  FixedTimestep,
  type PlayerCommand,
  playerCommand,
  type SimEvent,
  type Simulation,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { pickerEntries } from '../../catalog/professions.js';
import { FrameStats, installSessionInstruments } from '../../diag/index.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { type MinimapHandle, mountMinimap } from '../../hud/minimap/index.js';
import type { DiplomacyPanelRow } from '../../hud/tool-panel/diplomacy/index.js';
import { buildToolPanelLayout } from '../../hud/tool-panel/layout.js';
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
import { createGroundPileTooltip } from '../ground-pile-tooltip.js';
import { floatParam, menuSearch } from '../params.js';
import { mountPerfOverlay } from '../perf-overlay.js';
import { createFogGates, diplomacyPanelRows } from '../projections/index.js';
import { readStoredSettings } from '../settings-store.js';
import { createSystemMenu } from '../system-menu.js';
import { createTooltip } from '../tooltip.js';
import { createUnitControls } from '../unit-controls/index.js';
import { installDebugHandle } from './debug-handle.js';
import { mountDebugOverlays } from './debug-mounts.js';
import { startFrameLoop } from './frame-loop.js';
import { mountGamePresentation } from './game-presentation.js';
import { createPlacementGates } from './placement-gates.js';
import { trackCanvasPointer } from './pointer-tracker.js';
import type { RafLoop } from './raf-loop.js';
import { createViewReadModels } from './read-models.js';

/** The assembled world and per-session flags a playable entry (`?map=` or `?scene=`) hands the shared runtime. */
export interface GameViewDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  /** World renderer with its terrain already set. */
  readonly renderer: WorldRenderer;
  /** Absent in a checkout without decoded content, which leaves the animated worker field empty. */
  readonly sheet?: SpriteSheet;
  readonly sim: Simulation;
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
  /** Extra per-frame hook after the standard updates. */
  readonly onFrame?: (snapshot: WorldSnapshot) => void;
  /** Sim events from the frame's step(s), delivered before the renderer draws. Skipped on frames that did not step. */
  readonly onEvents?: (events: readonly SimEvent[]) => void;
}

export interface GameSession {
  /** Stop the frame loop and remove this session's overlays. Idempotent; leaves DOM, Pixi and listener teardown to the caller. */
  destroy(): void;
}

/** px gap between the tool-panel strip's right edge and the debug overlay's left edge. */
const PERF_STRIP_GAP = 8;

/** Mount the standard in-game HUD over the assembled world and start the fixed-timestep loop. */
export async function startGameView(deps: GameViewDeps): Promise<GameSession> {
  const { app, canvas, params, renderer, sim, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;
  const seatTribeOf = deps.seatTribeOf ?? ((): number => PRIMARY_TRIBE);

  // Installed before the HUD mounts so the system menu sees an active recording.
  const profile = installSessionInstruments(sim, params);

  let loop: RafLoop | null = null;
  let destroyed = false;
  const systemMenu = createSystemMenu({ onQuit: () => quitToMenu() });
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    loop?.stop();
    systemMenu.dispose();
    // Leaving the debug seam set would pin this sim, renderer and stats for the document's lifetime.
    delete window.__opennorthland;
  };
  const quitToMenu = (): void => {
    destroy();
    window.location.search = menuSearch();
  };

  const storedSettings = readStoredSettings();
  // `?uiscale` pins an absolute HUD scale for reproducible diagnostics; otherwise the scale follows
  // the canvas height at launch times the stored interface-scale factor. Fractional values are allowed.
  const uiscale = floatParam(params, 'uiscale', uiScaleFor(app.screen.height, storedSettings.uiScaleFactor));

  const lang = currentLocale();
  const keyBindings = storedSettings.keyBindings;
  // `?speed=` seeds the wall-clock multiplier; the tool panel's speed button then drives it live.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };
  // Owned here rather than by the loop, so the dropped-tick tally spans the whole session.
  const timestep = new FixedTimestep();
  const frameStats = new FrameStats();

  // A checkout without a decoded sound bank degrades to silence.
  const soundDriver = await mountGamePresentation(params, renderer);

  // The left inset clears the tool-panel strip, so the readout and the build menu never overlap.
  const perf = mountPerfOverlay(buildToolPanelLayout(uiscale).width + PERF_STRIP_GAP);

  // Long-lived consumers close over these predicates; the frame loop refreshes them via `setFrame`.
  const fogGates = createFogGates();

  const { canPlaceAt, canPlaceSignpostAt } = createPlacementGates(sim, fogGates, localPlayer);

  // Assigned right after the tool panel mounts: stage order is draw order, and the minimap window
  // draws over the strip's lower buttons on a short screen.
  let minimap: MinimapHandle | undefined;

  // A read-only spectator drops every HUD command here. Sim-init commands enqueue on the sim directly.
  // The overseer seat commands every player, so its orders enter as trusted admin input instead of one
  // seat reaching into another's units.
  const readOnly = deps.readOnly === true;
  const overseer = deps.observer === true && !readOnly;
  const issueTrusted = (command: Command): void => sim.enqueue(adminCommand(command));
  const issueCommand = (command: PlayerCommand): void => {
    if (readOnly) return;
    sim.enqueue(overseer ? adminCommand(command) : playerCommand(localPlayer, command));
  };

  const diplomacyRows = (): readonly DiplomacyPanelRow[] =>
    diplomacyPanelRows(sim, {
      localPlayer,
      rosterPlayers: deps.rosterPlayers ?? [],
      observer: deps.observer === true,
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    });

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
    diplomacyRows,
    canPlaceAt,
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildings: menuEntriesFromContent(sim.content, lang),
    goods: menuGoodsFromContent(sim.content),
    lang,
    bindings: keyBindings,
    tribe: seatTribeOf(localPlayer),
    owner: localPlayer,
    onSpeed: (spec, cause) => applyGameSpeed(control, spec, cause),
    deferToOverlay: (clientX, clientY) => minimap?.claimsPointer(clientX, clientY) ?? false,
    overlayReserve: () => minimap?.panelRect() ?? null,
    onSystemMenu: () => systemMenu.toggle(),
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
    toScreenPx: clientToScreen,
  });

  // Open windows and the minimap claim against both camera gestures. The tool-panel strip deliberately
  // does not, so edge-pan and wheel zoom keep working over it.
  const mountedMinimap = minimap;
  const hudClaims = (clientX: number, clientY: number): boolean =>
    toolPanel.claimsWheel(clientX, clientY) || mountedMinimap.claimsPointer(clientX, clientY);
  cameraCtl.setPointerGuard(hudClaims);
  cameraCtl.setEdgeGuard(hudClaims);

  // Client coords, null off-canvas. Tracked persistently so the frame loop reads it instead of probing
  // the sim on every mousemove.
  const pointerAt = trackCanvasPointer(canvas);

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

  const {
    goodLabel,
    buildingDoors,
    overlayFrame,
    signpostOverlayFrame,
    hudFor,
    doorBadgesFor,
    constructionSignsFor,
    settlerBubblesFor,
    lifeHeartsFor,
  } = await createViewReadModels({
    sim,
    mapSize: deps.mapSize,
    localPlayer,
    fogGates,
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
    selection: { ids: controls.selectedIds, version: controls.selectionVersion },
  });
  pickableDoorBadges = () => doorBadgesFor(sim.snapshot());

  // Mounted after the unit controls, so an admin spawn click defers to their composed HUD claim.
  const geometryDebug = mountDebugOverlays({
    app,
    canvas,
    params,
    sim,
    // The `?debug=` panel is a dev channel rather than part of the seat's HUD, so a read-only
    // spectator still pokes with it.
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
  const pileTooltip = createGroundPileTooltip({
    renderer,
    camera: () => cameraCtl.camera(),
    clientToScreen,
    goodLabel,
    pointer: pointerAt,
    suppressed: (clientX, clientY) =>
      toolPanel.controller.placementType() !== null ||
      toolPanel.claimPointer(clientX, clientY) ||
      controls.claimsPointer(clientX, clientY),
  });

  installDebugHandle({
    sim,
    renderer,
    sheet: deps.sheet,
    cameraCtl,
    canvas,
    control,
    timestep,
    frameStats,
    profile,
  });

  // This mount owns construction; the loop owns the pinned per-frame order.
  loop = startFrameLoop({
    deps,
    fpsLimit: storedSettings.fpsLimit,
    control,
    timestep,
    frameStats,
    fogGates,
    toolPanel,
    minimap: mountedMinimap,
    controls,
    pileTooltip,
    geometryDebug,
    overlayFrame,
    signpostOverlayFrame,
    hudFor,
    doorBadgesFor,
    constructionSignsFor,
    settlerBubblesFor,
    lifeHeartsFor,
    canPlaceAt,
    canPlaceSignpostAt,
    soundDriver,
    perf,
    pointer: pointerAt,
  });

  return { destroy };
}
