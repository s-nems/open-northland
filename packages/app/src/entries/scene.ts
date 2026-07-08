import {
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  placeHud,
  terrainMapToScene,
} from '@vinland/render';
import { FixedTimestep, type SimEvent } from '@vinland/sim';
import { createSoundDriver } from '../content/audio.js';
import { loadIr } from '../content/ir.js';
import { HARVEST_ATOMIC } from '../content/settler-gfx.js';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import { HUD_TRIBE, HUMAN_PLAYER } from '../game/rules.js';
import { DEFAULT_UI_SCALE } from '../hud/tool-panel-layout.js';
import { SCENES, createSceneSim, getScene } from '../scenes/index.js';
import { cameraFor, createCameraController } from '../view/camera.js';
import {
  applyGameSpeed,
  menuEntriesFromContent,
  mountGameToolPanel,
  shiftHud,
} from '../view/game-tool-panel.js';
import { enableAudioOnGesture } from '../view/overlay.js';
import { mountPerfOverlay } from '../view/perf-overlay.js';
import { mountSceneOverlay, mountUnknownSceneOverlay } from '../view/scene-overlay.js';
import { createUnitControls } from '../view/unit-controls.js';
import { professionsFromContent } from '../view/unit-panel.js';
import { floatParam, intParam } from './params.js';

/**
 * The `?scene=<id>` entry: render a registered **acceptance scene** live, with the checklist overlay,
 * so a human can watch the mechanic and sign off. The SAME `?atlas`/`?terrain`/`?zoom`/`?speed` flags
 * the live slice honours work here (e.g. `?scene=sandbox&zoom=2` to magnify one building). Real
 * decoded graphics are the DEFAULT now (`resolveSpriteSheet`) — no `?atlas=real` needed; `?atlas=none`
 * opts out to placeholder geometry. The sim is the exact one the headless acceptance test runs —
 * determinism guarantees the human watches what the test proved (see docs/SCENES.md).
 */

export async function renderSceneMode(
  canvas: HTMLCanvasElement,
  sceneId: string,
  params: URLSearchParams,
): Promise<void> {
  const scene = getScene(sceneId);
  if (scene === undefined) {
    mountUnknownSceneOverlay(
      sceneId,
      SCENES.map((s) => s.id),
    );
    return;
  }

  // Window-sized 1:1 backing store: resizing the browser changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas);
  const terrainGrid = terrainMapToScene(scene.terrain);
  const sim = createSceneSim(scene);
  // Goods are global sandbox content now, not scene-local data.
  const sheet = await resolveSpriteSheet(params, sim.content.goods);
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;
  const zoom = floatParam(params, 'zoom', scene.initialZoom ?? 1);

  // Retained renderer: mesh the terrain ONCE, then reuse a pooled sprite graph each frame (no per-frame
  // object churn), so a big scene renders + deep-zoom-outs without exhausting the GPU.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // FPS / entity / drawn / pooled readout (bottom-left) so a human can judge render performance at scale
  // — the instrument the stress scene is watched with (and harmless on the small scenes).
  const perf = mountPerfOverlay();

  // Playback control the tool-panel speed button drives (the sole speed/pause GUI now — the old scene-overlay
  // playback buttons were removed). `?speed=` seeds the initial multiplier (default ×1); the panel's speed
  // button drives it live (×1 → ×2 → ×3 → pause) without clobbering the seed at mount.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };
  // The acceptance overlay is now purely the sign-off checklist + a debug tick (no playback controls).
  const overlay = mountSceneOverlay(scene);

  // Interactive camera over the scene: `?zoom` is the starting frame, then the human pans (middle-mouse
  // drag / arrow keys) and zooms (scroll wheel).
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height),
  );

  // Original decoded sounds over the scene (default-on; `?sound=off` opts out): positional action SFX +
  // terrain ambient + non-spatial jingles + on-screen settler voice chatter — so a crowd scene murmurs.
  // Suspended until a user gesture (autoplay policy); silent without `content/`. The prompt persists until
  // the context is confirmed running, so the gesture can't be missed while the scene loads. See @vinland/audio.
  const wantSound = params.get('sound') !== 'off';
  const soundDriver = wantSound ? createSoundDriver(await loadIr(), { chopAtomicId: HARVEST_ATOMIC }) : null;
  if (soundDriver !== null) enableAudioOnGesture(soundDriver);

  // The original LEFT tool panel — part of the standard game HUD, mounted over EVERY scene (not a per-scene
  // opt-in) through the shared helper the live sandbox also uses. It claims its own clicks (`claimPointer`)
  // so a press on the HUD never reaches world picking, drives the loop's speed through `onSpeed`, and
  // enqueues `placeBuilding` for a menu selection dropped on a tile.
  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    params,
    camera: () => cameraCtl.camera(),
    enqueue: (command) => sim.enqueue(command),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
    buildings: menuEntriesFromContent(sim.content),
    tribe: HUD_TRIBE,
    owner: HUMAN_PLAYER,
    onSpeed: (spec) => applyGameSpeed(control, spec),
  });

  // RTS unit control over the scene: left-click / drag-box to select the human's units, right-click to
  // send them, Space for the unit panel. Harmless on scenes with no owned units (nothing is pickable).
  const controls = await createUnitControls({
    app,
    canvas,
    uiscale: intParam(params, 'uiscale', DEFAULT_UI_SCALE, 1),
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
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

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Time the CPU work (sim + snapshot + render-build/submit + audio) so the overlay can split the
    // frame into CPU vs GPU/compositor — the split that tells whether a slow frame is our code or the GPU.
    const cpu0 = performance.now();
    // Accumulate events from every step this frame (each step clears the buffer) for the audio layer.
    const frameEvents: SimEvent[] = [];
    const collect = (): void => {
      sim.step();
      frameEvents.push(...sim.events.current());
    };
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, collect);
    }
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // Build the tribe HUD read-view ONCE per frame (an O(entities) scan) and share it between the always-on
    // stocks panel and the tool panel's statistics window — so the stats window adds no second scan.
    const hud = layoutHud(buildHud(snap, HUD_TRIBE));
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's `app.render()` (they carry the
    // canvas resolution in their shader), and refresh an open statistics window from this frame's HUD.
    toolPanel.controller.update(hud);
    // `app.screen` is the LIVE renderer size (it tracks window resizes), so the HUD stays pinned. The
    // always-on stocks HUD is shifted right to clear the left strip.
    renderer.update(
      snap,
      cameraCtl.camera(),
      snap.tick,
      { placement: shiftHud(placeHud(hud, 'top-left', app.screen), toolPanel.hudShift) },
      controls.selectedIds(),
      renderAlpha,
    );
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    overlay.update(snap.tick);
    if (soundDriver !== null) {
      soundDriver.update({
        events: frameEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: terrainGrid,
        dtMs: elapsed,
      });
    }
    const cpuMs = performance.now() - cpu0;
    perf.update(elapsed, { entities: snap.entities.length, cpuMs, ...renderer.stats() });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(`Vinland scene "${scene.id}" up. Watch the overlay checklist, then say if it looks OK.`);
}
