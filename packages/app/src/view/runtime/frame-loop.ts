import type { MusicStanding } from '@open-northland/audio';
import type { SessionDriver } from '@open-northland/lockstep';
import type { DrawItem, HudLayout, HudModel } from '@open-northland/render';
import type { Paper, SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { createSoundDriver } from '../../content/audio.js';
import { type FrameStats, framePhaseEmitter, recordDiagHash } from '../../diag/index.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import type { MinimapHandle } from '../../hud/minimap/index.js';
import type { GameToolPanelHandle } from '../game-tool-panel.js';
import type { PerfOverlayHandle } from '../perf-overlay.js';
import type { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
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
import type { WorldTooltip } from '../world-tooltip.js';
import type { GameViewDeps } from './game-view.js';
import type { NetReadout } from './net-readout.js';
import { placementCursor } from './placement-cursor.js';
import { type RafLoop, startRafLoop } from './raf-loop.js';
import type { ScriptPresentation } from './script-presentation.js';

/** Everything the per-frame loop reads, assembled once by the mount phase. */
export interface FrameLoopDeps {
  readonly deps: GameViewDeps;
  readonly suspended?: () => boolean;
  readonly fpsLimit: FpsLimit;
  readonly onMatchEnd?: () => void;
  readonly isDisposed?: () => boolean;
  /** The session driver: it decides how many ticks this frame may run and holds the render alpha. */
  readonly driver: SessionDriver;
  readonly frameStats: FrameStats;
  readonly fogGates: FogGates;
  readonly toolPanel: GameToolPanelHandle;
  readonly minimap: MinimapHandle;
  readonly controls: UnitControls;
  readonly worldTooltip: WorldTooltip;
  readonly geometryDebug: GeometryDebugOverlay;
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  /** The erect-signpost band probe, live while signpost placement mode is active. */
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
  /** Memoized by snapshot identity, so it rebuilds per tick rather than per RAF. */
  readonly hudFor: (snap: WorldSnapshot) => HudLayout;
  /** The same per-tick aggregation behind {@link hudFor}, for its figures rather than its layout. */
  readonly hudModelFor: (snap: WorldSnapshot) => HudModel;
  /** Memoized by snapshot identity and fog-filtered. */
  readonly doorBadgesFor: (snap: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  /** One stand per site door; memoized by snapshot identity and fog-filtered. */
  readonly constructionSignsFor: (snap: WorldSnapshot) => ReturnType<typeof computeConstructionSigns>;
  /** Make-child and wedding bubbles; memoized by snapshot identity and fog-filtered. */
  readonly settlerBubblesFor: (snap: WorldSnapshot) => ReturnType<typeof computeSettlerBubbles>;
  /** Memoized by snapshot identity and the selection version, and fog-filtered. */
  readonly lifeHeartsFor: (snap: WorldSnapshot) => ReturnType<typeof computeLifeHearts>;
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  /** The civilization the local seat builds as; the placement ghost previews its bodies. */
  readonly placementTribe: number;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly soundDriver: ReturnType<typeof createSoundDriver> | null;
  /** The map script's display: its camera jitter for the frame, and its overlays after the draw. */
  readonly presentation: Pick<ScriptPresentation, 'jitter' | 'frame'> | null;
  readonly portraitVisible: () => boolean;
  readonly perf: PerfOverlayHandle;
  /** A relayed session's connection figures for the overlay; null in a local session. */
  readonly netReadout: () => NetReadout | null;
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
    worldTooltip,
    geometryDebug,
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
    placementTribe,
    soundDriver,
    presentation,
    perf,
    netReadout,
    pointer: pointerAt,
    syncViewport,
  } = loop;
  const { app, renderer, sim, cameraCtl } = deps;
  const localPlayer = deps.localPlayer ?? HUMAN_PLAYER;

  // Frame phases join the sim instrument's per-system slices in one `?debug=perf` / `?debug=trace` recording.
  const emitPhase = framePhaseEmitter(deps.params);
  let lastMs = performance.now();
  // Every step's events, not just the last tick's: a frame may advance several ticks and each step
  // clears the sim's buffer.
  const frameEvents: SimEvent[] = [];
  // The roster the music's mood reads our standing against; fixed for the session.
  const musicRoster = {
    localPlayer,
    rosterPlayers: deps.rosterPlayers ?? [],
    observer: deps.observer === true,
  };
  // Bound once and pulled by the sound driver only once a map has handed over its music, so a scene, a
  // muted session, or a map without music never pays the head-count's O(entities) tally.
  const musicStanding = (snap: WorldSnapshot): MusicStanding => ({
    population: hudModelFor(snap).population,
    stance: harshestStance(sim, musicRoster),
  });
  // Bound once, so a frame never mints a fresh pair of closures.
  const buildingOverlay = (buildingType: number, paper?: Paper) =>
    overlayFrame(buildingType, cameraCtl.camera(), app.screen.width, app.screen.height, paper);
  const signpostOverlay = () => signpostOverlayFrame(cameraCtl.camera(), app.screen.width, app.screen.height);
  // A frame may advance several ticks; `steps` is read back after the driver returns.
  let steps = 0;
  const collect = (): void => {
    steps++;
    recordDiagHash(sim);
    for (const ev of sim.events.current()) {
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
    const simMs = performance.now() - cpu0;
    cameraCtl.update(elapsed); // a no-op while the system menu holds the camera suspended
    // Idempotent: the sepia wash mirrors the pause flag every frame rather than on transitions, so a
    // pauser never has to know about the renderer.
    renderer.setPaused(driver.paused);
    // Before anything draws: the map entry's resource handover must release a first-worked node in the
    // same frame the pool starts drawing it.
    if (frameEvents.length > 0) deps.onEvents?.(frameEvents);
    if (deps.sharedClock && deps.confirmedMatchEnd?.() != null) loop.onMatchEnd?.();
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
    // An open briefing's map pictures, painted over the window during `renderer.update`.
    renderer.setMapViews(toolPanel.controller.mapViews());
    // Unfiltered: the notes are the seat's own affairs, and its own settler in the fog still starves.
    toolPanel.controller.presentMessages(snap, frameEvents, controls, renderAlpha);
    // Re-placed every frame; the unit dots redraw on a throttled cadence, the fog mask only on a fog
    // generation change.
    mountedMinimap.update(snap, fogView);
    // Decided here from the sim's placement probe and handed over as plain data: the renderer stays a
    // pure projection and never calls back into the sim.
    const cursor = placementCursor({
      placementType: toolPanel.controller.placementType(),
      placementPaper: toolPanel.controller.placementPaper(),
      signpostActive: controls.signpostPlacementActive(),
      buildingOverlay,
      signpostOverlay,
      tileAt: () => (pointer === null ? null : toolPanel.clientToTile(pointer.clientX, pointer.clientY)),
      canPlaceAt,
      canPlaceSignpostAt,
      localPlayer,
      placementTribe,
    });
    renderer.updatePlacementOverlay(cursor.overlay);
    renderer.updatePlacementGhost(cursor.ghost);
    // Before `renderer.update`, so the panel a rebuild bakes and the portrait inset painted over it both
    // show this frame's state.
    controls.tick(snap);
    // A world cutout centred on the selection, rendered into the portrait box during `renderer.update`.
    // Null when the selection has no portrait.
    renderer.setPortraitInset(loop.portraitVisible() ? controls.portrait() : null);
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
    // A script's earthquake shakes the drawn world alone; picking and the HUD keep the steady frame.
    const jitter = presentation?.jitter(nowMs) ?? null;
    const camera = cameraCtl.camera();
    const drawnCamera =
      jitter === null
        ? camera
        : { ...camera, offsetX: camera.offsetX + jitter.dx, offsetY: camera.offsetY + jitter.dy };
    renderer.update({
      snapshot: snap,
      camera: drawnCamera,
      tick: snap.tick,
      selection: controls.selectedIds(),
      alpha: renderAlpha,
      doorBadges,
      constructionSigns,
      settlerBubbles,
      lifeHearts,
      flagged: controls.flaggedFlagIds(),
      workAreas: controls.workAreaRings(),
    });
    worldTooltip.update(snap); // after controls, so the pointer-claim state is current
    presentation?.frame(snap, drawnCamera, nowMs);
    deps.onFrame?.(snap);
    if (soundDriver !== null) {
      soundDriver.update({
        events: presentEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        localPlayer, // life-event jingles ring only for our own entities, not enemies or wildlife
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
      droppedTicks: driver.droppedTicks,
      speed: driver.speed,
      paused: driver.paused,
      entities: snap.entities.length,
      cpuMs,
      simMs,
      snapMs,
      drawMs,
      ...renderer.stats(),
    });
    perf.update(frameStats.report(), netReadout());
  }
  return startRafLoop(frame, loop.fpsLimit);
}
