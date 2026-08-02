import {
  type Camera,
  createWindowPixiApp,
  makeElevationField,
  type TerrainTextureSet,
} from '@open-northland/render';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
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
  readOnlyObserverParam,
} from '../game/player-session.js';
import { sandboxGoods } from '../game/sandbox/index.js';
import { sessionRuleOverrides } from '../game/session-rules.js';
import { loadMapScript, loadTerrainMap } from '../slice/map-loader.js';
import { sliceTerrain } from '../slice/vertical-slice.js';
import { type BootPhase, mountBootProgress } from '../view/boot-progress.js';
import { cameraCenteredOnTile, createCameraController } from '../view/camera/index.js';
import { bindHarvestableHandover } from '../view/harvestable-handover.js';
import { aiSeatsParam } from '../view/params.js';
import { startGameView } from '../view/runtime/game-view.js';
import {
  createWorldRenderer,
  haltOnMissingContent,
  loadLocalizedRealContent,
  terrainColourOption,
} from '../view/runtime/world-bootstrap.js';
import { buildMapWorld } from './map/world.js';

/**
 * The decoded-map viewer entry (`?map=<id>`): draws an actual decoded `content/maps/<id>.json` grid - the
 * 1:1 per-triangle ground + placed landscape objects (trees/stones/mines + animated waves) - driven by the
 * deterministic vertical-slice sim on the fixed-timestep loop, drawn every frame so `npm run dev` is
 * watchable. The default landing is the menu ({@link import('./menu.js')}), whose "Mapy" section links here
 * per decoded map.
 *
 * The backing store tracks the window at device resolution (`createWindowPixiApp`; `app.screen` stays in
 * CSS px), so resizing the browser changes the visible field, never the scale - read live dimensions
 * from `app.screen`. An unknown or undecodable map id falls back to the synthetic grass strip; a
 * checkout without served `content/` halts at the terrain step with the missing-content notice instead
 * of booting a flat world.
 */

/** The slice sim's deterministic seed. */
const SLICE_SEED = 7;

/** The boot steps this entry runs, in order - the loading card's step list. */
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

