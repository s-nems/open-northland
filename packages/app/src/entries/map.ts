import {
  type Camera,
  createWindowPixiApp,
  makeElevationField,
  type TerrainTextureSet,
} from '@open-northland/render';
import type { Entity, SaveGame, Simulation } from '@open-northland/sim';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { loadMapBriefing, loadMapMeta, loadMapScript, loadTerrainMap } from '../content/map-loader.js';
import { loadMinimapCellColours } from '../content/minimap-ground.js';
import { loadMapObjects } from '../content/objects.js';
import { loadOwnMapObjects } from '../content/own-assets/objects.js';
import { loadOwnSpriteSheet } from '../content/own-assets/sprite-sheet.js';
import { loadOwnTerrain } from '../content/own-assets/terrain.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { mapStartFocus } from '../game/map-start.js';
import { matchIsContested, matchParticipants, neverDiesSeats } from '../game/match-participants.js';
import { mapMissionBrief } from '../game/mission-brief.js';
import {
  colorOverridesParam,
  localPlayerParam,
  observerParam,
  playerColourMap,
  playerNameMap,
  playerTribe,
  readOnlyObserverParam,
} from '../game/player-session.js';
import { harvestablePlacementOrdinals, sandboxGoods } from '../game/sandbox/index.js';
import { sessionRuleOverrides } from '../game/session-rules.js';
import { terrainSceneFor } from '../game/world/index.js';
import { worldTribes } from '../game/world-tribes.js';
import { currentLocale, messages } from '../i18n/index.js';
import { assetSetFor } from '../view/asset-settings.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraCenteredOnTile, createCameraController } from '../view/camera/index.js';
import { mapZoomParam } from '../view/camera/map-zoom.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { aiSeatsParam, introParam } from '../view/params.js';
import { startGameView } from '../view/runtime/game-view.js';
import { takeStagedSave } from '../view/runtime/save-load/index.js';
import {
  createWorldRenderer,
  haltOnFailedRestore,
  haltOnMissingContent,
  loadLocalizedRealContent,
  terrainColourOption,
} from '../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../view/settings-store.js';
import { bindStaticLayer } from '../view/static-layer.js';
import { buildMapWorld, restoreMapWorld } from './map/world.js';

/**
 * The decoded-map viewer entry (`?map=<id>`): draws `content/maps/<id>.json` under the deterministic
 * sim. The backing store tracks the window at the stored render scale times the device oversample
 * while `app.screen` stays in CSS px, so resizing changes the visible field, never the scale. An
 * unknown or undecodable map id falls back to the synthetic grass strip; a checkout without served
 * `content/` halts at the terrain step.
 */

const WORLD_SEED = 7;

export const MAP_BOOT_PHASES = [
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'objects',
  'world',
  'minimap',
  'hud',
] as const satisfies readonly BootPhase[];

/** `?center=x,y` in integer tile coords; `null` when the value is absent or malformed. */
function centerTile(raw: string | null, width: number, height: number, zoom: number): Camera | null {
  if (raw === null) return null;
  const parts = raw.split(',').map((s) => Number.parseInt(s, 10));
  const [tx, ty] = parts;
  if (parts.length !== 2 || tx === undefined || ty === undefined || Number.isNaN(tx) || Number.isNaN(ty)) {
    return null;
  }
  return cameraCenteredOnTile(tx, ty, zoom, width, height);
}

