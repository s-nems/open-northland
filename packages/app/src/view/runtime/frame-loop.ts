import type { MusicStanding } from '@open-northland/audio';
import type { SessionDriver } from '@open-northland/lockstep';
import {
  cameraViewport,
  type DrawItem,
  type HudLayout,
  type HudModel,
  SPRITE_CULL_MARGIN,
  type Viewport,
} from '@open-northland/render';
import {
  type FogView,
  type Paper,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { createSoundDriver } from '../../content/audio.js';
import { type FrameStats, framePhaseEmitter, recordTickDiagnostics } from '../../diag/index.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import type { BuildingPick } from '../../hud/tool-panel/placement.js';
import { setCanvasCursor } from '../cursors/element.js';
import { placementPointer } from '../cursors/placement.js';
import { createFellingPresenter } from '../felling-presenter.js';
import type { GameToolPanelHandle } from '../game-tool-panel.js';
import type { SignpostMapOverlay } from '../map-overlays/signposts.js';
import type { PerfOverlayHandle } from '../perf-overlay.js';
import type {
  LitAnswers,
  makeDockOverlaySource,
  makeLitOverlaySource,
  makeOverlayFrameSource,
  makeSignpostOverlaySource,
} from '../placement-overlay.js';
import {
  type computeConstructionSigns,
  type computeDoorBadges,
  type computeLifeHearts,
  type computeSettlerBubbles,
  type FogGates,
  type GeometryDebugOverlay,
  harshestStance,
} from '../projections/index.js';
import type { FpsLimit } from '../settings-store.js';
import type { UnitControls } from '../unit-controls/index.js';
import { lostGoalPulse } from '../unit-controls/lost-goals.js';
import type { WorldHover } from '../world-hover.js';
import type { GameViewDeps } from './game-view.js';
import type { NetReadout } from './net-readout.js';
import { placementCursor } from './placement-cursor.js';
import { type RafLoop, startRafLoop } from './raf-loop.js';
import type { ScriptPresentation } from './script-presentation.js';
import { createVisiblePlots } from './visible-plots.js';

/** Everything the per-frame loop reads, assembled once by the mount phase. */
export interface FrameLoopDeps {
  readonly deps: GameViewDeps;
  readonly suspended?: () => boolean;
  readonly fpsLimit: FpsLimit;
  /** The viewer's fog this frame draws through; null is fog off or a whole-map spectator. */
  readonly fogView: () => FogView | null;
  /** The seat the music's mood and the life-event jingles follow; the whole map reads every seat as
   *  met, and no jingle rings for nobody's seat. */
  readonly viewer: ViewerSeat;
  readonly onMatchEnd?: () => void;
  readonly isDisposed?: () => boolean;
  /** Once, when the animation frame after the first drawn one begins; see {@link startRafLoop}. */
  readonly onFirstFrameShown?: () => void;
  /** The session driver: it decides how many ticks this frame may run and holds the render alpha. */
  readonly driver: SessionDriver;
  readonly frameStats: FrameStats;
  readonly fogGates: FogGates;
  readonly toolPanel: GameToolPanelHandle;
  readonly minimap: MinimapHandle;
  readonly mapOverlay?: SignpostMapOverlay;
  readonly controls: UnitControls;
  readonly worldHover: WorldHover;
  readonly geometryDebug: GeometryDebugOverlay;
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  /** The erect-signpost band probe, live while signpost placement mode is active. */
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
  readonly litOverlayFrame: ReturnType<typeof makeLitOverlaySource>;
  /** The mooring-spot band probe, live while a ship's dock pick is armed. */
  readonly dockOverlayFrame: ReturnType<typeof makeDockOverlaySource>;
  /** Memoized by snapshot identity, so it rebuilds per tick rather than per RAF. */
  readonly hudFor: (snap: WorldSnapshot) => HudLayout;
  /** The same per-tick aggregation behind {@link hudFor}, for its figures rather than its layout. */
  readonly hudModelFor: (snap: WorldSnapshot) => HudModel;
  /** Memoized by snapshot identity and the screen, and fog-filtered. */
  readonly doorBadgesFor: (snap: WorldSnapshot, viewport?: Viewport) => ReturnType<typeof computeDoorBadges>;
  /** One stand per site door; memoized by snapshot identity and fog-filtered. */
  readonly constructionSignsFor: (snap: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  /** Make-child and wedding bubbles; memoized by snapshot identity and fog-filtered. */
  readonly settlerBubblesFor: (snap: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  /** Memoized by snapshot identity, the screen and the selection version, and fog-filtered. */
  readonly lifeHeartsFor: (snap: WorldSnapshot, viewport?: Viewport) => ReturnType<typeof computeLifeHearts>;
  readonly canPlaceAt: (typeId: number, tribe: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly soundDriver: ReturnType<typeof createSoundDriver> | null;
  /** The map script's display: its camera jitter for the frame, and its overlays after the draw. */
  readonly presentation: Pick<ScriptPresentation, 'jitter' | 'frame'> | null;
  readonly perf: PerfOverlayHandle;
  /** A relayed session's connection figures for the overlay; null in a local session. */
  readonly netReadout: () => NetReadout | null;
  /** True while a relay holds the clock for a member, which washes the world as a pause does; omitted
   *  outside a relayed game. */
  readonly clockHeld?: () => boolean;
  /** Called every frame of a local session with the delivered speed while a sustained shortfall
   *  holds, else null; omitted where the relay runs the clock. */
  readonly onSpeedShortfall?: (delivered: number | null, requested: number) => void;
  /** Client coords; null when the pointer left the canvas. */
  readonly pointer: () => { clientX: number; clientY: number } | null;
  /** Reconcile Pixi's live screen size before camera and HUD work. */
  readonly syncViewport: (nowMs: number) => void;
}

/** The entity ids of the settlers and animals in a culled draw list - both draw as the `settler` kind. */
function drawnCreatureIds(items: readonly DrawItem[]): number[] {
  const ids: number[] = [];
  for (const item of items) if (item.kind === 'settler') ids.push(item.ref);
  return ids;
}

/**
 * Start the RAF loop over a session driver. The per-frame order is pinned here: sim steps, camera, one
 * shared snapshot, then the tool panel and unit controls before `renderer.update`, so screen-space HUD
 * meshes carry this frame's canvas resolution and the baked panel matches the frame drawn over it.
 */
export function startFrameLoop(loop: FrameLoopDeps): RafLoop {
  const {
    deps,
    driver,
    frameStats,
    fogGates,
    toolPanel,
    minimap: mountedMinimap,
    controls,
    worldHover,
    geometryDebug,
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
    pointer: pointerAt,
    syncViewport,
  } = loop;
  const { app, renderer, host, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;

  // Frame phases join the sim instrument's per-system slices in one `?debug=perf` / `?debug=trace` recording.
  const emitPhase = framePhaseEmitter(deps.params);
  let lastMs = performance.now();
  // Every step's events, not just the last tick's: a frame may advance several ticks and each step
  // clears the sim's buffer.
  const frameEvents: SimEvent[] = [];
  // The roster the music's mood reads our standing against; one object, its seat read live.
  const musicRoster = {
    get localPlayer() {
      return loop.viewer.seat() ?? localPlayer;
    },
    rosterPlayers: deps.rosterPlayers ?? [],
    get observer() {
      return loop.viewer.wholeMap();
    },
  };
  // Bound once; the model behind it is the summary bar's too, memoised per snapshot, so the mood costs
  // the stance read alone.
  const musicStanding = (snap: WorldSnapshot): MusicStanding => ({
    population: hudModelFor(snap).population,
    stance: harshestStance(host, musicRoster),
  });
  // Bound once, so a frame never mints a fresh pair of closures.
  const buildingOverlay = ({ typeId, tribe, paper }: BuildingPick) =>
    overlayFrame(typeId, tribe, cameraCtl.camera(), app.screen.width, app.screen.height, paper ?? undefined);
  const signpostOverlay = () => signpostOverlayFrame(cameraCtl.camera(), app.screen.width, app.screen.height);
  const frameReport = () => frameStats.report();
  const visiblePlots = createVisiblePlots(() => host.constructionPlots(), fogGates.seesNode);
  const presentFellings =
    deps.fellingClips === undefined
      ? null
      : createFellingPresenter(renderer, deps.fellingClips, deps.elevation);
  // The wall and road tools light where a line starts, then the started line's reach; the gate tool the
  // spans it can cut into.
  const palisadeWash = () => {
    const { controller } = toolPanel;
    const line = controller.activeLine();
    const lit = line !== null ? line.reach() : (controller.lineStarts() ?? controller.gateSites());
    if (lit === null) return null;
    const gfxIndex = controller.palisadeGfxIndex();
    const answers: LitAnswers | null = controller.roadActive()
      ? { tool: 'road' }
      : gfxIndex !== null && controller.palisadeMode() !== 'gate'
        ? { tool: 'palisade', gfxIndex }
        : null;
    return litOverlayFrame(lit, answers, cameraCtl.camera(), app.screen.width, app.screen.height);
  };
  const dockOverlay = (vehicle: number) =>
    dockOverlayFrame(vehicle, cameraCtl.camera(), app.screen.width, app.screen.height);
  // A frame may advance several ticks; `steps` is read back after the driver returns.
  let steps = 0;
  const collect = (): void => {
    steps++;
    recordTickDiagnostics(host);
    for (const ev of host.tickEvents()) {
      frameEvents.push(ev);
      if (ev.kind === 'missionSubMission' && !deps.sharedClock) driver.setPaused(true);
    }
  };

  function frame(nowMs: number): void {
    if (loop.suspended?.() === true && !deps.sharedClock) driver.setPaused(true);
    syncViewport(nowMs);
    const pointer = pointerAt();
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Times our CPU work only, so the overlay can split the frame into CPU vs GPU/compositor.
    const cpu0 = performance.now();
    frameEvents.length = 0;
    // A persistently high step count is the sim falling behind wall-clock.
    steps = 0;
    const renderAlpha = driver.advance(elapsed, collect);
    // A synchronous driver failure can tear down the view while advance is on the stack.
    if (loop.isDisposed?.()) return;
    const advanceMs = performance.now() - cpu0;
    const offThread = deps.offThreadTickCost?.() ?? null;
    cameraCtl.update(elapsed); // a no-op while the system menu holds the camera suspended
    // Idempotent: the sepia wash mirrors the pause flag and the relay's hold every frame rather than
    // on transitions, so neither a pauser nor the relay feed has to know about the renderer.
    renderer.setPaused(driver.paused || loop.clockHeld?.() === true);
    // Before anything draws: the map entry's resource handover must release a first-worked node in the
    // same frame the pool starts drawing it.
    if (frameEvents.length > 0) deps.onEvents?.(frameEvents);
    if (deps.sharedClock && deps.confirmedMatchEnd?.() != null) loop.onMatchEnd?.();
    const snap0 = performance.now();
    const snap = host.snapshot();
    const snapMs = performance.now() - snap0;
    // One fog read shared by the renderer, the minimap mask and the event filter, so no consumer can
    // disagree about a cell. `null` is fog off; a spectator gets it view-only, sim fog state untouched.
    const fogView = loop.fogView();
    fogGates.setFrame(fogView); // before anything below consults the predicates
    renderer.updateFog(fogView);
    // Presentation only: a fight in the fog must neither splatter blood nor ring audible clangs. Event
    // `at` coords are half-cell nodes. The entry's `onEvents` above keeps the unfiltered list, since a
    // fogged tree felled by an enemy must still hand over its static sprite.
    const presentEvents =
      fogView === null
        ? frameEvents
        : frameEvents.filter((ev) => !('at' in ev) || fogGates.seesNode(ev.at.hx, ev.at.hy));
    // Before the renderer's render: the panel's screen-space sprites carry the canvas resolution in
    // their shader.
    toolPanel.controller.update(() => hudFor(snap), hudModelFor(snap));
    // An open briefing's map pictures, painted over the window during `renderer.update`.
    renderer.setMapViews(toolPanel.controller.mapViews());
    // Unfiltered: the notes are the seat's own affairs, and its own settler in the fog still starves.
    toolPanel.controller.presentMessages(snap, frameEvents, host.departed(), renderAlpha);
    toolPanel.controller.presentFigures(snap, renderAlpha);
    // Re-placed every frame; the unit dots redraw on a throttled cadence, the fog mask only on a fog
    // generation change.
    const lostGoals = controls.lostGoals();
    mountedMinimap.update(snap, fogView, lostGoals);
    // Decided here from the host's placement probe and handed over as plain data: the renderer stays a
    // pure projection and never calls back into the host.
    const cursor = placementCursor({
      building: toolPanel.controller.placementBuilding(),
      palisadeGfxIndex: toolPanel.controller.palisadeGfxIndex(),
      roadActive: toolPanel.controller.roadActive(),
      signpostActive: controls.signpostPlacementActive(),
      dockVehicle: controls.dockPickVehicle(),
      flagActive: controls.workFlagPlacementActive(),
      buildingOverlay,
      signpostOverlay,
      dockOverlay,
      tileAt: () => (pointer === null ? null : toolPanel.clientToTile(pointer.clientX, pointer.clientY)),
      canPlaceAt,
      canPlaceSignpostAt,
      palisadePreview: (tile) => toolPanel.controller.palisadePreview(tile),
      roadPreview: (tile) => toolPanel.controller.roadPreview(tile),
      gatePreview: (tile) => toolPanel.controller.gatePreview(tile),
      anchored: toolPanel.controller.activeLine() !== null,
      palisadeWash,
      localPlayer,
    });
    renderer.updatePlacementOverlay(cursor.overlay);
    renderer.updatePlacementGhost(cursor.ghost, snap);
    setCanvasCursor(
      deps.canvas,
      'placement',
      placementPointer(
        toolPanel.controller.placementBuilding() !== null ||
          toolPanel.controller.palisadeGfxIndex() !== null ||
          toolPanel.controller.roadActive(),
        cursor.ghost,
      ),
    );
    // Before `renderer.update`, so the panel a rebuild bakes and the portrait inset painted over it both
    // show this frame's state.
    controls.tick(snap);
    controls.presentFigures(snap, renderAlpha);
    // World cutouts centred on the selection and on the trade window's houses, rendered into their boxes
    // during `renderer.update`; the list is the same object while the boxes hold still.
    renderer.setPortraitInsets(controls.portraits());
    renderer.updateConstructionPlots(visiblePlots(fogView));
    geometryDebug.update(snap);
    // The gate tool tints the walls it can cut into; otherwise an assignment tints its candidates.
    renderer.setBuildingHighlight(toolPanel.controller.gateSites()?.highlight ?? controls.assignHighlight());
    const constructionSigns = constructionSignsFor(snap);
    const settlerBubbles = settlerBubblesFor(snap);
    // Blood and bones decay against the sim tick, so a pause or a screenshot reproduces.
    renderer.ingestCombatEffects(presentEvents, snap.tick);
    // Every frame, stepped or not: a playing clip ends on the tick, and its trunk shows with that frame.
    presentFellings?.(presentEvents, snap.tick);
    // A script's earthquake shakes the drawn world alone; picking and the HUD keep the steady frame.
    const jitter = presentation?.jitter(nowMs) ?? null;
    const camera = cameraCtl.camera();
    const drawnCamera =
      jitter === null
        ? camera
        : { ...camera, offsetX: camera.offsetX + jitter.dx, offsetY: camera.offsetY + jitter.dy };
    // The renderer culls the marks by this box, so the projections read only the units under it.
    const markViewport = cameraViewport(
      drawnCamera,
      app.screen.width,
      app.screen.height,
      SPRITE_CULL_MARGIN + (deps.elevation?.maxLift ?? 0),
    );
    const doorBadges = doorBadgesFor(snap, markViewport);
    const lifeHearts = lifeHeartsFor(snap, markViewport);
    const world0 = performance.now();
    renderer.update({
      snapshot: snap,
      camera: drawnCamera,
      tick: snap.tick,
      selection: controls.selectedIds(),
      selectionTime: nowMs / 1000,
      alpha: renderAlpha,
      doorBadges,
      constructionSigns,
      settlerBubbles,
      lifeHearts,
      flagged: controls.flaggedFlagIds(),
      focused: controls.focusedIds(),
      groupNumbers: controls.groupNumbers(),
      rangeRings: controls.rangeRings(),
      orderMarkers: controls.orderMarkers(),
      lostGoals,
      lostGoalPulse: lostGoalPulse(nowMs),
    });
    const worldMs = performance.now() - world0;
    loop.mapOverlay?.update(snap, drawnCamera, app.screen, loop.viewer.seat(), fogView);
    controls.refreshCursor(snap);
    worldHover.update(snap, nowMs); // after controls, so the pointer-claim state is current
    presentation?.frame(snap, drawnCamera, nowMs);
    deps.onFrame?.(snap);
    // After `renderer.update`, which stepped the weather this frame.
    soundDriver?.updateWeather(renderer.weatherConditions(), (snap.tick + renderAlpha) / TICKS_PER_SECOND);
    if (soundDriver !== null) {
      const jingleSeat = loop.viewer.seat();
      soundDriver.update({
        events: presentEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        // Life-event jingles ring only for our own entities, not enemies or wildlife; none for nobody's seat.
        ...(jingleSeat === null ? {} : { localPlayer: jingleSeat }),
        // A settler's authored action cues locate their emitter off the snapshot, not off events, so
        // they need their own fog gate: a hidden enemy must not natter or hammer out of empty black.
        visibleTile: fogGates.visibleTile,
        // Which mood variant of the map's music plays: our head-count and how we stand with the roster.
        standingOf: musicStanding,
        // The idle chatter and animal calls roll over what the renderer just drew, the original's "seen"
        // counters; read only on a frame that advanced a tick.
        drawnCreatures: () => drawnCreatureIds(renderer.drawnItems()),
      });
    }
    const cpuMs = performance.now() - cpu0;
    // The remainder after the driver and the snapshot, so the three sum to cpuMs.
    const drawMs = cpuMs - advanceMs - snapMs;
    if (emitPhase !== null) {
      // Named approximation: drawMs spans two disjoint intervals but is emitted as the tail one.
      emitPhase('frame/sim', cpu0, cpu0 + advanceMs);
      emitPhase('frame/snapshot', snap0, snap0 + snapMs);
      emitPhase('frame/draw', snap0 + snapMs, cpu0 + cpuMs);
    }
    frameStats.record({
      elapsedMs: elapsed,
      tick: snap.tick,
      steps,
      // A monotonic session total; the fold derives the per-window delta from it.
      droppedTicks: driver.droppedTicks,
      speed: driver.speed,
      paused: driver.paused,
      entities: snap.entities.length,
      cpuMs,
      simMs: offThread?.simMs ?? advanceMs,
      receiveMs: offThread?.receiveMs ?? 0,
      batches: offThread?.batches ?? 0,
      leadTicks: offThread?.leadTicks ?? 0,
      snapMs,
      drawMs,
      worldMs,
      ...renderer.stats(),
    });
    perf.update(frameReport, netReadout);
    loop.onSpeedShortfall?.(frameStats.sustainedShortfallSpeed(), driver.speed);
  }
  return startRafLoop(frame, {
    fpsLimit: loop.fpsLimit,
    ...(loop.onFirstFrameShown === undefined ? {} : { onFirstFrameShown: loop.onFirstFrameShown }),
  });
}