/**
 * Parse `?center=x,y` (integer tile coords) into a camera centred on that tile (via
 * {@link cameraCenteredOnTile}), or `null` for an absent/malformed value so the caller falls back to the
 * default settler-centroid framing.
 */
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
  // A real decoded map spends seconds on content fetches, atlas builds, terrain meshing and object
  // placement before its first frame; the card covers that stretch and comes off once the world is drawn.
  const boot = mountBootProgress(MAP_BOOT_PHASES);
  await boot.begin('graphics');
  const app = await createWindowPixiApp(canvas);
  await boot.begin('map');
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  // The player session the menu's roster panel carried over: the controlled seat (`?player=`) and
  // each slot's team colour - the map script's authored colours under the menu's `?colors=`
  // overrides. A roster-less map keeps the defaults (seat 0, colour = slot id).
  const script = mapId !== null ? await loadMapScript(mapId) : null;
  const localPlayer = localPlayerParam(params);
  const playerColourOf = playerColourMap(script, colorOverridesParam(params));
  diag.info('boot', 'game start', {
    entry: 'map',
    mapId,
    decodedMap: loaded !== null,
    seed: SLICE_SEED,
    localPlayer,
    rosterPlayers: script?.players.length ?? 0,
  });
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // The decoded map's terrain-height field (flat when the map carries no `lmhe` lane). The renderer
  // builds its own from the terrain grid for the ground mesh + entity lift; this shared instance lifts
  // the map objects at load and drives elevation-aware picking (worldToTile) below.
  const elevation = makeElevationField(loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0);
  // The shared decoded content: the `?lang=` good-name map and the merged real content it localizes
  // (null on a bare checkout → the sandbox goods below). Its gaps are logged once.
  await boot.begin('content');
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  // The goods icon atlas is built from the real goods when they are served.
  await boot.begin('sprites');
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods());
  // The IR indexes the terrain set, so it is the first half of the terrain step.
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
  // The composed shading field the ground mesh just drew with (`embr` accented by elevation hillshade)
  // - the ONE instance that also shades the placed landscape objects below (mines/stones/grass track
  // the lane in the original; trees stay full-bright - see objects.ts), so an object can't disagree
  // with the ground under it.
  const brightness = renderer.brightnessField();
  // A decoded map's placed landscape objects (trees/stones/mine decals + the animated wave fx that
  // are the original's water surface) - resolved through the landscapeGfx IR + the /bobs atlases.
  // The catch keeps a partial content/ (e.g. a missing atlas PNG) a degradation, not an app crash.
  // Harvestables draw here too: a virgin node is a built-once static quad (zero per-frame cost - a far
  // zoom-out shows thousands at once), handed to the live sim pool the first time it is worked (below).
  await boot.begin('objects');
  let staticObjects: Awaited<ReturnType<typeof loadMapObjects>> | undefined;
  if (loaded?.objects !== undefined && ir !== null) {
    try {
      const loadedObjects = await loadMapObjects(loaded.objects, ir, elevation, brightness);
      renderer.setMapObjects(loadedObjects.sprites);
      // Assigned only after the layer accepted the sprites: were setMapObjects to throw, registering
      // static refs against an empty layer would make every virgin node invisible until first touch.
      staticObjects = loadedObjects;
    } catch (err) {
      diag.warn('content', `map objects unavailable, bare ground fallback: ${String(err)}`);
    }
  }
  await boot.begin('world');
  // Extracted building footprints from the served IR give buildings real collision, so `placeBuilding`
  // is blocked where a house doesn't fit and the build overlay greys those tiles.
  const footprints = buildingFootprints(ir);
  // `?ai=<seat>[,…]` flags seats for the strategic AI player - emitted by the menu roster's AI
  // toggles, or hand-written as the watch-the-AI-play verification hook (see aiSeatsParam; a seat
  // without a built headquarters stays inert by the AI's own rule).
  const aiSeats = aiSeatsParam(params);
  // The controlled seat and every AI seat start with their chest-window grants ON (user decisions
  // 2026-07-24 / 2026-07-27; scenes stay neutral fixtures, like the needs toggle). A seat nobody
  // drives stays bare - a rostered idle/hidden slot, a scripted soldier camp, or the seat a READ-ONLY
  // spectator merely watches (`localPlayerParam` answers HUMAN_PLAYER for both pseudo-seats, so the
  // commanding overseer keeps it). Asymmetry to live with: the chest window edits only `localPlayer`,
  // so an overseer cannot switch an AI seat's grants back off.
  const controlled = readOnlyObserverParam(params) ? [] : [localPlayer];
  // The render layers keep reading `loaded` (raw typeIds drive the per-triangle fallback + the ambience
  // beds); the sim runs on the collision resolution of the same map.
  const { sim, harvestablePlacements } = buildMapWorld({
    seed: SLICE_SEED,
    map: loaded,
    ir,
    content: {
      footprints,
      goodNames,
      ...(realContent !== null ? { content: realContent.content } : {}),
    },
    aiSeats,
    assistantSeats: [...controlled, ...aiSeats],
    ...sessionRuleOverrides(params),
    // Only the no-decodable-map fallback takes ownership from the session seat, so ?player= changes its
    // initial sim state - deterministic per URL. Real maps take ownership from map data instead.
    demoOwner: localPlayer,
  });
  setDiagGameSession({
    entry: 'map',
    worldId: mapId,
    seed: SLICE_SEED,
    sim,
    hashTrace: hashTraceFor(params),
  });

  // First-touch handover: a worked resource leaves the built-once static layer and the sprite pool
  // draws it on. Without the static sprites (a partial `content/`) every node is pool-drawn already.
  const harvestableHandover =
    staticObjects !== undefined
      ? bindHarvestableHandover(renderer, harvestablePlacements, staticObjects.byPlacement)
      : null;

  // Interactive camera: the start frame centres on the player's start ({@link mapStartFocus}: the human
  // player's headquarters/settler cluster, else the map centre) so entering a map lands on the action, not
  // the top-left corner - from there a human pans (middle-mouse drag / arrow keys) and zooms (scroll
  // wheel). The HUD is drawn outside the camera layer below, so it stays pinned while the world moves.
  // `?center=x,y` overrides the start frame to centre a given tile (a decoded map's feature - a bridge or
  // coastline the start framing would never land on), degrading to the start framing when malformed.
  const focus = mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height, localPlayer);
  const initialCamera =
    centerTile(params.get('center'), app.screen.width, app.screen.height) ??
    cameraCenteredOnTile(focus.x, focus.y, 1, app.screen.width, app.screen.height);
  const cameraCtl = createCameraController(canvas, initialCamera, app.renderer.resolution);

  // The minimap's per-cell ground colours, averaged from the real texture pages the map's baked
  // ground lanes point at (the shipped `minimap.pcx` is the map-selection card - sometimes a painted
  // scene, e.g. magiczny las - so the in-game minimap is rendered from map data, like the original's
  // dynamic overview window). Null without lanes/textures → the typeId raster fallback.
  await boot.begin('minimap');
  const minimapCells = await loadMinimapCellColours(terrainGrid, terrain);

  // The shared in-game runtime (view/runtime/game-view.ts): the standard HUD mounts - tool panel, unit
  // controls, perf overlay, positional sound - and the one fixed-timestep RAF loop, identical to the
  // `?scene=` entry's.
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
    ...terrainColourOption(terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    ...(harvestableHandover !== null ? { onEvents: harvestableHandover } : {}),
  });
  await boot.finish();
}
