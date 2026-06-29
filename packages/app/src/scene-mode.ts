import {
  buildHud,
  buildScene,
  createPixiApp,
  layoutHud,
  placeHud,
  renderHud,
  renderScene,
  terrainMapToScene,
} from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { cameraFor, floatParam } from './camera.js';
import { resolveSpriteSheet } from './real-sprites.js';
import { loadRealTerrain } from './real-terrain.js';
import { mountSceneOverlay, mountUnknownSceneOverlay } from './scene-overlay.js';
import { SCENES, createSceneSim, getScene } from './scenes/index.js';

/**
 * The `?scene=<id>` entry: render a registered **acceptance scene** live, with the checklist overlay,
 * so a human can watch the mechanic and sign off. The SAME `?atlas`/`?terrain`/`?zoom`/`?speed` flags
 * the live slice honours work here (e.g. `?scene=gather-resource&atlas=real&zoom=2` for decoded sprites
 * magnified). The sim is the exact one the headless acceptance test runs — determinism guarantees the
 * human watches what the test proved (see docs/SCENES.md).
 */

const CANVAS_W = 960;
const CANVAS_H = 540;
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

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  const terrainGrid = terrainMapToScene(scene.terrain);
  const sheet = await resolveSpriteSheet(params);
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;
  const zoom = floatParam(params, 'zoom', 1);
  const screen = { width: CANVAS_W, height: CANVAS_H };

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
    },
    onSpeed: (v) => {
      control.speed = v;
    },
  });

  const timestep = new FixedTimestep();
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
    const snap = sim.snapshot();
    const sc = buildScene(snap, terrainGrid);
    renderScene(app, sc, cameraFor(sc, zoom, CANVAS_W, CANVAS_H), sheet, snap.tick, terrain);
    renderHud(app, placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', screen));
    overlay.update(snap.tick);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(`Vinland scene "${scene.id}" up. Watch the overlay checklist, then say if it looks OK.`);
}
