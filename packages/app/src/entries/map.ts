import {
  type Camera,
  composeShadingLane,
  createWindowPixiApp,
  type MapObjectSprite,
  makeBrightnessField,
  makeElevationField,
  WorldRenderer,
} from '@open-northland/render';
import { halfCellMapFromCells, type SimEvent } from '@open-northland/sim';
import { buildCollisionTerrain } from '../content/collision.js';
import { goodLocaleParam, loadGoodNameMap } from '../content/good-names.js';
import { buildingFootprints, loadIr } from '../content/ir.js';
import { loadMinimapCellColours } from '../content/minimap-ground.js';
import { loadMapObjects } from '../content/objects.js';
import { loadRuntimeRealContent, logRealContentGaps } from '../content/real-content.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain } from '../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../diag/index.js';
import { fogModeParam } from '../game/fog.js';
import { mapStartFocus } from '../game/map-start.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  mapResourceObjectNames,
  sandboxGoods,
  spawnMapBerryBushes,
  spawnMapResources,
} from '../game/sandbox/index.js';
import { loadTerrainMap } from '../slice/map-loader.js';
import { runAuthoredSlice, runBareMap, runSlice, sliceTerrain } from '../slice/vertical-slice.js';
import { cameraCenteredOnTile, createCameraController } from '../view/camera.js';
import { startGameView } from '../view/runtime/game-view.js';

