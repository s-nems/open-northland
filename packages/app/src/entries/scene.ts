import {
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  placeHud,
  terrainMapToScene,
} from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import { SCENES, createSceneSim, getScene } from '../scenes/index.js';
import { cameraFor, createCameraController } from '../view/camera.js';
import { mountPerfOverlay } from '../view/perf-overlay.js';
import { mountSceneOverlay, mountUnknownSceneOverlay } from '../view/scene-overlay.js';
import { floatParam } from './params.js';

/**
 * The `?scene=<id>` entry: render a registered **acceptance scene** live, with the checklist overlay,
 * so a human can watch the mechanic and sign off. The SAME `?atlas`/`?terrain`/`?zoom`/`?speed` flags
 * the live slice honours work here (e.g. `?scene=all-buildings&zoom=2` to magnify one building). Real
 * decoded graphics are the DEFAULT now (`resolveSpriteSheet`) — no `?atlas=real` needed; `?atlas=none`
 * opts out to placeholder geometry. The sim is the exact one the headless acceptance test runs —
 * determinism guarantees the human watches what the test proved (see docs/SCENES.md).
 */

/** The acceptance scenes are single-tribe viking (tribe 1); draw that tribe's HUD panel each frame. */
const HUD_TRIBE = 1;

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
  // The scene's own goods key the per-good carry looks (content-relative ids — the scene knows them).
  const sheet = await resolveSpriteSheet(params, scene.content.goods);
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;
  const zoom = floatParam(params, 'zoom', scene.initialZoom ?? 1);

  // Retained renderer: mesh the terrain ONCE, then reuse a pooled sprite graph each frame (no per-frame
  // object churn), so a big scene renders + deep-zoom-outs without exhausting the GPU.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // FPS / entity / drawn / pooled readout (bottom-left) so a human can judge render performance at scale
  // — the instrument the stress scene is watched with (and harmless on the small scenes).
  const perf = mountPerfOverlay();

  // Mutable playback control the overlay buttons drive. `sim` is reassigned on restart (a fresh
  // deterministic run), so the loop reads it through the closure each frame.
  const control = { paused: false, stepOnce: false, speed: floatParam(params, 'speed', 0.5) };
  let sim = createSceneSim(scene);

  const overlay = mountSceneOverlay(scene, {
    initialSpeed: control.speed,
    onTogglePause: () => {
      control.paused = !control.paused;
      return control.paused;
    },
    onStep: () => {
      control.stepOnce = true;
    },
    onRestart: () => {
      sim = createSceneSim(scene);
      timestep = new FixedTimestep(); // fresh accumulator so the replay starts on a clean tick boundary
    },
    onSpeed: (v) => {
      control.speed = v;
    },
  });

  // Interactive camera over the scene: `?zoom` is the starting frame, then the human pans (middle-mouse
  // drag / arrow keys) and zooms (scroll wheel). Survives an overlay restart (the sim is rebuilt, the
  // camera isn't), so the framing the human set up persists across replays.
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height),
  );

  let timestep = new FixedTimestep();
  let lastMs = performance.now();

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    if (control.stepOnce) {
      sim.step(); // manual single-step (paused): advance one tick irrespective of the accumulator
      control.stepOnce = false;
    } else if (!control.paused) {
      timestep.advance(elapsed * control.speed, () => sim.step());
    }
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // `app.screen` is the LIVE renderer size (it tracks window resizes), so the HUD stays pinned.
    renderer.update(snap, cameraCtl.camera(), snap.tick, {
      placement: placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', app.screen),
    });
    overlay.update(snap.tick);
    perf.update(elapsed, { entities: snap.entities.length, ...renderer.stats() });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(`Vinland scene "${scene.id}" up. Watch the overlay checklist, then say if it looks OK.`);
}
