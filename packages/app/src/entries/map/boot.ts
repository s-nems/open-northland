import { mapLobbySlots } from '@open-northland/data';
import { type GameSession, localPlayerOf, seatColourOf } from '@open-northland/lockstep';
import {
  createWindowPixiApp,
  type ElevationField,
  makeElevationField,
  type SceneTerrain,
  type SpriteSheet,
  type TerrainTextureSet,
  type WorldRenderer,
} from '@open-northland/render';
import type { Entity, SaveGame, Simulation } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { buildingFootprints } from '../../content/ir/joins.js';
import { loadIr } from '../../content/ir/load.js';
import type { ContentIr } from '../../content/ir/rows.js';
import {
  loadMapBriefing,
  loadMapMeta,
  loadMapScript,
  loadMapStrings,
  loadTerrainMap,
} from '../../content/map-loader.js';
import { loadMapObjects } from '../../content/objects.js';
import { loadOwnMapObjects } from '../../content/own-assets/objects.js';
import { loadOwnSpriteSheet } from '../../content/own-assets/sprite-sheet.js';
import { loadOwnTerrain } from '../../content/own-assets/terrain.js';
import { resolveSpriteSheet } from '../../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../../content/terrain.js';
import { readVerifiedMapDocuments, type VerifiedMapDocuments } from '../../content/transfer/index.js';
import { diag, hashTraceFor, setDiagGameSession } from '../../diag/index.js';
import { assertMultiplayerMap } from '../../game/multiplayer-map.js';
import { sandboxGoods } from '../../game/sandbox/index.js';
import { onOffParam } from '../../game/session-rules.js';
import type { SessionRosterSlot } from '../../game/session-url.js';
import { sessionWorldOptions } from '../../game/session-world.js';
import { mapScriptWorld, terrainSceneFor } from '../../game/world/index.js';
import { type WorldTribes, worldTribes } from '../../game/world-tribes.js';
import { assetSetFor } from '../../view/asset-settings.js';
import { type BootPhase, type BootProgress, mountBootProgress } from '../../view/boot-progress.js';
import {
  createWorldRenderer,
  haltOnFailedRestore,
  haltOnMissingContent,
  loadLocalizedRealContent,
} from '../../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../../view/settings-store.js';
import { buildMapWorld, restoreMapWorld } from './world.js';

export { type MapRuntime, presentMapWorld } from './present.js';

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

export interface MapBootPlan {
  readonly multiplayer?: boolean;
  readonly mapId: string | null;
  readonly stagedSave: SaveGame | null;
  readonly verifiedMap?: VerifiedMapDocuments;
  /** The session once the map's roster is known. A relayed boot ignores the roster: its descriptor was
   *  broadcast whole. */
  readonly sessionFor: (roster: readonly SessionRosterSlot[]) => GameSession;
}

type LoadedMap = Awaited<ReturnType<typeof loadTerrainMap>>;
type LoadedObjects = Awaited<ReturnType<typeof loadMapObjects>>;

/** Everything the presentation half needs from the assembly half. */
export interface AssembledMapWorld {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly boot: BootProgress;
  readonly plan: MapBootPlan;
  readonly session: GameSession;
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet;
  readonly ownAssets: boolean;
  readonly terrainGrid: SceneTerrain;
  readonly terrain: TerrainTextureSet;
  readonly elevation: ElevationField;
  readonly loaded: LoadedMap;
  readonly ir: ContentIr | null;
  readonly script: Awaited<ReturnType<typeof loadMapScript>>;
  readonly meta: Awaited<ReturnType<typeof loadMapMeta>>;
  readonly briefing: Awaited<ReturnType<typeof loadMapBriefing>>;
  readonly strings: Awaited<ReturnType<typeof loadMapStrings>>;
  readonly tribes: WorldTribes;
  readonly staticObjects: LoadedObjects | undefined;
  readonly harvestablePlacements: readonly (readonly [Entity, number])[];
  /** The chest and ground-goods placements the sim draws from tick zero; empty on a restore, whose
   *  entities come out of the save. */
  readonly pooledPlacements: readonly number[];
}

