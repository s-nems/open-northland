import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import type { TerrainTextureSet } from '@open-northland/render';
import { buildSpriteScene, createWindowPixiApp, terrainMapToScene } from '@open-northland/render';
import type { SaveGame, Simulation } from '@open-northland/sim';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { matchIsContested } from '../game/match-participants.js';
import type { MissionBriefSource } from '../game/mission-brief.js';
import { applySessionRuleOverrides } from '../game/session-rules.js';
import { sceneSession } from '../game/session-url.js';
import { ownerPlayerOf } from '../game/snapshot.js';
import { messages, sceneCopy, scenePages, sceneStrings } from '../i18n/index.js';
import { presentationPack } from '../presentation/pack.js';
import { routeFor } from '../routes.js';
import {
  createSceneWorld,
  enableSceneScript,
  getScene,
  MAP_SCENES,
  mapSceneParams,
  restoreSceneSim,
  SCENES,
} from '../scenes/index.js';
import type { SceneDefinition } from '../scenes/types.js';
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
  const mapScene = MAP_SCENES.find((scene) => scene.id === sceneId);
  if (mapScene !== undefined) {
    const mapParams = mapSceneParams(mapScene, params);
    const renderMap = await routeFor(new URLSearchParams({ map: mapScene.mapId })).load();
    window.history.replaceState(null, '', `?${mapParams.toString()}`);
    await renderMap(canvas, mapParams);
    return;
  }
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
      [...SCENES, ...MAP_SCENES].map((s) => s.id),
    );
    return;
  }

  const session = sceneSession(params, sceneId, scene.seed);
  diag.info('boot', 'game start', { entry: 'scene', session });
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
      sim = restoreSceneSim(scene, stagedSave, worldOptions);
    } catch (err) {
      haltOnFailedRestore(err);
      return;
    }
  } else {
    sim = createSceneWorld(scene, worldOptions);
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
  if (stagedSave === null) applySessionRuleOverrides(sim, session.rules);
  await boot.begin('sprites');
  // Goods are global sandbox content, not scene-local data.
  const pack = presentationPack(params);
  const sheet =
    pack !== null
      ? await pack.spriteSheet(ir, sim.content.goods, params)
      : await resolveSpriteSheet(sim.content.goods);
  await boot.begin('terrain');
  let terrain: TerrainTextureSet;
  try {
    terrain =
      pack !== null ? pack.sceneTerrain(await pack.terrain(app.renderer, ir)) : await loadRealTerrain(ir);
  } catch (err) {
    if (!(err instanceof MissingTerrainError)) throw err;
    haltOnMissingContent(err);
    return;
  }

  const renderer = await createWorldRenderer(app, params, sheet);
  renderer.setTerrain(terrainGrid, terrain);

  const driver = new LockstepDriver({
    sim,
    transport: new LoopbackTransport(),
    speed: session.speed,
    paused: stagedSave !== null,
  });

  // Framed on the first tick's snapshot: a scene's settler spawns run as tick-1 commands, so the tick-0
  // centroid is empty and `cameraFor` would fall back to the tile origin. The browser view therefore
  // runs one tick more than the headless twin, and enables the script after it, so the load pass fires
  // on a tick the frame loop collects. Through the driver, so the session takes every tick's frame in
  // order. A restored world stands at its saved tick already, its script on.
  if (stagedSave === null) {
    driver.runTick();
    enableSceneScript(sim, scene);
  }
  const snapshot = sim.snapshot();
  const initialViewport = { width: app.screen.width, height: app.screen.height };
  const cameraSettings = readStoredSettings();
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(
      buildSpriteScene(snapshot),
      scene.initialZoom ?? 1,
      initialViewport.width,
      initialViewport.height,
    ),
    () => app.renderer.resolution,
    cameraSettings.keyBindings,
    cameraSettings,
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
    driver,
    cameraCtl,
    terrainGrid,
    rosterPlayers,
    mapText: (stringId) => sceneStrings(scene.id)?.[String(stringId)],
    ...terrainColourOption(terrain),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
    worldToken,
    missionBriefSource: sceneBriefSource(scene),
  });
  await boot.finish();
}

/** The mission sheet for a scene: its menu title and summary, the briefing pages its catalog entry
 *  authors as the stand-in for a map's briefing files, and the skirmish goal when it runs a match. */
function sceneBriefSource(scene: SceneDefinition): MissionBriefSource {
  const entry = sceneCopy(scene.id);
  const pages = scenePages(scene.id);
  return {
    page: (id) => {
      const text = pages?.[String(id)];
      return text === undefined ? null : [{ kind: 'text', style: 'body', text }];
    },
    fallback: {
      title: entry?.title ?? scene.id,
      ...(entry !== undefined ? { description: entry.summary } : {}),
    },
    skirmishGoal: matchIsContested(scene.participants ?? []) ? messages().hud.skirmishGoal : null,
  };
}
