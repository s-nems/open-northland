import {
  CALIBRATED_HALF_H,
  CALIBRATED_HALF_W,
  type Camera,
  WorldRenderer,
  buildSpriteScene,
  createWindowPixiApp,
  makeBrightnessField,
  makeElevationField,
  setTilePitch,
} from '@vinland/render';
import { halfCellMapFromCells } from '@vinland/sim';
import { buildCollisionTerrain } from '../content/collision.js';
import { buildingFootprints, loadIr } from '../content/ir.js';
import { loadMinimapCellColours } from '../content/minimap-ground.js';
import { loadMapObjects } from '../content/objects.js';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { mapResourceObjectNames, sandboxGoods, spawnMapResources } from '../game/sandbox/index.js';
import { loadTerrainMap } from '../slice/map-loader.js';
import { runAuthoredSlice, runSlice, sliceTerrain } from '../slice/vertical-slice.js';
import { cameraCenteredOnTile, cameraFor, createCameraController } from '../view/camera.js';
import { startGameView } from '../view/game-view.js';
import { floatParam } from '../view/params.js';

/**
 * The default full tile-diamond width in px (`2 × CALIBRATED_HALF_W`) when `?pitch=` is absent — the
 * cell width MEASURED from the original game (see iso.ts / source basis "projection").
 */
const DEFAULT_TILE_WIDTH = 2 * CALIBRATED_HALF_W;

/**
 * The decoded-map viewer entry (`?map=<id>`): draws an actual decoded `content/maps/<id>.json` grid — the
 * 1:1 per-triangle ground + placed landscape objects (trees/stones/mines + animated waves) — driven by the
 * deterministic vertical-slice sim on the fixed-timestep loop, drawn every frame so `npm run dev` is
 * watchable. The default landing is the MENU ({@link import('./menu.js')}), whose "Mapy" section links here
 * per decoded map.
 *
 * The backing store tracks the window at device resolution (`createWindowPixiApp`; `app.screen` stays in
 * CSS px), so resizing the browser changes the visible field, never the scale — read live dimensions
 * from `app.screen`. When the map is
 * absent or unloadable (the maps are gitignored) it falls back to the synthetic grass strip so a bare
 * checkout still boots.
 */

/** The slice sim's deterministic seed. */
const SLICE_SEED = 7;

/**
 * Parse `?center=x,y` (integer tile coords) into a camera centred on that tile (via
 * {@link cameraCenteredOnTile}), or `null` for an absent/malformed value so the caller falls back to the
 * default settler-centroid framing.
 */
function centerTile(raw: string | null, zoom: number, width: number, height: number): Camera | null {
  if (raw === null) return null;
  const parts = raw.split(',').map((s) => Number.parseInt(s, 10));
  const [tx, ty] = parts;
  if (parts.length !== 2 || tx === undefined || ty === undefined || Number.isNaN(tx) || Number.isNaN(ty)) {
    return null;
  }
  return cameraCenteredOnTile(tx, ty, zoom, width, height);
}