export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  bindDisplayMode(params);
  const boot = mountBootProgress(MAP_BOOT_PHASES);
  await boot.begin('graphics');
  const mapId = params.get('map');
  const ownAssets = assetSetFor(params) === 'own';
  // Consumed before any other boot work: a staged save that fails from here on halts the boot rather
  // than silently starting a fresh world.
  let stagedSave: SaveGame | null;
  try {
    stagedSave = await takeStagedSave(mapId);
  } catch (err) {
    haltOnFailedRestore(err);
    return;
  }
  const app = await createWindowPixiApp(canvas, { resolutionScale: readStoredSettings().renderScale });
  await boot.begin('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  // A roster-less map keeps the defaults: seat 0, and colour = slot id.
  const [script, meta, briefing] = await Promise.all([
    mapId !== null ? loadMapScript(mapId) : null,
    mapId !== null ? loadMapMeta(mapId) : null,
    mapId !== null ? loadMapBriefing(mapId) : null,
  ]);
  const localPlayer = localPlayerParam(params);
  const playerColourOf = playerColourMap(script, colorOverridesParam(params));
  diag.info('boot', 'game start', {
    entry: 'map',
    mapId,
    decodedMap: loaded !== null,
    seed: WORLD_SEED,
    localPlayer,
    rosterSize: script?.players.length ?? 0,
  });
  const terrainGrid = terrainSceneFor(loaded ?? undefined);
  // Flat when the map carries no `lmhe` lane. The renderer builds its own field for the ground mesh;
  // this instance lifts the map objects at load and drives elevation-aware picking.
  const elevation = makeElevationField(loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0);
  await boot.begin('content');
  // Started before the content await rather than after it: the sheet cannot pick its tribes until the
  // IR lands, so serialising the two documents would push every atlas fetch back by one round trip.
  const irLoad = loadIr();
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  const ir = await irLoad;
  // Every civilization the map fields brings its own building and settler pages, so the sheet loads
  // exactly the seats' and the authored entities' tribes.
  const tribes = worldTribes(script, loaded?.entities, ir ?? {});
  await boot.begin('sprites');
  const sheet = ownAssets
    ? await loadOwnSpriteSheet(ir, params.get('ownHead'), realContent?.content.goods ?? sandboxGoods())
    : await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods(), tribes);
  await boot.begin('terrain');
  let terrain: TerrainTextureSet;
  try {
    terrain = ownAssets ? await loadOwnTerrain(app.renderer, ir) : await loadRealTerrain(ir);
  } catch (err) {
    if (!(err instanceof MissingTerrainError)) throw err;
    haltOnMissingContent(err);
    return;
  }
  const renderer = createWorldRenderer(app, params, sheet, playerColourOf);
  renderer.setTerrain(terrainGrid, terrain);
  // `embr` accented by elevation hillshade, shared with the placed landscape objects so an object
  // cannot disagree with the ground under it.
  const brightness = renderer.brightnessField();
  // A partial `content/`, such as a missing atlas PNG, degrades to bare ground instead of crashing.
  await boot.begin('objects');
  let staticObjects: Awaited<ReturnType<typeof loadMapObjects>> | undefined;
  if (loaded?.objects !== undefined && ir !== null) {
    try {
      const loadedObjects = ownAssets
        ? await loadOwnMapObjects(app.renderer, loaded.objects, ir, elevation)
        : await loadMapObjects(loaded.objects, ir, elevation, brightness);
      renderer.setMapObjects(loadedObjects.sprites);
      // Assigned only after the layer accepted the sprites: static refs against an empty layer would
      // leave every virgin node invisible until first touch.
      staticObjects = loadedObjects;
    } catch (err) {
      diag.warn('content', `map objects unavailable, bare ground fallback: ${String(err)}`);
    }
  }
  await boot.begin('world');
  const footprints = buildingFootprints(ir);
  // `?ai=<seat>[,…]` flags seats for the strategic AI player.
  const aiSeats = aiSeatsParam(params);
  // A read-only spectator drives no seat, so it takes no chest-window grants. The chest window edits
  // only `localPlayer`, so an overseer cannot switch an AI seat's grants back off.
  const controlled = readOnlyObserverParam(params) ? [] : [localPlayer];
  // A spectator of either kind plays no seat in the match; the overseer's grants still start on.
  const participants = matchParticipants({
    controlled: observerParam(params) ? [] : [localPlayer],
    aiSeats,
    neverDies: script === null ? [] : neverDiesSeats(script),
  });
  // The render layers read the raw map; the sim runs on the collision resolution of the same map.
  const worldOptions = {
    map: loaded,
    ir,
    content: {
      footprints,
      goodNames,
      ...(realContent !== null ? { content: realContent.content } : {}),
    },
    // Only the no-decodable-map fallback takes ownership from the session seat; a real map takes it
    // from map data.
    demoOwner: localPlayer,
  };
  let sim: Simulation;
  let harvestablePlacements: readonly (readonly [Entity, number])[] = [];
  if (stagedSave !== null) {
    try {
      const restoredWorld = restoreMapWorld(worldOptions, stagedSave);
      if (restoredWorld.contentRevisionDiffers) {
        diag.warn('boot', 'the save was made on another content revision; presentation may differ');
      }
      sim = restoredWorld.sim;
    } catch (err) {
      haltOnFailedRestore(err);
      return;
    }
  } else {
    const world = buildMapWorld({
      ...worldOptions,
      seed: WORLD_SEED,
      aiSeats,
      assistantSeats: [...controlled, ...aiSeats],
      matchParticipants: participants,
      diplomacy: script?.diplomacy ?? [],
      ...sessionRuleOverrides(params),
    });
    sim = world.sim;
    harvestablePlacements = world.harvestablePlacements;
  }
  setDiagGameSession({
    entry: 'map',
    worldId: mapId,
    seed: sim.seed,
    restoredAtTick: stagedSave !== null ? sim.tick : null,
    sim,
    hashTrace: hashTraceFor(params),
  });

  const staticLayer =
    staticObjects !== undefined && loaded?.objects !== undefined && ir !== null
      ? bindStaticLayer(
          renderer,
          { placements: loaded.objects.placements, byPlacement: staticObjects.byPlacement },
          stagedSave === null
            ? { kind: 'fresh', placementByEntity: harvestablePlacements }
            : { kind: 'restored', placements: harvestablePlacementOrdinals(sim.content, loaded.objects, ir) },
          sim.content,
          () => sim.snapshot(),
        )
      : null;

  const focus = mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height, localPlayer);
  const initialViewport = { width: app.screen.width, height: app.screen.height };
  const zoom = mapZoomParam(params);
  const initialCamera =
    centerTile(params.get('center'), initialViewport.width, initialViewport.height, zoom) ??
    cameraCenteredOnTile(focus.x, focus.y, zoom, initialViewport.width, initialViewport.height);
  const cameraCtl = createCameraController(
    canvas,
    initialCamera,
    () => app.renderer.resolution,
    readStoredSettings().keyBindings,
  );

  // Averaged from the real texture pages the map's ground lanes point at: the shipped `minimap.pcx` is
  // map-selection card art, not an overview raster. Null without lanes or textures.
  await boot.begin('minimap');
  const minimapCells = ownAssets ? null : await loadMinimapCellColours(terrainGrid, terrain);

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
    localPlayer,
    observer: observerParam(params),
    readOnly: readOnlyObserverParam(params),
    playerColourOf,
    seatTribeOf: (player) => playerTribe(script, player),
    tribes,
    seatNameOf: playerNameMap(script),
    rosterPlayers: script?.players.map((p) => p.player) ?? [],
    ...terrainColourOption(terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    ...(staticLayer !== null ? { onEvents: staticLayer } : {}),
    worldToken: mapId,
    restored: stagedSave !== null,
    introAtStart: stagedSave === null && introParam(params),
    musicType: meta?.musicType ?? null,
    missionBrief: mapMissionBrief({
      script,
      briefing,
      lang: currentLocale(),
      name: meta?.name,
      description: meta?.description,
      skirmishGoal: messages().hud.skirmishGoal,
      matchDeclared: matchIsContested(participants) && participants.includes(localPlayer),
    }),
  });
  await boot.finish();
}
