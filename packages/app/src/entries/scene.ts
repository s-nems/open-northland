import {
  buildSpriteScene,
  createWindowPixiApp,
  terrainMapToScene,
  WorldRenderer,
} from '@open-northland/render';
import { goodLocaleParam, loadGoodNameMap } from '../content/good-names.js';
import { buildingFootprints, loadIr } from '../content/ir.js';
import { loadRuntimeRealContent, logRealContentGaps } from '../content/real-content.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { fogModeParam } from '../game/fog.js';
import { createSceneSim, getScene, SCENES } from '../scenes/index.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraFor, createCameraController } from '../view/camera.js';
import { startGameView } from '../view/runtime/game-view.js';
import { mountUnknownSceneOverlay } from '../view/scene-overlay.js';

declare global {
  interface Window {
    /** The `?scene=` entry's console-debug seam — see the assignment in {@link renderSceneMode}. */
    __opennorthland?: {
      readonly sim: import('@open-northland/sim').Simulation;
      readonly renderer: WorldRenderer;
      readonly sheet: import('@open-northland/render').SpriteSheet | undefined;
      readonly cameraCtl: import('../view/camera.js').CameraController;
    };
  }
}

/**
 * The `?scene=<id>` entry renders a registered acceptance scene with the standard game HUD so a human
 * can watch the mechanic. Normal play always loads decoded sprites and terrain when available, with
 * hand-authored fallbacks for a bare checkout. The sim is the exact one the headless acceptance test runs.
 */

/** The boot steps this entry runs, in order — the loading card's step list. */
export const SCENE_BOOT_PHASES = [
  'graphics',
  'content',
  'world',
  'sprites',
  'terrain',
  'hud',
] as const satisfies readonly BootPhase[];

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

  diag.info('boot', 'game start', { entry: 'scene', sceneId, seed: scene.seed });
  // Content fetches, atlas builds and terrain meshing run for seconds before the first frame; the card
  // covers that stretch and comes off once the world is drawn.
  const boot = mountBootProgress(SCENE_BOOT_PHASES);
  await boot.begin('graphics');
  // Window-tracking, device-resolution backing store: resizing changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas);
  const terrainGrid = terrainMapToScene(scene.terrain);
  await boot.begin('content');
  // Localized good names follow the app-wide `?lang=` value so the HUD reads from one language setting.
  // Authored names keep a bare checkout localized.
  const goodNames = await loadGoodNameMap(goodLocaleParam(params));
  // Real extracted building footprints (like the `?map=` entry): browser scenes collide/door/place
  // exactly like the live map view instead of the hand-authored class squares. Empty on a bare checkout
  // (no ir.json) — the approximations then stand, and the headless twin never loads them at all.
  const footprints = buildingFootprints(await loadIr());
  // Run the browser scene on the merged real content when it is served (localized good names, real
  // footprints/recipes); a bare checkout falls back to sandbox content, and the headless twin never
  // loads it — so copyrighted content stays out of tests. Its gaps are logged once.
  const realContent = await loadRuntimeRealContent(goodNames);
  if (realContent !== null) logRealContentGaps(realContent);
  await boot.begin('world');
  const sim = createSceneSim(
    scene,
    {
      goodNames,
      ...(footprints.size > 0 ? { buildingFootprints: footprints } : {}),
    },
    realContent?.content,
  );
  setDiagGameSession({
    entry: 'scene',
    worldId: sceneId,
    seed: scene.seed,
    sim,
    hashTrace: hashTraceFor(params),
  });
  // `?fog=off|reveal|recon` overrides the scene's own fog mode (enqueued after the scene's
  // setFogMode — FIFO, later write wins). A named divergence from the headless twin, like `?speed=`:
  // the human explicitly asked to watch the mechanic under a different fog rule.
  const fogOverride = fogModeParam(params);
  if (fogOverride !== null) sim.enqueue({ kind: 'setFogMode', mode: fogOverride });
  await boot.begin('sprites');
  // Goods are global sandbox content, not scene-local data.
  const sheet = await resolveSpriteSheet(sim.content.goods);
  // The meshing below is the rest of this step, as in the `?map=` entry.
  await boot.begin('terrain');
  const terrain = await loadRealTerrain();

  // Retained renderer: mesh the terrain once, then reuse a pooled sprite graph each frame (no per-frame
  // object churn), so a big scene renders + deep-zoom-outs without exhausting the GPU.
  const renderer = new WorldRenderer(app, {
    sheet,
    viewSmoothing: true,
    postFx: params.get('postfx') !== 'off',
  });
  renderer.setTerrain(terrainGrid, terrain);

  // Interactive camera over the scene: the scene supplies its starting frame, then the human pans and
  // zooms. Frame on the first tick's snapshot, not the initial one: a scene's settler spawns run as
  // tick-1 commands (direct-placed resources/flags exist at tick 0), so the tick-0 settler centroid is
  // empty and `cameraFor` falls back to the tile origin (an off-centre first frame). The extra step is
  // deterministic: the browser view runs `runTicks + 1` ticks vs the headless twin — harmless, the checks
  // run headless.
  sim.step();
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), scene.initialZoom ?? 1, app.screen.width, app.screen.height),
    app.renderer.resolution,
  );

  // The shared in-game runtime (view/runtime/game-view.ts): the standard HUD mounts — tool panel, unit
  // controls, perf overlay, positional sound — and the one fixed-timestep RAF loop, identical to the
  // `?map=` entry's.
  await boot.begin('hud');
  await startGameView({
    app,
    canvas,
    params,
    renderer,
    sheet,
    sim,
    cameraCtl,
    terrainGrid,
    // Minimap ground colours from the real terrain set's per-type debug colours (absent → flat tints).
    ...(terrain !== undefined ? { terrainColour: (t: number) => terrain.cellFor(t)?.fallbackColour } : {}),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
  });
  await boot.finish();

  // Dev/debug seam: the live instances, reachable from the browser console (`__opennorthland.sim` …) so a
  // human or an automated probe can inspect the running scene without rebuilding it. Read-only: a
  // console mutation bypasses the command pipeline and silently voids determinism (state hashes and
  // golden comparability no longer mean anything for that session).
  window.__opennorthland = { sim, renderer, sheet, cameraCtl };
}