export async function renderMap(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const app = await createWindowPixiApp(canvas);
  // `?pitch=<fullTileWidth>` — the live verification knob for the master sprite-vs-terrain scale (the
  // whole look; a human dials it, an agent can't self-judge pixels — see `iso.ts`/source basis).
  // Applied BEFORE any projection (scene build, terrain mesh, object lattice) so every layer picks it up.
  // The height follows the MEASURED ratio (CALIBRATED_HALF_H/CALIBRATED_HALF_W ≈ 1.12 — the original's
  // cells are near-square on screen, not iso 2:1); `?pitchy=<cellDiamondHeight>` overrides it separately.
  // NOTE `?pitchy` is the full DIAMOND height (2× the row step): the measured 68×38 metric is
  // `?pitch=68&pitchy=76` — passing the row step (38) squashes the world 2× (the aliasing failure the
  // recalibration fixed).
  const tileWidth = floatParam(params, 'pitch', DEFAULT_TILE_WIDTH);
  const halfW = tileWidth / 2;
  const cellDown = floatParam(params, 'pitchy', 2 * halfW * (CALIBRATED_HALF_H / CALIBRATED_HALF_W));
  setTilePitch(halfW, cellDown / 2);
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // The decoded map's terrain-height field (flat when the map carries no `lmhe` lane). The renderer
  // builds its own from the terrain grid for the ground mesh + entity lift; this shared instance lifts
  // the map objects at load and drives elevation-aware picking (worldToTile) below.
  const elevation = makeElevationField(loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0);
  // The decoded map's baked `embr` shading field (neutral when the map lacks the lane). The renderer
  // builds its own for the ground mesh; this shared instance shades the placed landscape objects at
  // load (mines/stones/grass track the lane in the original; trees stay full-bright — see objects.ts).
  const brightness = makeBrightnessField(loaded?.brightness, loaded?.width ?? 0, loaded?.height ?? 0);
  // Real decoded graphics are the DEFAULT (see resolveSpriteSheet): absent or `?atlas=real` draws the real
  // atlases (gitignored content over the /bobs server), degrading to synthetic markers when content/ is
  // missing. `?atlas=synthetic` forces the free markers; `?atlas=none` draws placeholder geometry. Shared
  // with the `?scene=` entry.
  const sheet = await resolveSpriteSheet(params, sandboxGoods());
  // Real ground textures + map objects are the DEFAULT (like the sprite atlases), each behind its
  // own opt-out (`?terrain=off` → flat tint, `?objects=off` → bare ground) and each degrading
  // gracefully when content/ is absent — the shared multi-MB ir.json is fetched once for everything
  // (the memoized loadIr; the sprite-sheet resolution above already paid it).
  let ir = null;
  const wantTerrain = params.get('terrain') !== 'off';
  const wantObjects = loaded?.objects !== undefined && params.get('objects') !== 'off';
  const wantEntities = loaded?.entities !== undefined;
  if (wantTerrain || wantObjects || wantEntities) {
    ir = await loadIr();
    if (ir === null) console.warn('content/ir.json unavailable, placeholder graphics fallback');
  }
  let terrain: Awaited<ReturnType<typeof loadRealTerrain>> | undefined;
  if (wantTerrain && ir !== null) {
    try {
      terrain = await loadRealTerrain(ir);
    } catch (err) {
      console.warn(`real terrain unavailable, flat tint fallback: ${String(err)}`);
    }
  }
  // Retained renderer: mesh the terrain ONCE, reuse a pooled sprite graph each frame (no per-frame
  // object churn) so large maps + deep zoom-out stay within the GPU budget.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // A decoded map's placed landscape objects (trees/stones/mine decals + the animated wave fx that
  // ARE the original's water surface) — resolved through the landscapeGfx IR + the /bobs atlases.
  // The catch keeps a partial content/ (e.g. a missing atlas PNG) a degradation, not an app crash.
  // Harvestable objects (trees/ore/stone) are spawned as sim resources below and drawn by the sim, so the
  // static decor layer SKIPS them — otherwise each would draw twice (static decor + sim sprite) and a felled
  // tree's static sprite would linger over an empty tile. Every other object stays static decor.
  const resourceObjectNames = ir !== null ? mapResourceObjectNames(ir) : undefined;
  if (wantObjects && loaded?.objects !== undefined && ir !== null) {
    try {
      renderer.setMapObjects(
        await loadMapObjects(loaded.objects, ir, elevation, brightness, resourceObjectNames),
      );
    } catch (err) {
      console.warn(`map objects unavailable, bare ground fallback: ${String(err)}`);
    }
  }
  // `?zoom=N` magnifies + re-centres on the sprites (the same knob the shot uses) so a decoded bob is
  // big enough to inspect in the live view; absent, scale 1.
  const zoom = floatParam(params, 'zoom', 1);
  // The slice sim, kept live and stepped one tick per fixed interval below. A map that carries
  // AUTHORED entities (map.cif StaticObjects) places those buildings/settlers at their authored
  // cells; else the demo slice — on a loaded map's walkable cells, or the synthetic strip. The
  // demo's units are owned by the human player so they can be selected + ordered.
  // Extracted building footprints from the served IR give buildings real collision, so `placeBuilding`
  // is blocked where a house doesn't fit and the build overlay greys those tiles (empty without content/).
  const footprints = buildingFootprints(ir);
  // The SIM navigates + validates placement against the COLLISION grid — the map's raw landscape lane
  // resolved into the semantic walk/build classes from the real ground + object data (water, trees,
  // stones, ore deposits block; see content/collision.ts). The RENDER layers keep reading `loaded`
  // (raw typeIds drive the flat-tint fallback + the ambience beds). Without the IR the grid degrades
  // to all-open ground rather than mis-classing the raw lane against the synthetic table.
  const simMap =
    loaded !== null && ir !== null
      ? buildCollisionTerrain(loaded, ir)
      : loaded !== null
        ? halfCellMapFromCells(loaded)
        : null;
  const sim =
    (wantEntities && loaded?.entities !== undefined && ir !== null && simMap !== null
      ? runAuthoredSlice(SLICE_SEED, 0, simMap, loaded.entities, ir, footprints)
      : null) ?? runSlice(SLICE_SEED, 0, simMap ?? undefined, HUMAN_PLAYER, footprints);

  // Spawn the map's own trees/ore/stone as real harvestable `Resource` sim nodes (plan step 6), so a
  // gatherer can actually work them — before this they were render-only decor and every gatherer idled.
  // Pre-tick-0 direct spawn into the freshly-built sim, in the map's placement order (deterministic ids);
  // these are the objects the static decor layer skipped above, now drawn + depleted by the sim.
  if (loaded?.objects !== undefined && ir !== null) {
    const spawned = spawnMapResources(sim, loaded.objects, ir);
    console.log(
      `Map resources: spawned ${spawned} harvestable nodes from ${loaded.objects.types.length} object types.`,
    );
  }

  // Interactive camera: `?zoom` (+ the settler-centroid framing) is the STARTING frame; from there a
  // human pans (middle-mouse drag / arrow keys) and zooms (scroll wheel). The HUD is drawn outside the
  // camera layer below, so it stays pinned while the world moves.
  // `?center=x,y` overrides the starting frame to centre a given tile (a decoded map's feature — a
  // bridge, a coastline — the settler-centroid framing would never land on); a human inspection knob
  // like `?zoom`, degrading to the default framing on a malformed value.
  const initialCamera =
    centerTile(params.get('center'), zoom, app.screen.width, app.screen.height) ??
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height);
  const cameraCtl = createCameraController(canvas, initialCamera, app.renderer.resolution);

  // The minimap's per-cell ground colours, averaged from the REAL texture pages the map's baked
  // ground lanes point at (the shipped `minimap.pcx` is the map-SELECTION card — sometimes a painted
  // scene, e.g. magiczny las — so the in-game minimap is rendered from map data, like the original's
  // dynamic overview window). Null without lanes/textures → the typeId raster fallback.
  const minimapCells = await loadMinimapCellColours(terrainGrid, terrain);

  // The shared in-game runtime (view/game-view.ts): the standard HUD mounts — tool panel, unit
  // controls, perf overlay, positional sound — and the ONE fixed-timestep RAF loop, identical to the
  // `?scene=` entry's.
  await startGameView({
    app,
    canvas,
    params,
    renderer,
    ...(sheet !== undefined ? { sheet } : {}),
    sim,
    cameraCtl,
    terrainGrid,
    // Minimap ground colours from the real terrain set's per-type debug colours (absent → flat tints).
    ...(terrain !== undefined ? { terrainColour: (t: number) => terrain.cellFor(t)?.fallbackColour } : {}),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
  });

  console.log(
    'Vinland map view up: LPM zaznacz / przeciągnij ramką, PPM wyślij, Spacja panel; middle-drag / arrows pan, wheel zoom.',
  );
}
