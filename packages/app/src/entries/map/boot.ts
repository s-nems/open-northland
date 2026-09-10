import {
  type GameSession,
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
  type SessionDriver,
  seatColourOf,
} from '@open-northland/lockstep';
import {
  type Camera,
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
import { loadMapBriefing, loadMapMeta, loadMapScript, loadTerrainMap } from '../../content/map-loader.js';
import { loadMinimapCellColours } from '../../content/minimap-ground.js';
import { loadMapObjects } from '../../content/objects.js';
import { resolveSpriteSheet } from '../../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../../content/terrain.js';
import { diag, hashTraceFor, setDiagGameSession } from '../../diag/index.js';
import { playerNameMap, playerTribe } from '../../game/map-roster.js';
import { mapStartFocus } from '../../game/map-start.js';
import { matchIsContested, neverDiesSeats } from '../../game/match-participants.js';
import { mapMissionBrief } from '../../game/mission-brief.js';
import { harvestablePlacementOrdinals, sandboxGoods } from '../../game/sandbox/index.js';
import { sessionRoles } from '../../game/session-roles.js';
import type { SessionRosterSlot } from '../../game/session-url.js';
import { terrainSceneFor } from '../../game/world/index.js';
import { type WorldTribes, worldTribes } from '../../game/world-tribes.js';
import { currentLocale, messages } from '../../i18n/index.js';
import { type BootPhase, type BootProgress, mountBootProgress } from '../../view/boot-progress.js';
import { cameraCenteredOnTile, createCameraController } from '../../view/camera/index.js';
import { bindStaticLayer } from '../../view/static-layer.js';
import { type GameViewHandle, startGameView } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import {
  createWorldRenderer,
  haltOnFailedRestore,
  haltOnMissingContent,
  loadLocalizedRealContent,
  terrainColourOption,
} from '../../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../../view/settings-store.js';
import { buildMapWorld, restoreMapWorld } from './world.js';

/**
 * The decoded-map boot in two halves: `assembleMapWorld` draws `content/maps/<id>.json` under the
 * deterministic sim, and `presentMapWorld` mounts the HUD and starts the frame loop over whichever
 * session driver runs it. The backing store tracks the window at the stored render scale times the
 * device oversample while `app.screen` stays in CSS px, so resizing changes the visible field, never
 * the scale. An unknown or undecodable map id falls back to the synthetic grass strip; a checkout
 * without served `content/` halts at the terrain step.
 */

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
  readonly mapId: string | null;
  readonly stagedSave: SaveGame | null;
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
  readonly terrainGrid: SceneTerrain;
  readonly terrain: TerrainTextureSet;
  readonly elevation: ElevationField;
  readonly loaded: LoadedMap;
  readonly ir: ContentIr | null;
  readonly script: Awaited<ReturnType<typeof loadMapScript>>;
  readonly meta: Awaited<ReturnType<typeof loadMapMeta>>;
  readonly briefing: Awaited<ReturnType<typeof loadMapBriefing>>;
  readonly tribes: WorldTribes;
  readonly staticObjects: LoadedObjects | undefined;
  readonly harvestablePlacements: readonly (readonly [Entity, number])[];
  readonly participants: readonly number[];
}

/** How the assembled world runs: the driver the frame loop feeds and the HUD sets the clock on. */
export interface MapRuntime {
  readonly driver: SessionDriver;
  /** True for a relayed session, whose clock every client shares. */
  readonly sharedClock?: boolean;
  readonly introAtStart: boolean;
  /** Present for a relayed session: the connection readouts the overlays show. */
  readonly netReadout?: () => NetReadout | null;
}

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

