import type { TerrainTextureSet } from '@open-northland/render';
import { buildSpriteScene, createWindowPixiApp, terrainMapToScene } from '@open-northland/render';
import type { SaveGame, Simulation } from '@open-northland/sim';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { ownSceneTerrain } from '../content/own-assets/scene-terrain.js';
import { loadOwnSpriteSheet } from '../content/own-assets/sprite-sheet.js';
import { loadOwnTerrain } from '../content/own-assets/terrain.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { matchIsContested } from '../game/match-participants.js';
import type { MissionBrief } from '../game/mission-brief.js';
import { applySessionRuleOverrides, sessionRuleOverrides } from '../game/session-rules.js';
import { ownerPlayerOf } from '../game/snapshot.js';
import { messages, sceneCopy } from '../i18n/index.js';
import { createSceneSim, getScene, restoreSceneSim, SCENES } from '../scenes/index.js';
import type { SceneDefinition } from '../scenes/types.js';
import { assetSetFor } from '../view/asset-settings.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraFor, createCameraController } from '../view/camera/index.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { startGameView } from '../view/runtime/game-view.js';
import { takeStagedSave } from '../view/runtime/save-load/index.js';
import { SCENE_TOKEN_PREFIX } from '../view/runtime/save-load/world-names.js';
import {
  createWorldRenderer,
  haltOnFailedRestore,
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
  const worldToken = `${SCENE_TOKEN_PREFIX}${sceneId}`;
  // Claimed before the scene lookup, and so before any world assembly: the staged bytes are one-shot,
  // and an entry that returns without claiming them leaves them for an unrelated boot to restore. A
  // staged save that fails from here on halts the boot rather than silently starting a fresh world.
  let stagedSave: SaveGame | null;
  try {
    stagedSave = await takeStagedSave(worldToken);
  } catch (err) {
    haltOnFailedRestore(err);
    return;
  }
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
  const worldOptions = {
    goodNames,
    ...(footprints.size > 0 ? { footprints } : {}),
    ...(realContent !== null ? { content: realContent.content } : {}),
  };
  let sim: Simulation;
  if (stagedSave !== null) {
    try {
      const restored = restoreSceneSim(scene, stagedSave, worldOptions);
      if (restored.contentRevisionDiffers) {
        diag.warn('boot', 'the save was made on another content revision; presentation may differ');
      }
      sim = restored.sim;
    } catch (err) {
      haltOnFailedRestore(err);
      return;
    }
  } else {
    sim = createSceneSim(scene, worldOptions);
  }
  setDiagGameSession({
    entry: 'scene',
    worldId: sceneId,
    seed: sim.seed,
    restoredAtTick: stagedSave !== null ? sim.tick : null,
    sim,
    hashTrace: hashTraceFor(params),
  });
  // The session rule flags override the scene's own rules: a named divergence from the headless twin,
  // requested by the human watching it. A restored world keeps the saved rules instead.
  if (stagedSave === null) applySessionRuleOverrides(sim, sessionRuleOverrides(params));
  await boot.begin('sprites');
  // Goods are global sandbox content, not scene-local data.
  const ownAssets = assetSetFor(params) === 'own';
  const sheet = ownAssets
    ? await loadOwnSpriteSheet(ir, params.get('ownHead'), sim.content.goods)
    : await resolveSpriteSheet(sim.content.goods);
  await boot.begin('terrain');
  let terrain: TerrainTextureSet;
  try {
    terrain = ownAssets ? ownSceneTerrain(await loadOwnTerrain(app.renderer, ir)) : await loadRealTerrain(ir);
  } catch (err) {
    if (!(err instanceof MissingTerrainError)) throw err;
    haltOnMissingContent(err);
    return;
  }

  const renderer = createWorldRenderer(app, params, sheet);
  renderer.setTerrain(terrainGrid, terrain);

  // Framed on the first tick's snapshot: a scene's settler spawns run as tick-1 commands, so the tick-0
  // centroid is empty and `cameraFor` would fall back to the tile origin. The browser view therefore
  // runs one tick more than the headless twin. A restored world stands at its saved tick already.
  if (stagedSave === null) sim.step();
  const snapshot = sim.snapshot();
  const initialViewport = { width: app.screen.width, height: app.screen.height };
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(
      buildSpriteScene(snapshot),
      scene.initialZoom ?? 1,
      initialViewport.width,
      initialViewport.height,
    ),
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
    initialViewport,
    renderer,
    sheet,
    sim,
    cameraCtl,
    terrainGrid,
    rosterPlayers,
    ...terrainColourOption(terrain),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
    worldToken,
    restored: stagedSave !== null,
    missionBrief: sceneMissionBrief(scene),
  });
  await boot.finish();
}

/** The mission sheet for a scene: its menu title and summary, and the skirmish goal when it runs a match. */
function sceneMissionBrief(scene: SceneDefinition): MissionBrief {
  const entry = sceneCopy(scene.id);
  return {
    title: entry?.title ?? scene.id,
    blocks: entry === undefined ? [] : [{ kind: 'text', style: 'body', text: entry.summary }],
    goals: matchIsContested(scene.participants ?? [])
      ? [{ text: messages().hud.skirmishGoal, rule: 'skirmish', done: false }]
      : [],
  };
}
