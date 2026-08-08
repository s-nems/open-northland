import type { TerrainTextureSet } from '@open-northland/render';
import { buildSpriteScene, createWindowPixiApp, terrainMapToScene } from '@open-northland/render';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { applySessionRuleOverrides, sessionRuleOverrides } from '../game/session-rules.js';
import { ownerPlayerOf } from '../game/snapshot.js';
import { createSceneSim, getScene, SCENES } from '../scenes/index.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraFor, createCameraController } from '../view/camera/index.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { startGameView } from '../view/runtime/game-view.js';
import {
  createWorldRenderer,
  haltOnMissingContent,
  loadLocalizedRealContent,
  terrainColourOption,
} from '../view/runtime/world-bootstrap.js';
import { mountUnknownSceneOverlay } from '../view/scene-overlay.js';
import { readStoredSettings } from '../view/settings-store.js';

/**
 * The `?scene=<id>` entry renders a registered acceptance scene with the standard game HUD, over the
 * exact sim the headless acceptance test runs. Decoded terrain is required: without served content the
 * boot halts on the missing-content notice instead of drawing a flat world.
 */

export const SCENE_BOOT_PHASES = [
  'graphics',
  'content',
  'world',
  'sprites',
  'terrain',
  'hud',
] as const satisfies readonly BootPhase[];

export async function renderSceneMode(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const sceneId = params.get('scene') ?? '';
  const scene = getScene(sceneId);
  if (scene === undefined) {
    mountUnknownSceneOverlay(
      sceneId,
      SCENES.map((s) => s.id),
    );
    return;
  }

  diag.info('boot', 'game start', { entry: 'scene', sceneId, seed: scene.seed });
  bindDisplayMode(params);
  const boot = mountBootProgress(SCENE_BOOT_PHASES);
  await boot.begin('graphics');
  // Window-tracking backing store at the stored render scale times the device oversample: resizing
  // changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas, { resolutionScale: readStoredSettings().renderScale });
  const terrainGrid = terrainMapToScene(scene.terrain);
  await boot.begin('content');
  // Served real content makes the browser scene collide and place exactly like the live map view. The
  // headless twin never loads it, so copyrighted content stays out of tests.
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  const ir = await loadIr();
  // Empty on a bare checkout.
  const footprints = buildingFootprints(ir);
  await boot.begin('world');
  const sim = createSceneSim(scene, {
    goodNames,
    ...(footprints.size > 0 ? { footprints } : {}),
    ...(realContent !== null ? { content: realContent.content } : {}),
  });
  setDiagGameSession({
    entry: 'scene',
    worldId: sceneId,
    seed: scene.seed,
    sim,
    hashTrace: hashTraceFor(params),
  });
  // The session rule flags override the scene's own rules: a named divergence from the headless twin,
  // requested by the human watching it.
  applySessionRuleOverrides(sim, sessionRuleOverrides(params));
  await boot.begin('sprites');
  // Goods are global sandbox content, not scene-local data.
  const sheet = await resolveSpriteSheet(sim.content.goods);
  await boot.begin('terrain');
  let terrain: TerrainTextureSet;
  try {
    terrain = await loadRealTerrain(ir);
  } catch (err) {
    if (!(err instanceof MissingTerrainError)) throw err;
    haltOnMissingContent(err);
    return;
  }

  const renderer = createWorldRenderer(app, params, sheet);
  renderer.setTerrain(terrainGrid, terrain);

  // Framed on the first tick's snapshot: a scene's settler spawns run as tick-1 commands, so the tick-0
  // centroid is empty and `cameraFor` would fall back to the tile origin. The browser view therefore
  // runs one tick more than the headless twin.
  sim.step();
  const snapshot = sim.snapshot();
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(snapshot), scene.initialZoom ?? 1, app.screen.width, app.screen.height),
    () => app.renderer.resolution,
    readStoredSettings().keyBindings,
  );

  // Scenes have no authored map roster, so the diplomacy window's roster is read off the first tick's
  // owned spawns instead.
  const rosterPlayers = [...new Set(snapshot.entities.flatMap((e) => ownerPlayerOf(e) ?? []))].sort(
    (a, b) => a - b,
  );

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
    rosterPlayers,
    ...terrainColourOption(terrain),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
  });
  await boot.finish();
}
