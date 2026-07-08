import { WorldRenderer, buildSpriteScene, createWindowPixiApp, terrainMapToScene } from '@vinland/render';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import { SCENES, createSceneSim, getScene } from '../scenes/index.js';
import { cameraFor, createCameraController } from '../view/camera.js';
import { startGameView } from '../view/game-view.js';
import { floatParam } from '../view/params.js';
import { mountSceneOverlay, mountUnknownSceneOverlay } from '../view/scene-overlay.js';

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

  // Window-tracking, device-resolution backing store: resizing changes the visible field, never the scale.
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

  // The acceptance overlay is purely the sign-off checklist + a debug tick (no playback controls — the
  // tool panel's speed button is the sole speed/pause GUI).
  const overlay = mountSceneOverlay(scene);

  // Interactive camera over the scene: `?zoom` is the starting frame, then the human pans (middle-mouse
  // drag / arrow keys) and zooms (scroll wheel). Frame on the FIRST TICK's snapshot, not the initial
  // one: a scene's build() enqueues spawn COMMANDS that run on tick 1, so the tick-0 snapshot is empty
  // and `cameraFor`'s settler-centroid framing fell back to the tile origin (an off-centre first frame
  // on every scene). One step is imperceptible and deterministic — the headless twin runs the same sim.
  sim.step();
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height),
    app.renderer.resolution,
  );

  // The shared in-game runtime (view/game-view.ts): the standard HUD mounts — tool panel, unit
  // controls, perf overlay, positional sound — and the ONE fixed-timestep RAF loop, identical to the
  // `?map=` entry's; the checklist overlay's tick rides the per-frame hook.
  await startGameView({
    app,
    canvas,
    params,
    renderer,
    sim,
    cameraCtl,
    terrainGrid,
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
    onFrame: (snap) => overlay.update(snap.tick),
  });

  console.log(`Vinland scene "${scene.id}" up. Watch the overlay checklist, then say if it looks OK.`);
}