/** Assemble the map's world up to a sim standing at a tick boundary; null when the boot halted. */
export async function assembleMapWorld(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  plan: MapBootPlan,
): Promise<AssembledMapWorld | null> {
  const { mapId, stagedSave } = plan;
  const ownAssets = assetSetFor(params) === 'own';
  if (plan.verifiedMap !== undefined && mapId === null) throw new Error('Verified map requires a map id');
  const verified =
    plan.verifiedMap !== undefined && mapId !== null
      ? readVerifiedMapDocuments(plan.verifiedMap, mapId)
      : undefined;
  const boot = mountBootProgress(MAP_BOOT_PHASES);
  await boot.begin('graphics');
  const app = await createWindowPixiApp(canvas, { resolutionScale: readStoredSettings().renderScale });
  let assembled = false;
  try {
    await boot.begin('map');
    const loaded = verified?.map ?? (mapId !== null ? await loadTerrainMap(mapId) : null);
    // A roster-less map keeps the defaults: seat 0, and colour = slot id.
    const [script, meta, briefing, strings] = await Promise.all([
      verified !== undefined ? verified.script : mapId !== null ? loadMapScript(mapId) : null,
      mapId !== null ? loadMapMeta(mapId) : null,
      mapId !== null ? loadMapBriefing(mapId) : null,
      mapId !== null ? loadMapStrings(mapId) : null,
    ]);
    if (plan.multiplayer) assertMultiplayerMap(script);
    const session = plan.sessionFor(script === null ? [] : mapLobbySlots(script));
    const localPlayer = localPlayerOf(session);
    const playerColourOf = seatColourOf(session);
    diag.info('boot', 'game start', { entry: 'map', decodedMap: loaded !== null, session });
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
      return null;
    }
    const renderer = createWorldRenderer(app, params, sheet, playerColourOf);
    renderer.setTerrain(terrainGrid, terrain);
    // `embr` accented by elevation hillshade, shared with the placed landscape objects so an object
    // cannot disagree with the ground under it.
    const brightness = renderer.brightnessField();
    // A partial `content/`, such as a missing atlas PNG, degrades to bare ground instead of crashing.
    await boot.begin('objects');
    let staticObjects: LoadedObjects | undefined;
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
    // The render layers read the raw map; the sim runs on the collision resolution of the same map.
    const missionWorld = mapScriptWorld(script, ir);
    const worldOptions = {
      script: missionWorld,
      map: loaded,
      ir,
      playerRoster: script?.players ?? [],
      specialItems: script?.specialItems ?? [],
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
    let pooledPlacements: readonly number[] = [];
    if (stagedSave !== null) {
      try {
        sim = restoreMapWorld(worldOptions, stagedSave).sim;
      } catch (err) {
        haltOnFailedRestore(err);
        return null;
      }
    } else {
      const world = buildMapWorld({
        ...worldOptions,
        ...sessionWorldOptions(session, script, missionWorld),
        seed: session.seed,
        // `?missions=off` is a local diagnostic; the descriptor carries no such rule, so a relayed
        // world never reads it.
        missions: plan.multiplayer ? null : onOffParam(params, 'missions'),
      });
      sim = world.sim;
      harvestablePlacements = world.harvestablePlacements;
      pooledPlacements = world.pooledPlacements;
    }
    setDiagGameSession({
      entry: 'map',
      worldId: mapId,
      seed: sim.seed,
      restoredAtTick: stagedSave !== null ? sim.tick : null,
      sim,
      hashTrace: hashTraceFor(params),
    });
    assembled = true;
    return {
      app,
      canvas,
      params,
      boot,
      plan,
      session,
      sim,
      renderer,
      sheet,
      ownAssets,
      terrainGrid,
      terrain,
      elevation,
      loaded,
      ir,
      script,
      meta,
      briefing,
      strings,
      tribes,
      staticObjects,
      harvestablePlacements,
      pooledPlacements,
    };
  } finally {
    if (!assembled) app.destroy(false, { children: true });
  }
}
