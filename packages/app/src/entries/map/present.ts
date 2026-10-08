import { mapLobbySlots } from '@open-northland/data';
import {
  DEFAULT_WEATHER_MODE,
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
  type SessionDriver,
  seatColourOf,
} from '@open-northland/lockstep';
import type { Camera } from '@open-northland/render';
import type { SaveGame } from '@open-northland/sim';
import { loadFellingClips } from '../../content/felling-clips.js';
import { loadMinimapCellColours } from '../../content/minimap-ground.js';
import { loadScriptLandscapeSprites } from '../../content/script-landscape-sprites.js';
import { soundScenery } from '../../content/sound-scenery.js';
import { playerNameMap, playerTribe } from '../../game/map-roster.js';
import { mapStartFocus } from '../../game/map-start.js';
import { mapStringLookup } from '../../game/map-strings.js';
import { hasEliminationGoal } from '../../game/match-participants.js';
import { briefingMatchObjectives, briefingPage, mapBriefFallback } from '../../game/mission-brief.js';
import { observerSeats } from '../../game/observer-seats.js';
import { harvestablePlacementOrdinals } from '../../game/sandbox/index.js';
import { sessionSearch } from '../../game/session-url.js';
import { displayViewOf, startWorldZoomFor } from '../../hud/ui-scale.js';
import { currentLocale, messages } from '../../i18n/index.js';
import { ambientWeatherFor } from '../../view/ambient-weather.js';
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
  /** Present when the sim runs on another thread. */
  readonly captureSaveFile?: GameViewDeps['captureSaveFile'];
  /** True for a relayed session, whose clock every client shares. */
  readonly sharedClock?: boolean;
  readonly confirmedMatchEnd?: () => number | null;
  readonly networkSave?: GameViewDeps['networkSave'];
  readonly onReturnToMenu?: () => void;
  readonly introAtStart: boolean;
  /** Present for a relayed session: the connection readouts the overlays show. */
  readonly netReadout?: () => NetReadout | null;
  /** Present for a relayed session: the network panel's feed. */
  readonly netPanel?: GameViewDeps['netPanel'];
  /** Present for a relayed session. Called once this display has shown the world, so the room may count
   *  the client loaded, or with `shown` false once the view ended before its first frame; the card
   *  covers the drawn world until it settles, once the room starts its shared clock or the wait no
   *  longer matters. */
  readonly untilStart?: (shown: boolean) => Promise<void>;
}

/** Settles once `signal` aborts; at once when it already has. */
function ended(signal: AbortSignal): Promise<false> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true }));
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
          2 * terrainGrid.width,
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
  const zoom = mapZoomParam(
    params,
    startWorldZoomFor(displayViewOf(initialViewport.width, initialViewport.height)),
  );
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

  // Every program links before the first frame, so a cold Direct3D compile shows as this step, not as
  // a frozen interface.
  await boot.begin('shaders');
  await world.shaders.done;
  await boot.begin('hud');
  let markShown: () => void = () => undefined;
  const shown = new Promise<true>((resolve) => {
    markShown = () => resolve(true);
  });
  const view = await startGameView({
    app,
    canvas,
    params,
    initialViewport,
    renderer,
    sheet: world.sheet,
    // A presentation pack's trees have no falling clips of their own.
    ...(pack === null && ir !== null ? { fellingClips: await loadFellingClips(ir, host.content.goods) } : {}),
    host,
    driver: runtime.driver,
    ...(runtime.offThreadTickCost !== undefined ? { offThreadTickCost: runtime.offThreadTickCost } : {}),
    ...(runtime.captureSaveFile !== undefined ? { captureSaveFile: runtime.captureSaveFile } : {}),
    ...(runtime.confirmedMatchEnd === undefined ? {} : { confirmedMatchEnd: runtime.confirmedMatchEnd }),
    ...(runtime.networkSave === undefined ? {} : { networkSave: runtime.networkSave }),
    ...(runtime.sharedClock !== undefined ? { sharedClock: runtime.sharedClock } : {}),
    ...(runtime.onReturnToMenu !== undefined ? { onReturnToMenu: runtime.onReturnToMenu } : {}),
    ...(runtime.netReadout !== undefined ? { netReadout: runtime.netReadout } : {}),
    ...(runtime.netPanel !== undefined ? { netPanel: runtime.netPanel } : {}),
    ...(runtime.untilStart === undefined ? {} : { onFirstFrameShown: () => markShown() }),
    cameraCtl,
    terrainGrid,
    localPlayer,
    observer: isSpectator(session),
    readOnly: isReadOnlySpectator(session),
    ...(isReadOnlySpectator(session)
      ? { observerSeats: observerSeats(session, script, currentLocale()) }
      : {}),
    playerColourOf,
    seatTribeOf: (player) => playerTribe({ players: world.seatedPlayers }, player),
    tribes: world.tribes,
    seatNameOf: playerNameMap(script, currentLocale()),
    rosterPlayers: script?.players.map((p) => p.player) ?? [],
    relationFlags: script?.relationFlags ?? [],
    ...terrainColourOption(world.terrain),
    ...(minimapCells !== null ? { minimapCellColours: minimapCells } : {}),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    ambientWeather: ambientWeatherFor(
      terrainGrid,
      ir?.gfxPatterns ?? [],
      hosted.seed,
      session.rules.weather ?? DEFAULT_WEATHER_MODE,
    ),
    elevation: world.elevation, // a placement/order click on a lifted hill resolves to the tile drawn there
    onEvents: (events) => {
      staticLayer?.onEvents(events);
      landscapes?.onEvents(events);
    },
    ...(staticLayer !== null ? { staticHarvestableSprite: staticLayer.harvestableSpriteOf } : {}),
    ...(loaded?.objects !== undefined && ir !== null
      ? {
          soundScenery: soundScenery(
            loaded.objects,
            ir,
            harvestablePlacementOrdinals(host.content, loaded.objects, ir),
          ),
        }
      : {}),
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
      matchObjectives: briefingMatchObjectives(host.missions),
      page: (id) => briefingPage(world.briefing, currentLocale(), id),
      fallback: mapBriefFallback(meta, currentLocale()),
      skirmishGoal:
        !isSpectator(session) && hasEliminationGoal(hosted.matchRules, localPlayer)
          ? messages().hud.skirmishGoal
          : null,
    },
  });
  if (runtime.untilStart !== undefined) {
    // Under the card the world's first frame may block for long on first-use graphics work; the room
    // counts this client loaded only once that frame has been shown, so its clock cannot run meanwhile.
    const wasShown = await Promise.race([shown, ended(view.lifetime)]);
    await boot.begin('players');
    await runtime.untilStart(wasShown);
  }
  await boot.finish();
  // A late edit answer never lands on the renderer of a view that is gone.
  view.lifetime.addEventListener('abort', () => landscapes?.dispose(), { once: true });
  return view;
}
