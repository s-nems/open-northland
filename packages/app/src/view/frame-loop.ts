import type { layoutHud } from '@open-northland/render';
import { FixedTimestep, FOG_STATE, type SimEvent, systems, type WorldSnapshot } from '@open-northland/sim';
import type { createSoundDriver } from '../content/audio.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import type { MinimapHandle } from '../hud/minimap/index.js';
import type { computeDoorBadges } from './door-badges.js';
import type { FogGates } from './fog-gates.js';
import type { GameToolPanelHandle } from './game-tool-panel.js';
import type { GameViewDeps } from './game-view.js';
import type { GeometryDebugOverlay } from './geometry-debug-items.js';
import type { GroundPileTooltip } from './ground-pile-tooltip.js';
import type { PerfOverlayHandle } from './perf-overlay.js';
import type { makeOverlayFrameSource } from './placement-overlay.js';
import type { UnitControls } from './unit-controls.js';

/**
 * Everything the per-frame loop reads — assembled once by {@link import('./game-view.js').startGameView}
 * during its mount phase and handed here. This context is the explicit contract between the one-time HUD
 * wiring and the steady-state RAF loop: the setup owns construction, the loop owns the pinned per-frame
 * order (see {@link startFrameLoop}).
 */
export interface FrameLoopDeps {
  readonly deps: GameViewDeps;
  /** The live playback control the tool panel's speed button + the `P` pause key drive. */
  readonly control: { paused: boolean; speed: number };
  readonly fogGates: FogGates;
  readonly toolPanel: GameToolPanelHandle;
  readonly minimap: MinimapHandle;
  readonly controls: UnitControls;
  readonly pileTooltip: GroundPileTooltip;
  readonly geometryDebug: GeometryDebugOverlay;
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  /** The tribe HUD read-view, memoized by snapshot identity (rebuilt per tick, not per RAF). */
  readonly hudFor: (snap: WorldSnapshot) => ReturnType<typeof layoutHud>;
  /** The door-badge projection, memoized + fog-filtered, by snapshot identity. */
  readonly doorBadgesFor: (snap: WorldSnapshot) => ReturnType<typeof computeDoorBadges>;
  /** The ONE live placement rule the click gate and the cursor ghost share. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  readonly soundDriver: ReturnType<typeof createSoundDriver> | null;
  readonly perf: PerfOverlayHandle;
  /** The current build-ghost cursor position (client coords; null when the pointer left the canvas). */
  readonly pointer: () => { clientX: number; clientY: number } | null;
}

/**
 * Start the fixed-timestep RAF loop. Per-frame order matters and is pinned here: sim steps (collecting
 * EVERY step's events for audio) → camera glide → ONE snapshot + ONE `buildHud` scan feeding the tool
 * panel's stats window → tool-panel re-place BEFORE the renderer's render (screen-space meshes carry the
 * canvas resolution) → the retained `renderer.update` → unit-controls tick reusing the same snapshot →
 * sound → perf readout. The RAF chain keeps itself alive once kicked off.
 */