/** Assemble the map's world up to a sim standing at a tick boundary; null when the boot halted. */
export async function assembleMapWorld(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  plan: MapBootPlan,
): Promise<AssembledMapWorld | null> {
  const { mapId, stagedSave } = plan;
  const boot = mountBootProgress(MAP_BOOT_PHASES);
  await boot.begin('graphics');
  const app = await createWindowPixiApp(canvas, { resolutionScale: readStoredSettings().renderScale });
  await boot.begin('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  // A roster-less map keeps the defaults: seat 0, and colour = slot id.
  const [script, meta, briefing] = await Promise.all([
    mapId !== null ? loadMapScript(mapId) : null,
    mapId !== null ? loadMapMeta(mapId) : null,
    mapId !== null ? loadMapBriefing(mapId) : null,
  ]);
  const session = plan.sessionFor(script?.players ?? []);
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
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods(), tribes);
  await boot.begin('terrain');
  let terrain: TerrainTextureSet;
  try {
    terrain = await loadRealTerrain(ir);
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
  const roles = sessionRoles(session, script === null ? [] : neverDiesSeats(script));
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
      return null;
    }
  } else {
    const world = buildMapWorld({
      ...worldOptions,
      seed: session.seed,
      aiSeats: roles.aiSeats,
      assistantSeats: roles.assistantSeats,
      matchParticipants: roles.matchParticipants,
      diplomacy: script?.diplomacy ?? [],
      ...session.rules,
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
    terrainGrid,
    terrain,
    elevation,
    loaded,
    ir,
    script,
    meta,
    briefing,
    tribes,
    staticObjects,
    harvestablePlacements,
    participants: roles.matchParticipants,
  };
}

/** Mount the HUD over the assembled world and start its frame loop. */
export async function presentMapWorld(
  world: AssembledMapWorld,
  runtime: MapRuntime,
): Promise<GameViewHandle> {
  const { app, canvas, params, boot, session, sim, renderer, terrainGrid, loaded, ir, script, meta } = world;
  const { mapId, stagedSave } = world.plan;
  const localPlayer = localPlayerOf(session);
  const playerColourOf = seatColourOf(session);
  const staticObjects = world.staticObjects;

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
  const initialCamera =
    centerTile(params.get('center'), initialViewport.width, initialViewport.height) ??
    cameraCenteredOnTile(focus.x, focus.y, 1, initialViewport.width, initialViewport.height);
  const cameraCtl = createCameraController(
    canvas,
    initialCamera,
    () => app.renderer.resolution,
    readStoredSettings().keyBindings,
  );

  // Averaged from the real texture pages the map's ground lanes point at: the shipped `minimap.pcx` is
  // map-selection card art, not an overview raster. Null without lanes or textures.
  await boot.begin('minimap');
  const minimapCells = await loadMinimapCellColours(terrainGrid, world.terrain);

  await boot.begin('hud');
  const view = await startGameView({
    app,
    canvas,
    params,
    initialViewport,
    renderer,
    sheet: world.sheet,
    sim,
    driver: runtime.driver,
    ...(runtime.sharedClock !== undefined ? { sharedClock: runtime.sharedClock } : {}),
    ...(runtime.netReadout !== undefined ? { netReadout: runtime.netReadout } : {}),
    cameraCtl,
    terrainGrid,
    localPlayer,
    observer: isSpectator(session),
    readOnly: isReadOnlySpectator(session),
    playerColourOf,
    seatTribeOf: (player) => playerTribe(script, player),
    tribes: world.tribes,
    seatNameOf: playerNameMap(script),
    rosterPlayers: script?.players.map((p) => p.player) ?? [],
    ...terrainColourOption(world.terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation: world.elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    ...(staticLayer !== null ? { onEvents: staticLayer } : {}),
    worldToken: mapId,
    introAtStart: runtime.introAtStart,
    musicType: meta?.musicType ?? null,
    missionBrief: mapMissionBrief({
      script,
      briefing: world.briefing,
      lang: currentLocale(),
      name: meta?.name,
      description: meta?.description,
      skirmishGoal: messages().hud.skirmishGoal,
      matchDeclared: matchIsContested(world.participants) && world.participants.includes(localPlayer),
    }),
  });
  await boot.finish();
  return view;
}
