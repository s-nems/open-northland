import { mapLobbySlots } from '@open-northland/data';
import {
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
  type SessionDriver,
  seatColourOf,
} from '@open-northland/lockstep';
import type { Camera } from '@open-northland/render';
import type { SaveGame } from '@open-northland/sim';
import { loadMinimapCellColours } from '../../content/minimap-ground.js';
import { loadScriptLandscapeSprites } from '../../content/script-landscape-sprites.js';
import { playerNameMap, playerTribe } from '../../game/map-roster.js';
import { mapStartFocus } from '../../game/map-start.js';
import { mapStringLookup } from '../../game/map-strings.js';
import { hasEliminationGoal } from '../../game/match-participants.js';
import { briefingPage, mapBriefFallback } from '../../game/mission-brief.js';
import { observerSeats } from '../../game/observer-seats.js';
import { harvestablePlacementOrdinals } from '../../game/sandbox/index.js';
import { sessionSearch } from '../../game/session-url.js';
import { currentLocale, messages } from '../../i18n/index.js';
import { cameraCenteredOnTile, createCameraController } from '../../view/camera/index.js';
import { mapZoomParam } from '../../view/camera/map-zoom.js';
import { formatSearch } from '../../view/params.js';
import { type GameViewDeps, type GameViewHandle, startGameView } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { bindScriptLandscapes } from '../../view/runtime/script-landscapes.js';
import { terrainColourOption } from '../../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../../view/settings-store.js';
import { bindStaticLayer } from '../../view/static-layer.js';
import type { AssembledMapWorld } from './boot.js';
import { mapSubMissionLoader, validateSavedMap } from './sub-missions.js';

/** How the assembled world runs: the driver the frame loop feeds and the HUD sets the clock on. */
export interface MapRuntime {
  readonly driver: SessionDriver;
  /** Present when the sim runs on another thread. */
  readonly offThreadTickCost?: GameViewDeps['offThreadTickCost'];
  /** True for a relayed session, whose clock every client shares. */
  readonly sharedClock?: boolean;
  readonly confirmedMatchEnd?: () => number | null;
  readonly networkSave?: GameViewDeps['networkSave'];
  readonly onReturnToMenu?: () => void;
  readonly introAtStart: boolean;
  /** Present for a relayed session: the connection readouts the overlays show. */
  readonly netReadout?: () => NetReadout | null;
}

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