export function startFrameLoop(loop: FrameLoopDeps): void {
  const {
    deps,
    control,
    fogGates,
    toolPanel,
    minimap: mountedMinimap,
    controls,
    pileTooltip,
    geometryDebug,
    overlayFrame,
    hudFor,
    doorBadgesFor,
    canPlaceAt,
    soundDriver,
    perf,
    pointer: pointerAt,
  } = loop;
  const { app, renderer, sim, cameraCtl } = deps;

  const timestep = new FixedTimestep();
  let lastMs = performance.now();
  // The fixed-timestep interpolation fraction the renderer lerps entity anchors by — refreshed each
  // un-paused frame from `advance` (a pause freezes it, so units hold their drawn spot mid-leg).
  let renderAlpha = 1;
  // Events from EVERY sim step this frame (not just the last tick): the fixed-timestep loop may advance
  // several ticks between rendered frames, and each step clears the buffer — so an audio trigger on an
  // intermediate tick would otherwise be lost. One persistent scratch array, cleared per frame.
  const frameEvents: SimEvent[] = [];
  const collect = (): void => {
    sim.step();
    for (const ev of sim.events.current()) frameEvents.push(ev);
  };

  function frame(nowMs: number): void {
    const pointer = pointerAt();
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Time the CPU work (sim + snapshot + render-build/submit + audio) so the overlay can split the
    // frame into CPU vs GPU/compositor — the split that tells whether a slow frame is our code or the GPU.
    const cpu0 = performance.now();
    frameEvents.length = 0;
    // Count the sim steps this frame — the fixed-timestep loop may run several to catch wall-clock up
    // (or zero when paused/idle); a persistently high count is the sim falling behind, the overlay shows it.
    let steps = 0;
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, () => {
        collect();
        steps++;
      });
    }
    // CPU split #1: the sim step(s). The overlay breaks the frame's CPU into sim/snap/draw so a slow
    // scene can be blamed on the right layer (render/AGENTS.md: measure before blaming the GPU).
    const simMs = performance.now() - cpu0;
    cameraCtl.update(elapsed);
    // The sepia pause wash mirrors the loop's pause flag EVERY frame (an idempotent visibility set), so
    // any future pauser — auto-pause on blur, a modal — browns the map without knowing about the renderer.
    renderer.setPaused(control.paused);
    // Hand the frame's events to the entry BEFORE anything draws — the map entry's static→dynamic
    // resource handover must release a first-worked node in the same frame the pool starts drawing it.
    if (frameEvents.length > 0) deps.onEvents?.(frameEvents);
    const snap0 = performance.now();
    const snap = sim.snapshot();
    // CPU split #2: the snapshot clone (the plain-cloned world the renderer + HUD read).
    const snapMs = performance.now() - snap0;
    // The HUMAN player's fog-of-war view for this frame (null = fog off — every layer reverts to the
    // pre-fog behaviour). One read shared by the renderer (wash + sprite/tree cull), the minimap mask
    // and the presentation event filter below, so no consumer can disagree about a cell.
    const fogView = sim.fogView(HUMAN_PLAYER);
    fogGates.setFrame(fogView); // refresh the stable predicates' slot before anything below consults them
    renderer.updateFog(fogView);
    // PRESENTATION events only (blood/bones + positional audio): an event at ground the player does
    // not currently SEE is dropped — a fight in the fog must neither splatter visible blood nor ring
    // audible clangs. Event `at` coords are half-cell nodes (`cellOfNode` owns the node→cell rule).
    // The map entry's `onEvents` handover deliberately keeps the UNFILTERED list (sim bookkeeping,
    // not presentation — a fogged tree felled by an enemy must still hand its static sprite over).
    const presentEvents =
      fogView === null
        ? frameEvents
        : frameEvents.filter((ev) => {
            if (!('at' in ev)) return true;
            const { cx, cy } = systems.cellOfNode(ev.at.x, ev.at.y);
            return fogView.stateAt(cx, cy) === FOG_STATE.VISIBLE;
          });
    // The tribe HUD read-view (an O(entities) scan) for the tool panel's statistics window — memoized by
    // snapshot identity above, so it rebuilds once per TICK, not per RAF. The old ALWAYS-ON stocks panel
    // that also read this was removed — that data now shows only when the player opens the stats window.
    const hud = hudFor(snap);
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's render (they carry the
    // canvas resolution in their shader), and refresh an open stats window from this frame's HUD.
    toolPanel.controller.update(hud);
    // Minimap re-place + view rectangle every frame; its unit dots redraw only when the tick moved,
    // its fog mask only when the fog generation moved.
    mountedMinimap.update(snap, fogView);
    // Build mode: dim the ground the held building can't anchor on and float its translucent ghost at
    // the hovered tile (hidden over rejecting ground — the original's vanishing house cursor). Both
    // are computed here, in the app, from the sim's placement probe and handed to the renderer as
    // plain data — the renderer stays a pure projection and never calls back into the sim.
    const placeType = toolPanel.controller.placementType();
    renderer.updatePlacementOverlay(
      placeType === null
        ? null
        : overlayFrame(placeType, cameraCtl.camera(), app.screen.width, app.screen.height),
    );
    // (No HUD-claim check: the HUD draws over the world layer, so the ghost can't cover it.)
    const hovered =
      placeType !== null && pointer !== null
        ? toolPanel.clientToTile(pointer.clientX, pointer.clientY)
        : null;
    renderer.updatePlacementGhost(
      placeType !== null && hovered !== null && canPlaceAt(placeType, hovered.col, hovered.row)
        ? { col: hovered.col, row: hovered.row, buildingType: placeType }
        : null,
    );
    // Feed the details panel's live "observation window" — a world cutout centred on the selected entity,
    // rendered into the portrait box INSIDE renderer.update (a second world render, before the main stage
    // render). Null when the selection has no portrait; the inset fits the entity's bounds to the box.
    renderer.setPortraitInset(controls.portrait());
    // Grey construction-site plots: every placed foundation's footprint cells, washed on the ground so a
    // fresh site reads as a marked-out plac budowy before the scaffold rises. Computed sim-side (footprint
    // + positions) and handed over as plain cells — the renderer stays a pure projection. Cheap: the sim
    // scans only the small under-construction set, and the layer skips the redraw when the set is unchanged.
    // Fog gate: the plot layer draws ABOVE the wash, so an enemy foundation in the black would paint
    // through it — keep only the cells (half-cell nodes) the player currently sees.
    const plots = sim.constructionPlots();
    renderer.updateConstructionPlots(
      fogView === null
        ? plots
        : plots
            .map((p) => ({
              cells: p.cells.filter((c) => {
                const { cx, cy } = systems.cellOfNode(c.col, c.row);
                return fogView.stateAt(cx, cy) === FOG_STATE.VISIBLE;
              }),
            }))
            .filter((p) => p.cells.length > 0),
    );
    geometryDebug.update(snap);
    // One retained update: reconcile the pooled sprites, draw the selection rings + door badges + the
    // selected gatherers' work-flag highlight, render once. `app.screen` tracks window resizes. No HUD frame
    // is passed — the always-on stocks panel is gone; the debug tick lives in the top overlay and the
    // population/jobs/stocks in the stats window.
    const doorBadges = doorBadgesFor(snap); // memoized by snapshot identity — rebuilt per tick, not per RAF
    // Combat ground marks (blood on hits, bones on deaths) from this frame's SEEN events — ingested
    // before the renderer's update draws them, decaying against the sim tick so a pause/screenshot
    // reproduces. Fog-filtered: a fight in unexplored/grey ground leaves no visible marks.
    renderer.ingestCombatEffects(presentEvents, snap.tick);
    renderer.update({
      snapshot: snap,
      camera: cameraCtl.camera(),
      tick: snap.tick,
      selection: controls.selectedIds(),
      alpha: renderAlpha,
      doorBadges,
      flagged: controls.flaggedFlagIds(),
    });
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    pileTooltip.update(snap); // name-on-hover for the good pile under the cursor (after controls: claim state is current)
    deps.onFrame?.(snap);
    if (soundDriver !== null) {
      soundDriver.update({
        events: presentEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        dtMs: elapsed,
        localPlayer: HUMAN_PLAYER, // the death stinger rings only for OUR own units, not enemies/wildlife
        // Voice chatter reads on-screen settlers straight off the snapshot, so it needs its own fog
        // gate — a hidden enemy must not natter from empty black (positional SFX are already covered
        // by the presentEvents filter above).
        visibleTile: fogGates.visibleTile,
      });
    }
    const cpuMs = performance.now() - cpu0;
    // CPU split #3: the render build + submit and the rest of the frame's app work (camera, controls,
    // sound) — the remainder after sim + snapshot, so the three sum to cpuMs.
    const drawMs = cpuMs - simMs - snapMs;
    perf.update(elapsed, {
      tick: snap.tick,
      steps,
      speed: control.speed,
      paused: control.paused,
      entities: snap.entities.length,
      cpuMs,
      simMs,
      snapMs,
      drawMs,
      ...renderer.stats(),
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
