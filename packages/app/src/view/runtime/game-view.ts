import { indexById } from '@open-northland/data';
import type { ElevationField, SceneTerrain, SpriteSheet, WorldRenderer } from '@open-northland/render';
import type { SimEvent, Simulation, WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { pickerEntries } from '../../catalog/professions.js';
import {
  installSimPerfMarks,
  installSimTrace,
  PERF_MARKS_DEBUG_FLAG,
  startTraceRecording,
  TRACE_DEBUG_FLAG,
} from '../../diag/index.js';
import { HUD_TRIBE, HUMAN_PLAYER } from '../../game/rules.js';
import { workerRoleOf } from '../../game/sandbox/index.js';
import { type MinimapHandle, mountMinimap } from '../../hud/minimap/index.js';
import { buildToolPanelLayout, DEFAULT_UI_SCALE } from '../../hud/tool-panel/layout.js';
import { currentLocale } from '../../i18n/index.js';
import type { CameraController } from '../camera.js';
import { cameraCenteredOnWorld, clientToScreen as clientToScreenPx } from '../camera.js';
import {
  applyGameSpeed,
  menuEntriesFromContent,
  menuGoodsFromContent,
  mountGameToolPanel,
} from '../game-tool-panel.js';
import { createGroundPileTooltip } from '../ground-pile-tooltip.js';
import { floatParam, menuSearch } from '../params.js';
import { mountPerfOverlay } from '../perf-overlay.js';
import { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
import { createFogGates, createSnapshotProjections } from '../projections/index.js';
import { createSystemMenu } from '../system-menu.js';
import { createTooltip } from '../tooltip.js';
import { createUnitControls } from '../unit-controls/index.js';
import { mountDebugOverlays } from './debug-mounts.js';
import { startFrameLoop } from './frame-loop.js';
import { mountGamePresentation } from './game-presentation.js';
import { createPlacementGates } from './placement-gates.js';
import { trackCanvasPointer } from './pointer-tracker.js';
import type { RafLoop } from './raf-loop.js';

/**
 * The shared in-game runtime both playable entries (`?map=` and `?scene=`) run on top of: the standard
 * HUD mounts (left tool panel, RTS unit controls, perf overlay, positional sound) and the one
 * fixed-timestep RAF loop. The entries only assemble their world (terrain, sim, renderer, starting
 * camera) and hand it here — so the loop, the input wiring and the flag semantics (`?speed`, `?sound`,
 * `?uiscale`) cannot drift between the map view and the acceptance scenes.
 */
export interface GameViewDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  /** The retained world renderer, terrain already set. */
  readonly renderer: WorldRenderer;
  /** The loaded sprite sheet (the renderer's own), forwarded to the details panel's animated workers
   *  field. Optional: a bare checkout has none and the field stays empty. */
  readonly sheet?: SpriteSheet;
  /** The live sim this view steps and draws. */
  readonly sim: Simulation;
  /** The interactive camera (the entry picks the starting frame). */
  readonly cameraCtl: CameraController;
  /** The terrain grid the sound driver's ambient beds sample (and the minimap rasterizes). */
  readonly terrainGrid: SceneTerrain;
  /** typeId → minimap ground colour (the real terrain set's per-type debug colours). In a bare
   *  checkout the minimap falls back to the render flat-tint palette. */
  readonly terrainColour?: (typeId: number) => number | undefined;
  /** Per-cell minimap ground colours from a decoded map's baked ground lanes
   *  (`content/minimap-ground.ts`) — preferred over the typeId palette, which can't depict them. */
  readonly minimapCellColours?: Uint32Array;
  /** Map bounds in cells for placement/order clicks (a click outside is rejected, never clamped);
   *  grid-logic consumers derive the 2× node bounds from it. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field so clicks on lifted hills resolve to the tile drawn there. */
  readonly elevation?: ElevationField;
  /** The player the person controls — the map roster seat picked in the menu (`?player=N`).
   *  Default {@link HUMAN_PLAYER}: scenes and roster-less maps play slot 0, as before. Drives the
   *  fog perspective, unit selection/orders, placement ownership and the HUD's economy view. */
  readonly localPlayer?: number;
  /** Owner slot → team-colour slot (the map roster's colour choices) for player-coloured HUD bits
   *  (minimap dots, the details panel's worker sprites). The renderer's own sprites take the same
   *  mapping via {@link WorldRendererOptions.playerColourOf} at construction. Default identity. */
  readonly playerColourOf?: (player: number) => number;
  /** Extra per-frame hook after the standard updates. */
  readonly onFrame?: (snapshot: WorldSnapshot) => void;
  /**
   * Per-frame hook fed every sim event the frame's step(s) produced, invoked before the renderer draws
   * — the `?map=` entry's static→dynamic resource handover reacts to `resourceFelled`/`resourceMined`/
   * `resourceDepleted` here, so the static sprite is gone the same frame the pool starts drawing the
   * node. Called only on frames that stepped (no events otherwise).
   */
  readonly onEvents?: (events: readonly SimEvent[]) => void;
}

/**
 * A running game session — the one owner of "a running game" (this view plus its RAF loop) above the
 * per-entry mounts. {@link destroy} is the single teardown seam quit-to-menu and a future
 * load-game/restart share instead of each re-deriving how to stop the loop.
 */
export interface GameSession {
  /** Stop the running game: halt the frame loop so no second loop steps the stage once a new game
   *  starts, and remove this session's own overlays. Idempotent. Full-page navigation (the v1
   *  transition) unloads the rest; per-subsystem teardown for an in-page transition is a follow-up
   *  (docs/tickets/app/game-session-teardown.md). */
  destroy(): void;
}

/** px gap between the tool-panel strip's right edge and the debug overlay's left edge. */
const PERF_STRIP_GAP = 8;

/**
 * Mount the standard in-game HUD over the assembled world and start the fixed-timestep loop. Resolves
 * with the {@link GameSession} once the loop is running (the RAF chain keeps itself alive from there).
 */
export async function startGameView(deps: GameViewDeps): Promise<GameSession> {
  const { app, canvas, params, renderer, sim, cameraCtl } = deps;
  // The controlled player — every "our units / our fog / our economy" read below goes through it.
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;

  // `?debug=perf` (live DevTools User Timing marks) / `?debug=trace` (a bounded Trace Event
  // recording, exportable from the system menu) — two consumers of the sim's per-system instrument
  // seam. Started before the HUD mounts so the system menu sees an active recording.
  if (params.get('debug') === PERF_MARKS_DEBUG_FLAG) installSimPerfMarks(sim);
  if (params.get('debug') === TRACE_DEBUG_FLAG) {
    startTraceRecording();
    installSimTrace(sim);
  }

  // `destroy` halts the loop and drops this session's overlays so a later game never runs a second loop
  // over the same stage; `quitToMenu` then navigates back. Full-page navigation is the v1 transition —
  // the browser unloads the DOM/Pixi/listeners the per-subsystem teardown does not yet cover (see
  // docs/tickets/app/game-session-teardown.md).
  let loop: RafLoop | null = null;
  let destroyed = false;
  const systemMenu = createSystemMenu({ onQuit: () => quitToMenu() });
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    loop?.stop();
    systemMenu.dispose();
  };
  const quitToMenu = (): void => {
    destroy();
    window.location.search = menuSearch();
  };

  // `?uiscale=` — parsed once, shared by the tool panel and the action ring. Fractional allowed (the
  // default is 1.4×); the consumers clamp it to ≥1.
  const uiscale = floatParam(params, 'uiscale', DEFAULT_UI_SCALE);

  // `?lang=` — the UI-string + building-name language (defaults to Polish). Shared by the building menu's
  // localized names and the tool panel's decoded UI strings so the two can't drift.
  const lang = currentLocale();
  // Playback control. `?speed=` seeds the initial wall-clock multiplier (default ×1; e.g. `&speed=0.5`
  // for a calm, sub-1× pace the panel's discrete speed button can't reach). The tool panel's game-speed
  // button then drives it live (×1 → ×2 → ×3 → ×1; `P` toggles pause) without clobbering this seed at mount.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };

  // Original decoded sounds, played positionally: action SFX + terrain ambient (viewport-culled,
  // attenuated, panned) + non-spatial life-event jingles + settler voice chatter — a pure consumer of
  // the same snapshot + events render reads. Default-muted: the driver is built (unless `?sound=off`
  // skips it entirely) but starts disabled, so the game is silent until the user clicks the bottom
  // sound toggle — that click both unmutes and satisfies the browser autoplay gesture. A checkout
  // without `content/` (no sound bank) degrades to silence (no driver, no button).
  const soundDriver = await mountGamePresentation(params, renderer);

  // On-canvas debug readout (top-left, just clear of the tool-panel strip): tick / speed / steps /
  // entity counts + the FPS and the sim/snap/draw CPU split, so a human can judge whether the view holds
  // a frame rate, whether culling is biting, and whether a slow frame is the sim or the draw. Real-GPU
  // only: headless Chromium is software-GL. The left inset is the strip's right edge + a small gap; the
  // build menu drops below it (from the buildings button), so the two never overlap.
  const perf = mountPerfOverlay(buildToolPanelLayout(uiscale).width + PERF_STRIP_GAP);

  // The frame's fog gate for the human player: the long-lived consumers here (unit picking, the pile
  // tooltip, the placement gate, voice chatter) close over its stable predicates, refreshed via
  // `fogGates.setFrame` each frame (see projections/fog-gates.ts).
  const fogGates = createFogGates();

  // The live placement rules the tool panel's click gate and the frame loop's cursor ghosts share.
  const { canPlaceAt, canPlaceSignpostAt } = createPlacementGates(sim, fogGates, localPlayer);

  // The minimap handle, assigned right after the tool panel mounts (the panel must mount first — stage
  // order is draw order, and the minimap window draws over the strip's lower buttons on a short
  // screen). The panel's overlay-defer reads it lazily: clicks only happen long after both mounts.
  let minimap: MinimapHandle | undefined;

  // The original left tool panel — the standard game HUD. Its game-speed button drives `control`, the
  // building menu enqueues `placeBuilding` on a map click, and it claims its own clicks so the HUD
  // never falls through to world picking.
  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    enqueue: (command) => sim.enqueue(command),
    canPlaceAt,
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildings: menuEntriesFromContent(sim.content, lang),
    goods: menuGoodsFromContent(sim.content),
    lang,
    tribe: HUD_TRIBE,
    owner: localPlayer,
    onSpeed: (spec, cause) => applyGameSpeed(control, spec, cause),
    deferToOverlay: (clientX, clientY) => minimap?.claimsPointer(clientX, clientY) ?? false,
    onSystemMenu: () => systemMenu.toggle(),
  });

  // The canvas-bound client→screen conversion injected into the minimap and world pickers (`hud/` never
  // imports `view/` — passed as options per the hud contract).
  const clientToScreen = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToScreenPx(canvas, app.renderer.resolution, clientX, clientY);
  // The bottom-left minimap in the original braided overview frame: whole-map ground + player-coloured
  // unit dots + the camera's view rectangle; a left-click (or drag) in the map hole re-centres the
  // camera on the pointed world spot at the current zoom. Mounted after the tool panel (draws over its
  // strip on a short screen — and the panel's overlay-defer above yields those covered clicks) and
  // before the unit controls (its claim joins their pointer chain: a minimap click must never select
  // units or issue world orders).
  minimap = await mountMinimap({
    app,
    canvas,
    terrain: deps.terrainGrid,
    cellColours: deps.minimapCellColours,
    colourOf: deps.terrainColour,
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    uiscale,
    camera: () => cameraCtl.camera(),
    onJump: (wx, wy) => {
      const zoom = cameraCtl.camera().scale ?? 1;
      cameraCtl.jumpTo(cameraCenteredOnWorld(wx, wy, zoom, app.screen.width, app.screen.height));
    },
    toScreenPx: clientToScreen,
  });

  // The open pop-up windows (build menu / goods / stats) and the minimap claim the cursor against BOTH
  // camera gestures: the wheel belongs to the window's list (not a zoom behind it) and the screen edge
  // under them must not pan. The tool-panel STRIP deliberately does not claim — it hugs the left screen
  // edge, and the RTS edge-pan (and wheel zoom) keep working over it.
  const mountedMinimap = minimap;
  const hudClaims = (clientX: number, clientY: number): boolean =>
    toolPanel.claimsWheel(clientX, clientY) || mountedMinimap.claimsPointer(clientX, clientY);
  cameraCtl.setPointerGuard(hudClaims);
  cameraCtl.setEdgeGuard(hudClaims);

  // The cursor position for the build-mode ghost (client coords; null when the pointer left the
  // canvas). Tracked persistently — the ghost must follow the mouse between clicks, and reading it in
  // the frame loop keeps all per-frame work in the one RAF (no per-mousemove sim probing).
  const pointerAt = trackCanvasPointer(canvas);

  // RTS unit control: left-click / drag-box to select the human's units, right-click to send them,
  // Space for the action menu. Reads the camera + snapshot through closures, issues commands into the
  // sim. Harmless on scenes with no owned units (nothing is pickable).
  const controls = await createUnitControls({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    humanPlayer: localPlayer,
    lang,
    professions: pickerEntries(),
    content: sim.content,
    ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
    ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
    enqueue: (command) => sim.enqueue(command),
    boundsOf: (ref) => renderer.entityBounds(ref), // exact sprite-box picking against the real sprite
    pixelHitOf: (ref, wx, wy) => renderer.entityPixelHit(ref, wx, wy), // buildings: solid pixels only
    fogVisible: fogGates.visibleTile, // enemy right-click targets are fog-culled like the drawn scene
    claimPointer: (x: number, y: number) =>
      toolPanel.claimPointer(x, y) || mountedMinimap.claimsPointer(x, y),
    // The Magazyn stock-row name tooltip. Its own instance (not the ground one below): the two hover
    // surfaces are mutually exclusive by cursor, and a shared element would fight — the frame loop hides the
    // ground tooltip whenever the pointer is over the HUD, which is exactly when this one must stay shown.
    tooltip: createTooltip(),
  });

  // The good display label by sim goodType — the one localized name source (the scene entry seeded
  // `sim.content.goods` names from the `?locale` language). Shared by the ground-pile tooltip below and the
  // admin spawn palette, so both read in the player's language; falls back to the good's id.
  const goodLabelByType = new Map<number, string>(sim.content.goods.map((g) => [g.typeId, g.name ?? g.id]));

  // One shared building index drives door badges and the optional geometry overlay.
  const buildingDoors = indexById(sim.content.buildings);

  // The developer overlays: the `?debug=geometry` diagram (ticked by the frame loop) + the admin spawn
  // palette. Mounted after the unit controls — an admin spawn click defers to their composed HUD claim.
  const geometryDebug = mountDebugOverlays({
    app,
    canvas,
    params,
    sim,
    renderer,
    cameraCtl,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildingsByType: buildingDoors,
    clientToScreen,
    clientToTile: (x, y) => toolPanel.clientToTile(x, y),
    claimPointer: (x, y) => controls.claimsPointer(x, y),
    goodLabel: (typeId) => goodLabelByType.get(typeId),
  });

  // Name-on-hover: a cursor tooltip naming the loose good pile (with its count) under the pointer. A
  // screen-bounded, snapshot-memoized subsystem in its own module; it owns its own tooltip element
  // (distinct from the details panel's Magazyn stock-row tooltip above) and yields the pointer to build
  // placement and the HUD.
  const pileTooltip = createGroundPileTooltip({
    app,
    renderer,
    camera: () => cameraCtl.camera(),
    clientToScreen,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    fogVisible: fogGates.visibleTile,
    goodLabel: (typeId) => goodLabelByType.get(typeId),
    pointer: pointerAt,
    suppressed: (clientX, clientY) =>
      toolPanel.controller.placementType() !== null ||
      toolPanel.claimPointer(clientX, clientY) ||
      controls.claimsPointer(clientX, clientY),
  });

  // The memoized build-mode band probe (see makeOverlayFrameSource) — one instance per view — and its
  // erect-signpost twin (shown while the scout's placement click is pending).
  const overlayFrame = makeOverlayFrameSource(sim, deps.mapSize, localPlayer);
  const signpostOverlayFrame = makeSignpostOverlaySource(sim, deps.mapSize, localPlayer);
  // Per-frame O(entities) projections memoized by snapshot identity: a frame that did not step reuses
  // its HUD read-view and fog-filtered door badges instead of re-scanning every entity.
  const { hudFor, doorBadgesFor, settlerBubblesFor } = createSnapshotProjections(
    buildingDoors,
    workerRoleOf,
    fogGates,
  );

  // Hand the assembled world + HUD subsystems to the steady-state RAF loop (frame-loop.ts). The
  // mount above owns construction; the loop owns the pinned per-frame order. The returned stop handle is
  // the session's — quit halts the loop before navigating away.
  loop = startFrameLoop({
    deps,
    control,
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
    settlerBubblesFor,
    canPlaceAt,
    canPlaceSignpostAt,
    soundDriver,
    perf,
    pointer: pointerAt,
  });

  return { destroy };
}