/** Mount the HUD over the assembled world and start its frame loop. */
export async function presentMapWorld(
  world: AssembledMapWorld,
  runtime: MapRuntime,
): Promise<GameViewHandle> {
  const {
    app,
    canvas,
    params,
    boot,
    session,
    hosted,
    renderer,
    terrainGrid,
    loaded,
    ir,
    script,
    meta,
    pack,
  } = world;
  const { mapId, stagedSave } = world.plan;
  const { host } = hosted;
  const localPlayer = localPlayerOf(session);
  const playerColourOf = seatColourOf(session);
  const staticObjects = world.staticObjects;

  const staticLayer =
    staticObjects !== undefined && loaded?.objects !== undefined && ir !== null
      ? bindStaticLayer(
          renderer,
          { placements: loaded.objects.placements, byPlacement: staticObjects.byPlacement },
          stagedSave === null
            ? {
                kind: 'fresh',
                placementByEntity: hosted.placements.harvestablePlacements,
                pooledPlacements: hosted.placements.pooledPlacements,
              }
            : {
                kind: 'restored',
                placements: harvestablePlacementOrdinals(host.content, loaded.objects, ir),
              },
          host.content,
          () => host.snapshot(),
        )
      : null;

  const landscapes =
    host.missions !== undefined && ir !== null
      ? bindScriptLandscapes(
          host,
          renderer,
          staticObjects?.byPlacement ?? new Map(),
          await loadScriptLandscapeSprites(
            host.missions,
            ir,
            world.elevation,
            renderer.brightnessField(),
            pack !== null
              ? (objects) => pack.mapObjects(app.renderer, objects, ir, world.elevation)
              : undefined,
          ),
          world.groundWaves,
        )
      : null;
  const related = { ir, content: { content: host.content }, params };
  const focus = mapStartFocus(host.snapshot(), terrainGrid.width, terrainGrid.height, localPlayer);
  const initialViewport = { width: app.screen.width, height: app.screen.height };
  const zoom = mapZoomParam(params);
  const initialCamera =
    centerTile(params.get('center'), initialViewport.width, initialViewport.height, zoom) ??
    cameraCenteredOnTile(focus.x, focus.y, zoom, initialViewport.width, initialViewport.height);
  const cameraSettings = readStoredSettings();
  const cameraCtl = createCameraController(
    canvas,
    initialCamera,
    () => app.renderer.resolution,
    cameraSettings.keyBindings,
    cameraSettings,
  );

  // Averaged from the real texture pages the map's ground lanes point at: the shipped `minimap.pcx` is
  // map-selection card art, not an overview raster. Null without lanes or textures.
  await boot.begin('minimap');
  const minimapCells = pack !== null ? null : await loadMinimapCellColours(terrainGrid, world.terrain);
  renderer.setGroundColours(minimapCells, terrainGrid.width, terrainGrid.height);

  await boot.begin('hud');
  const view = await startGameView({
    app,
    canvas,
    params,
    initialViewport,
    renderer,
    sheet: world.sheet,
    host,
    driver: runtime.driver,
    ...(runtime.offThreadTickCost !== undefined ? { offThreadTickCost: runtime.offThreadTickCost } : {}),
    ...(runtime.confirmedMatchEnd === undefined ? {} : { confirmedMatchEnd: runtime.confirmedMatchEnd }),
    ...(runtime.networkSave === undefined ? {} : { networkSave: runtime.networkSave }),
    ...(runtime.sharedClock !== undefined ? { sharedClock: runtime.sharedClock } : {}),
    ...(runtime.onReturnToMenu !== undefined ? { onReturnToMenu: runtime.onReturnToMenu } : {}),
    ...(runtime.netReadout !== undefined ? { netReadout: runtime.netReadout } : {}),
    cameraCtl,
    terrainGrid,
    localPlayer,
    observer: isSpectator(session),
    readOnly: isReadOnlySpectator(session),
    ...(isReadOnlySpectator(session)
      ? { observerSeats: observerSeats(session, script, currentLocale()) }
      : {}),
    playerColourOf,
    seatTribeOf: (player) => playerTribe(script, player),
    tribes: world.tribes,
    seatNameOf: playerNameMap(script, currentLocale()),
    rosterPlayers: script?.players.map((p) => p.player) ?? [],
    relationFlags: script?.relationFlags ?? [],
    ...terrainColourOption(world.terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation: world.elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    onEvents: (events) => {
      staticLayer?.(events);
      landscapes?.onEvents(events);
    },
    mapText: mapStringLookup(world.strings, currentLocale()),
    ...(stagedSave?.parent !== undefined ? { parentSave: stagedSave.parent } : {}),
    ...(runtime.sharedClock
      ? {}
      : {
          prepareSubMission: mapSubMissionLoader(related),
          validateSavedMap: (save: SaveGame) => validateSavedMap(related, save),
        }),
    worldToken: mapId,
    saveEntrySearch: formatSearch(sessionSearch(session, script === null ? [] : mapLobbySlots(script))),
    introAtStart: runtime.introAtStart && host.missions === undefined,
    musicType: meta?.musicType ?? null,
    missionBriefSource: {
      page: (id) => briefingPage(world.briefing, currentLocale(), id),
      fallback: mapBriefFallback(meta, currentLocale()),
      skirmishGoal:
        !isSpectator(session) && hasEliminationGoal(hosted.matchRules, localPlayer)
          ? messages().hud.skirmishGoal
          : null,
    },
  });
  await boot.finish();
  // A late edit answer never lands on the renderer of a view that is gone.
  view.lifetime.addEventListener('abort', () => landscapes?.dispose(), { once: true });
  return view;
}
