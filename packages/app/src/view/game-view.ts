import {
  type ElevationField,
  type SceneTerrain,
  type WorldRenderer,
  buildHud,
  layoutHud,
  placeHud,
} from '@vinland/render';
import { FixedTimestep, type SimEvent, type Simulation, type WorldSnapshot } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { HARVEST_ATOMIC } from '../catalog/atomics.js';
import { createSoundDriver } from '../content/audio.js';
import { loadIr } from '../content/ir.js';
import { HUD_TRIBE, HUMAN_PLAYER } from '../game/rules.js';
import { DEFAULT_UI_SCALE } from '../hud/tool-panel/layout.js';
import type { CameraController } from './camera.js';
import { applyGameSpeed, menuEntriesFromContent, mountGameToolPanel, shiftHud } from './game-tool-panel.js';
import { enableAudioOnGesture } from './overlay.js';
import { floatParam, intParam } from './params.js';
import { mountPerfOverlay } from './perf-overlay.js';
import { createUnitControls } from './unit-controls.js';
import { professionsFromContent } from './unit-panel.js';

/**
 * The SHARED in-game runtime both playable entries (`?live` and `?scene=`) run on top of: the standard
 * HUD mounts (LEFT tool panel, RTS unit controls, perf overlay, positional sound) and the ONE
 * fixed-timestep RAF loop. The entries only assemble their world (terrain, sim, renderer, starting
 * camera) and hand it here — so the loop, the input wiring and the flag semantics (`?speed`, `?sound`,
 * `?uiscale`) cannot drift between the live sandbox and the acceptance scenes (they did: only the scene
 * loop measured `cpuMs`, and the placement-banner inset differed per copy).
 *
 * Per-frame order matters and is pinned here: sim steps (collecting EVERY step's events for audio) →
 * camera glide → ONE snapshot + ONE `buildHud` scan shared by the stocks HUD and the stats window →
 * tool-panel re-place BEFORE the renderer's render (screen-space meshes carry the canvas resolution) →
 * the retained `renderer.update` → unit-controls tick reusing the same snapshot → sound → perf readout.
 */
export interface GameViewDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  /** The retained world renderer, terrain already set. */
  readonly renderer: WorldRenderer;
  /** The live sim this view steps and draws. */
  readonly sim: Simulation;
  /** The interactive camera (the entry picks the starting frame). */
  readonly cameraCtl: CameraController;
  /** The terrain grid the sound driver's ambient beds sample. */
  readonly terrainGrid: SceneTerrain;
  /** Map bounds for placement/order clicks (a click outside is rejected, never clamped). */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field so clicks on lifted hills resolve to the tile drawn there. */
  readonly elevation?: ElevationField;
  /** Extra per-frame hook after the standard updates (e.g. the scene checklist overlay's tick). */
  readonly onFrame?: (snapshot: WorldSnapshot) => void;
}

/**
 * Mount the standard in-game HUD over the assembled world and start the fixed-timestep loop.
 * Resolves once the loop is running (the RAF chain keeps itself alive from there).
 */
export async function startGameView(deps: GameViewDeps): Promise<void> {
  const { app, canvas, params, renderer, sim, cameraCtl } = deps;

  // `?uiscale=` — parsed ONCE, shared by the tool panel and the action ring.
  const uiscale = intParam(params, 'uiscale', DEFAULT_UI_SCALE, 1);
  // Playback control. `?speed=` seeds the initial wall-clock multiplier (default ×1; e.g. `&speed=0.5`
  // for a calm, sub-1× pace the panel's discrete speed button can't reach). The tool panel's game-speed
  // button then drives it live (×1 → ×2 → ×3 → pause) without clobbering this seed at mount.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };

  // Original decoded sounds, played positionally: action SFX + terrain ambient (viewport-culled,
  // attenuated, panned) + non-spatial life-event jingles + settler voice chatter — a pure consumer of
  // the same snapshot + events render reads. Default-on; `?sound=off` opts out; a checkout without
  // `content/` (no sound bank) degrades to silence. Browser autoplay policy keeps audio suspended until
  // a user gesture; the enable-sound prompt persists until the context is confirmed running.
  const wantSound = params.get('sound') !== 'off';
  const soundDriver = wantSound ? createSoundDriver(await loadIr(), { chopAtomicId: HARVEST_ATOMIC }) : null;
  if (soundDriver !== null) enableAudioOnGesture(soundDriver);

  // On-canvas FPS + entity/drawn/pooled readout (bottom-left) so a human can judge whether the view
  // holds a frame rate and whether culling is biting. Real-GPU only: headless Chromium is software-GL.
  const perf = mountPerfOverlay();

  // The original LEFT tool panel — the standard game HUD. Its game-speed button drives `control`, the
  // building menu enqueues `placeBuilding` on a map click, and it claims its own clicks so the HUD
  // never falls through to world picking.
  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    enqueue: (command) => sim.enqueue(command),
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildings: menuEntriesFromContent(sim.content),
    tribe: HUD_TRIBE,
    owner: HUMAN_PLAYER,
    onSpeed: (spec) => applyGameSpeed(control, spec),
  });

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
    humanPlayer: HUMAN_PLAYER,
    professions: professionsFromContent(sim.content),
    enqueue: (command) => sim.enqueue(command),
    boundsOf: (ref) => renderer.entityBounds(ref), // pixel-accurate picking against the real sprite
    claimPointer: (x: number, y: number) => toolPanel.claimPointer(x, y),
  });

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
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Time the CPU work (sim + snapshot + render-build/submit + audio) so the overlay can split the
    // frame into CPU vs GPU/compositor — the split that tells whether a slow frame is our code or the GPU.
    const cpu0 = performance.now();
    frameEvents.length = 0;
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, collect);
    }
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // Build the tribe HUD read-view ONCE per frame (an O(entities) scan) and share it between the
    // always-on stocks panel and the tool panel's statistics window — no second scan.
    const hud = layoutHud(buildHud(snap, HUD_TRIBE));
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's render (they carry the
    // canvas resolution in their shader), and refresh an open stats window from this frame's HUD.
    toolPanel.controller.update(hud);
    // One retained update: reconcile the pooled sprites, draw the selection rings, refresh the pinned
    // HUD (shifted right to clear the left strip), render once. `app.screen` tracks window resizes.
    renderer.update(
      snap,
      cameraCtl.camera(),
      snap.tick,
      { placement: shiftHud(placeHud(hud, 'top-left', app.screen), toolPanel.hudShift) },
      controls.selectedIds(),
      renderAlpha,
    );
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    deps.onFrame?.(snap);
    if (soundDriver !== null) {
      soundDriver.update({
        events: frameEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        dtMs: elapsed,
      });
    }
    const cpuMs = performance.now() - cpu0;
    perf.update(elapsed, { entities: snap.entities.length, cpuMs, ...renderer.stats() });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