/**
 * The decoded-map viewer entry (`?map=<id>`): draws an actual decoded `content/maps/<id>.json` grid — the
 * 1:1 per-triangle ground + placed landscape objects (trees/stones/mines + animated waves) — driven by the
 * deterministic vertical-slice sim on the fixed-timestep loop, drawn every frame so `npm run dev` is
 * watchable. The default landing is the menu ({@link import('./menu.js')}), whose "Mapy" section links here
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
  const app = await createWindowPixiApp(canvas);
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  diag.info('boot', 'game start', { entry: 'map', mapId, decodedMap: loaded !== null, seed: SLICE_SEED });
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // The decoded map's terrain-height field (flat when the map carries no `lmhe` lane). The renderer
  // builds its own from the terrain grid for the ground mesh + entity lift; this shared instance lifts
  // the map objects at load and drives elevation-aware picking (worldToTile) below.
  const elevation = makeElevationField(loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0);
  // The composed shading field — the baked `embr` lane accented by elevation hillshade, the same
  // composition the renderer's ground mesh draws with (`composeShadingLane`). This shared instance
  // shades the placed landscape objects at load (mines/stones/grass track the lane in the original;
  // trees stay full-bright — see objects.ts), so an object can't disagree with the ground under it.
  const brightness = makeBrightnessField(
    composeShadingLane(loaded?.brightness, loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0),
    loaded?.width ?? 0,
    loaded?.height ?? 0,
  );
  // The app-wide `?lang=` good-name map + the merged real content it localizes — loaded before the
  // sprite sheet so the goods icon atlas is built from the real goods when served (null on a bare
  // checkout → the sandbox goods below). Its gaps (uncalibrated gathered goods, uncataloged buildings)
  // are logged once.
  const goodNames = await loadGoodNameMap(goodLocaleParam(params));
  const realContent = await loadRuntimeRealContent(goodNames);
  if (realContent !== null) logRealContentGaps(realContent);
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods());
  const ir = await loadIr();
  if (ir === null) diag.warn('content', 'content/ir.json unavailable, placeholder graphics fallback');
  let terrain: Awaited<ReturnType<typeof loadRealTerrain>> | undefined;
  if (ir !== null) {
    try {
      terrain = await loadRealTerrain(ir);
    } catch (err) {
      diag.warn('content', `real terrain unavailable, flat tint fallback: ${String(err)}`);
    }
  }
  // Retained renderer: mesh the terrain once, reuse a pooled sprite graph each frame (no per-frame
  // object churn) so large maps + deep zoom-out stay within the GPU budget.
  const renderer = new WorldRenderer(app, {
    sheet,
    viewSmoothing: true,
    postFx: params.get('postfx') !== 'off',
  });
  renderer.setTerrain(terrainGrid, terrain);
  // A decoded map's placed landscape objects (trees/stones/mine decals + the animated wave fx that
  // are the original's water surface) — resolved through the landscapeGfx IR + the /bobs atlases.
  // The catch keeps a partial content/ (e.g. a missing atlas PNG) a degradation, not an app crash.
  // Harvestables draw here too: a virgin node is a built-once static quad (zero per-frame cost — a far
  // zoom-out shows thousands at once), handed to the live sim pool the first time it is worked (below).
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
  // The slice sim (kept live and stepped one tick per fixed interval) is built below; its demo units are
  // owned by the human player so they can be selected + ordered.
  // Extracted building footprints from the served IR give buildings real collision, so `placeBuilding`
  // is blocked where a house doesn't fit and the build overlay greys those tiles (empty without content/).
  const footprints = buildingFootprints(ir);
  // The sim navigates + validates placement against the collision grid — the map's raw landscape lane
  // resolved into the semantic walk/build classes from the real ground + object data (water, trees,
  // stones, ore deposits block; see content/collision.ts). The render layers keep reading `loaded`
  // (raw typeIds drive the flat-tint fallback + the ambience beds). Without the IR the grid degrades
  // to all-open ground rather than mis-classing the raw lane against the synthetic table.
  // Harvestable placements are excluded from the static grid: they spawn as `Resource` entities below,
  // whose dynamic footprints block while standing and unblock when felled/depleted — statically baked,
  // a felled tree's cell stayed walled off forever and its dropped trunk was unreachable.
  const simMap =
    loaded !== null && ir !== null
      ? buildCollisionTerrain(loaded, ir, mapResourceObjectNames(ir))
      : loaded !== null
        ? halfCellMapFromCells(loaded)
        : null;
  // A map that carries authored entities places those; a real decoded map without them gets a bare sim
  // (no demo cluster — {@link runBareMap}); only the synthetic-strip fallback (no map loaded) keeps the
  // HQ/joinery/gatherer/carrier demo world (via {@link runSlice}, shared with the deterministic shot PNG).
  // The placing slices run one tick, not zero: `placeBuilding`/`spawnSettler` are queued commands that
  // apply on the sim's first step, so a 0-tick sim's snapshot is still empty — the start-camera focus
  // below would then read no entities and fall back to the map centre. One tick applies every placement
  // (the command queue drains fully per step) while leaving the just-spawned settlers at their start.
  const authoredSim =
    loaded?.entities !== undefined && ir !== null && simMap !== null
      ? runAuthoredSlice(
          SLICE_SEED,
          1,
          simMap,
          loaded.entities,
          ir,
          footprints,
          goodNames,
          realContent?.content,
        )
      : null;
  const sim =
    authoredSim ??
    (simMap !== null
      ? runBareMap(SLICE_SEED, simMap, footprints, goodNames, realContent?.content)
      : runSlice(SLICE_SEED, 1, undefined, HUMAN_PLAYER, footprints, goodNames, realContent?.content));
  setDiagGameSession({
    entry: 'map',
    worldId: mapId,
    seed: SLICE_SEED,
    sim,
    hashTrace: hashTraceFor(params),
  });

  // `?fog=off|reveal|recon` selects the map's fog rule (direct URLs without the flag remain revealed).
  const fogOverride = fogModeParam(params);
  if (fogOverride !== null) sim.enqueue({ kind: 'setFogMode', mode: fogOverride });

  // Spawn the map's own trees/ore/stone as real harvestable `Resource` sim nodes, so a gatherer can
  // actually work them, not just see render-only decor.
  // Direct spawn into the sim (after its one placement tick above), in the map's placement order
  // (deterministic ids) — the authored buildings/settlers already exist, so these nodes take later ids.
  //
  // Draw split (the static→dynamic handover): a virgin node keeps its built-once static sprite (the
  // layer loaded above draws all 40k+ placements for free per frame) and the sim pool skips it via
  // `staticRefs`; the first time it is worked (`resourceFelled`/`resourceMined`/`resourceDepleted`) the
  // event handler below removes the static sprite and releases the ref, and the pool draws the entity
  // from then on — same graphic (its own species variant via `Resource.gfxIndex`), now shrinking with
  // its levels and vanishing on destroy. Without decoded atlases nothing is static, so the sim pool draws
  // every node.
  let staticResources: Map<number, MapObjectSprite> | undefined;
  let staticRefs: Set<number> | undefined;
  if (loaded?.objects !== undefined && ir !== null) {
    const { placementByEntity } = spawnMapResources(sim, loaded.objects, ir);
    // The map's own fruited bushes as forageable BerryBush entities (wild food) — same static→live
    // handover as resources: the static layer draws each always-fruited until it is first foraged.
    const bushes = spawnMapBerryBushes(sim, loaded.objects, ir);
    if (staticObjects !== undefined) {
      staticResources = new Map();
      for (const [entity, placement] of [...placementByEntity, ...bushes.placementByEntity]) {
        const sprite = staticObjects.byPlacement.get(placement);
        // A placement whose atlas never resolved has no static sprite — leave that node pool-drawn.
        if (sprite !== undefined) staticResources.set(entity as number, sprite);
      }
      // Live-view contract (setStaticallyDrawnRefs): the renderer keeps this reference and reads it
      // per frame; the handover below mutates it in place — O(1) per event, never a whole-set rebuild.
      staticRefs = new Set(staticResources.keys());
      renderer.setStaticallyDrawnRefs(staticRefs);
    }
  }
  const releaseWorkedResources =
    staticResources === undefined || staticRefs === undefined
      ? undefined
      : (events: readonly SimEvent[]): void => {
          const held = staticResources;
          const refs = staticRefs;
          if (held === undefined || refs === undefined) return;
          for (const ev of events) {
            // A resource first worked (felled/mined/depleted) or a bush first foraged leaves the retained
            // static layer; from then on the live pool draws it (a shrinking deposit, a bare/regrown bush).
            const entity =
              ev.kind === 'resourceFelled' || ev.kind === 'resourceMined' || ev.kind === 'resourceDepleted'
                ? (ev.node as number)
                : ev.kind === 'berryForaged'
                  ? (ev.bush as number)
                  : undefined;
            if (entity === undefined) continue;
            const sprite = held.get(entity);
            if (sprite === undefined) continue; // already handed over, or never static (admin spawn)
            held.delete(entity);
            refs.delete(entity);
            renderer.removeMapObject(sprite);
            // The static quad was this node's fog ghost (a virgin object is its own last-seen state);
            // adopt it into the ghost store so a node first worked under the fog keeps its remembered
            // look on explored ground instead of vanishing with the handover.
            renderer.adoptFogGhost(entity);
          }
        };

  // Interactive camera: the start frame centres on the player's start ({@link mapStartFocus}: the human
  // player's headquarters/settler cluster, else the map centre) so entering a map lands on the action, not
  // the top-left corner — from there a human pans (middle-mouse drag / arrow keys) and zooms (scroll
  // wheel). The HUD is drawn outside the camera layer below, so it stays pinned while the world moves.
  // `?center=x,y` overrides the start frame to centre a given tile (a decoded map's feature — a bridge or
  // coastline the start framing would never land on), degrading to the start framing when malformed.
  const focus = mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height);
  const initialCamera =
    centerTile(params.get('center'), app.screen.width, app.screen.height) ??
    cameraCenteredOnTile(focus.x, focus.y, 1, app.screen.width, app.screen.height);
  const cameraCtl = createCameraController(canvas, initialCamera, app.renderer.resolution);

  // The minimap's per-cell ground colours, averaged from the real texture pages the map's baked
  // ground lanes point at (the shipped `minimap.pcx` is the map-selection card — sometimes a painted
  // scene, e.g. magiczny las — so the in-game minimap is rendered from map data, like the original's
  // dynamic overview window). Null without lanes/textures → the typeId raster fallback.
  const minimapCells = await loadMinimapCellColours(terrainGrid, terrain);

  // The shared in-game runtime (view/runtime/game-view.ts): the standard HUD mounts — tool panel, unit
  // controls, perf overlay, positional sound — and the one fixed-timestep RAF loop, identical to the
  // `?scene=` entry's.
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
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    // First-touch handover: a worked resource leaves the static layer and the pool draws it on.
    ...(releaseWorkedResources !== undefined ? { onEvents: releaseWorkedResources } : {}),
  });
}
