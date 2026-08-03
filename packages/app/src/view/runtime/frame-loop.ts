import type { HudLayout } from '@open-northland/render';
import type { FixedTimestep, SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { createSoundDriver } from '../../content/audio.js';
import { type FrameStats, framePhaseEmitter, recordDiagHash } from '../../diag/index.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import type { GameToolPanelHandle, LoopSpeedControl } from '../game-tool-panel.js';
import type { GroundPileTooltip } from '../ground-pile-tooltip.js';
import type { PerfOverlayHandle } from '../perf-overlay.js';
import type { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
import type {
  computeConstructionSigns,
  computeDoorBadges,
  computeLifeHearts,
  computeSettlerBubbles,
  FogGates,
  GeometryDebugOverlay,
} from '../projections/index.js';
import type { UnitControls } from '../unit-controls/index.js';
import type { GameViewDeps } from './game-view.js';
import { placementCursor } from './placement-cursor.js';
import { type RafLoop, startRafLoop } from './raf-loop.js';

/** Everything the per-frame loop reads, assembled once by the mount phase. */
export interface FrameLoopDeps {
  readonly deps: GameViewDeps;
  readonly control: LoopSpeedControl;
  readonly timestep: FixedTimestep;
  readonly frameStats: FrameStats;
  readonly fogGates: FogGates;
  readonly toolPanel: GameToolPanelHandle;
  readonly minimap: MinimapHandle;
  readonly controls: UnitControls;
  readonly pileTooltip: GroundPileTooltip;
  readonly geometryDebug: GeometryDebugOverlay;
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  /** The erect-signpost band probe, live while signpost placement mode is active. */
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
  /** Memoized by snapshot identity, so it rebuilds per tick rather than per RAF. */
  readonly hudFor: (snap: WorldSnapshot) => HudLayout;
  /** Memoized by snapshot identity and fog-filtered. */
  readonly doorBadgesFor: (snap: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  /** One stand per site door; memoized by snapshot identity and fog-filtered. */
  readonly constructionSignsFor: (snap: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  /** Make-child and wedding bubbles; memoized by snapshot identity and fog-filtered. */
  readonly settlerBubblesFor: (snap: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  /** Memoized by snapshot identity and the selection version, and fog-filtered. */
  readonly lifeHeartsFor: (snap: WorldSnapshot) => ReturnType<typeof computeLifeHearts>;
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly soundDriver: ReturnType<typeof createSoundDriver> | null;
  readonly perf: PerfOverlayHandle;
  /** Client coords; null when the pointer left the canvas. */
  readonly pointer: () => { clientX: number; clientY: number } | null;
}

/**
 * Start the fixed-timestep RAF loop. The per-frame order is pinned here: sim steps, camera, one shared
 * snapshot, then the tool panel and unit controls before `renderer.update`, so screen-space HUD meshes
 * carry this frame's canvas resolution and the baked panel matches the frame drawn over it.
 */
export function startFrameLoop(loop: FrameLoopDeps): RafLoop {
  const {
    deps,
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
  } = loop;
  const { app, renderer, sim, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;

  // Frame phases join the sim instrument's per-system slices in one `?debug=perf` / `?debug=trace` recording.
  const emitPhase = framePhaseEmitter(deps.params);
  let lastMs = performance.now();
  // Interpolation fraction for the renderer's entity anchors; a pause freezes it, so units hold their
  // drawn spot mid-leg.
  let renderAlpha = 1;
  // Every step's events, not just the last tick's: a frame may advance several ticks and each step
  // clears the sim's buffer.
  const frameEvents: SimEvent[] = [];
  // Bound once, so a frame never mints a fresh pair of closures.
  const buildingOverlay = (buildingType: number) =>
    overlayFrame(buildingType, cameraCtl.camera(), app.screen.width, app.screen.height);
  const signpostOverlay = () => signpostOverlayFrame(cameraCtl.camera(), app.screen.width, app.screen.height);
  const collect = (): void => {
    sim.step();
    recordDiagHash(sim);
    for (const ev of sim.events.current()) frameEvents.push(ev);
  };

  function frame(nowMs: number): void {
    const pointer = pointerAt();
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Times our CPU work only, so the overlay can split the frame into CPU vs GPU/compositor.
    const cpu0 = performance.now();
    frameEvents.length = 0;
    // A persistently high step count is the sim falling behind wall-clock.
    let steps = 0;
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, () => {
        collect();
        steps++;
      });
    }
    const simMs = performance.now() - cpu0;
    cameraCtl.update(elapsed);
    // Idempotent: the sepia wash mirrors the pause flag every frame rather than on transitions, so a
    // pauser never has to know about the renderer.
    renderer.setPaused(control.paused);
    // Before anything draws: the map entry's resource handover must release a first-worked node in the
    // same frame the pool starts drawing it.
    if (frameEvents.length > 0) deps.onEvents?.(frameEvents);
    const snap0 = performance.now();
    const snap = sim.snapshot();
    const snapMs = performance.now() - snap0;
    // One fog read shared by the renderer, the minimap mask and the event filter, so no consumer can
    // disagree about a cell. `null` is fog off; an observer gets it view-only, sim fog state untouched.
    const fogView = deps.observer === true ? null : sim.fogView(localPlayer);
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
    toolPanel.controller.update(() => hudFor(snap));
    // Re-placed every frame; the unit dots redraw only on a tick change, the fog mask only on a fog
    // generation change.
    mountedMinimap.update(snap, fogView);
    // Decided here from the sim's placement probe and handed over as plain data: the renderer stays a
    // pure projection and never calls back into the sim.
    const cursor = placementCursor({
      placementType: toolPanel.controller.placementType(),
      signpostActive: controls.signpostPlacementActive(),
      buildingOverlay,
      signpostOverlay,
      tileAt: () => (pointer === null ? null : toolPanel.clientToTile(pointer.clientX, pointer.clientY)),
      canPlaceAt,
      canPlaceSignpostAt,
      localPlayer,
    });
    renderer.updatePlacementOverlay(cursor.overlay);
    renderer.updatePlacementGhost(cursor.ghost);
    // Before `renderer.update`, so the panel a rebuild bakes and the portrait inset painted over it both
    // show this frame's state.
    controls.tick(snap);
    // A world cutout centred on the selection, rendered into the portrait box during `renderer.update`.
    // Null when the selection has no portrait.
    renderer.setPortraitInset(controls.portrait());
    // Fog gate: the plot layer draws above the wash, so an enemy foundation in the black would paint
    // through it. Plot cells are half-cell nodes.
    const plots = sim.constructionPlots();
    renderer.updateConstructionPlots(
      fogView === null
        ? plots
        : plots
            .map((p) => ({
              cells: p.cells.filter((c) => fogGates.seesNode(c.col, c.row)),
            }))
            .filter((p) => p.cells.length > 0),
    );
    geometryDebug.update(snap);
    renderer.setBuildingHighlight(controls.assignHighlight());
    const doorBadges = doorBadgesFor(snap);
    const constructionSigns = constructionSignsFor(snap);
    const settlerBubbles = settlerBubblesFor(snap);
    const lifeHearts = lifeHeartsFor(snap);
    // Blood and bones decay against the sim tick, so a pause or a screenshot reproduces.
    renderer.ingestCombatEffects(presentEvents, snap.tick);
    renderer.update({
      snapshot: snap,
      camera: cameraCtl.camera(),
      tick: snap.tick,
      selection: controls.selectedIds(),
      alpha: renderAlpha,
      doorBadges,
      constructionSigns,
      settlerBubbles,
      lifeHearts,
      flagged: controls.flaggedFlagIds(),
    });
    pileTooltip.update(snap); // after controls, so the pointer-claim state is current
    deps.onFrame?.(snap);
    if (soundDriver !== null) {
      soundDriver.update({
        events: presentEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        localPlayer, // the death stinger rings only for our own units, not enemies or wildlife
        // Chat voices locate their emitter off the snapshot, not off events, so they need their own
        // fog gate: a hidden enemy must not natter from empty black.
        visibleTile: fogGates.visibleTile,
      });
    }
    const cpuMs = performance.now() - cpu0;
    // The remainder after sim and snapshot, so the three sum to cpuMs.
    const drawMs = cpuMs - simMs - snapMs;
    if (emitPhase !== null) {
      // Named approximation: drawMs spans two disjoint intervals but is emitted as the tail one.
      emitPhase('frame/sim', cpu0, cpu0 + simMs);
      emitPhase('frame/snapshot', snap0, snap0 + snapMs);
      emitPhase('frame/draw', snap0 + snapMs, cpu0 + cpuMs);
    }
    frameStats.record({
      elapsedMs: elapsed,
      tick: snap.tick,
      steps,
      // A monotonic session total; the fold derives the per-window delta from it.
      droppedTicks: timestep.droppedTicks,
      speed: control.speed,
      paused: control.paused,
      entities: snap.entities.length,
      cpuMs,
      simMs,
      snapMs,
      drawMs,
      ...renderer.stats(),
    });
    perf.update(frameStats.report());
  }
  return startRafLoop(frame);
}
