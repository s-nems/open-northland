import {
  type Camera,
  createWindowPixiApp,
  makeElevationField,
  type TerrainTextureSet,
} from '@open-northland/render';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { loadMapScript, loadTerrainMap } from '../content/map-loader.js';
import { loadMinimapCellColours } from '../content/minimap-ground.js';
import { loadMapObjects } from '../content/objects.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { mapStartFocus } from '../game/map-start.js';
import {
  colorOverridesParam,
  localPlayerParam,
  observerParam,
  playerColourMap,
  playerNameMap,
  readOnlyObserverParam,
} from '../game/player-session.js';
import { sandboxGoods } from '../game/sandbox/index.js';
import { sessionRuleOverrides } from '../game/session-rules.js';
import { terrainSceneFor } from '../game/world/index.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraCenteredOnTile, createCameraController } from '../view/camera/index.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { bindHarvestableHandover } from '../view/harvestable-handover.js';
import { aiSeatsParam } from '../view/params.js';
import { startGameView } from '../view/runtime/game-view.js';
import {
  createWorldRenderer,
  haltOnMissingContent,
  loadLocalizedRealContent,
  terrainColourOption,
} from '../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../view/settings-store.js';
import { buildMapWorld } from './map/world.js';

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
function centerTile(raw: string | null, width: number, height: number): Camera | null {
  if (raw === null) return null;
  const parts = raw.split(',').map((s) => Number.parseInt(s, 10));
  const [tx, ty] = parts;
  if (parts.length !== 2 || tx === undefined || ty === undefined || Number.isNaN(tx) || Number.isNaN(ty)) {
    return null;
  }
  return cameraCenteredOnTile(tx, ty, 1, width, height);
}

export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  bindDisplayMode(params);
  const boot = mountBootProgress(MAP_BOOT_PHASES);
  await boot.begin('graphics');
  const app = await createWindowPixiApp(canvas, { resolutionScale: readStoredSettings().renderScale });
  await boot.begin('map');
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  // A roster-less map keeps the defaults: seat 0, and colour = slot id.
  const script = mapId !== null ? await loadMapScript(mapId) : null;
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
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  await boot.begin('sprites');
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods());
  await boot.begin('terrain');
  const ir = await loadIr();
  let terrain: TerrainTextureSet;
  try {
    terrain = await loadRealTerrain(ir);
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
      const loadedObjects = await loadMapObjects(loaded.objects, ir, elevation, brightness);
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
  // The render layers read the raw map; the sim runs on the collision resolution of the same map.
  const { sim, harvestablePlacements } = buildMapWorld({
    seed: WORLD_SEED,
    map: loaded,
    ir,
    content: {
      footprints,
      goodNames,
      ...(realContent !== null ? { content: realContent.content } : {}),
    },
    aiSeats,
    assistantSeats: [...controlled, ...aiSeats],
    diplomacy: script?.diplomacy ?? [],
    ...sessionRuleOverrides(params),
    // Only the no-decodable-map fallback takes ownership from the session seat; a real map takes it
    // from map data.
    demoOwner: localPlayer,
  });
  setDiagGameSession({
    entry: 'map',
    worldId: mapId,
    seed: WORLD_SEED,
    sim,
    hashTrace: hashTraceFor(params),
  });

  // A worked resource leaves the built-once static layer for the sprite pool. Without static sprites
  // every node is pool-drawn already.
  const harvestableHandover =
    staticObjects !== undefined
      ? bindHarvestableHandover(renderer, harvestablePlacements, staticObjects.byPlacement)
      : null;

  const focus = mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height, localPlayer);
  const initialCamera =
    centerTile(params.get('center'), app.screen.width, app.screen.height) ??
    cameraCenteredOnTile(focus.x, focus.y, 1, app.screen.width, app.screen.height);
  const cameraCtl = createCameraController(
    canvas,
    initialCamera,
    () => app.renderer.resolution,
    readStoredSettings().keyBindings,
  );

  // Averaged from the real texture pages the map's ground lanes point at: the shipped `minimap.pcx` is
  // map-selection card art, not an overview raster. Null without lanes or textures.
  await boot.begin('minimap');
  const minimapCells = await loadMinimapCellColours(terrainGrid, terrain);

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
    localPlayer,
    observer: observerParam(params),
    readOnly: readOnlyObserverParam(params),
    playerColourOf,
    seatNameOf: playerNameMap(script),
    rosterPlayers: script?.players.map((p) => p.player) ?? [],
    ...terrainColourOption(terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    ...(harvestableHandover !== null ? { onEvents: harvestableHandover } : {}),
  });
  await boot.finish();
}
