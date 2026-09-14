import {
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
  type SessionDriver,
  seatColourOf,
} from '@open-northland/lockstep';
import type { Camera } from '@open-northland/render';
import { loadMinimapCellColours } from '../../content/minimap-ground.js';
import { playerNameMap, playerTribe } from '../../game/map-roster.js';
import { mapStartFocus } from '../../game/map-start.js';
import { matchIsContested } from '../../game/match-participants.js';
import { mapMissionBrief } from '../../game/mission-brief.js';
import { harvestablePlacementOrdinals } from '../../game/sandbox/index.js';
import { sessionSearch } from '../../game/session-url.js';
import { currentLocale, messages } from '../../i18n/index.js';
import { cameraCenteredOnTile, createCameraController } from '../../view/camera/index.js';
import { mapZoomParam } from '../../view/camera/map-zoom.js';
import { formatSearch } from '../../view/params.js';
import { type GameViewDeps, type GameViewHandle, startGameView } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { terrainColourOption } from '../../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../../view/settings-store.js';
import { bindStaticLayer } from '../../view/static-layer.js';
import type { AssembledMapWorld } from './boot.js';

/** How the assembled world runs: the driver the frame loop feeds and the HUD sets the clock on. */
export interface MapRuntime {
  readonly driver: SessionDriver;
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
            ? {
                kind: 'fresh',
                placementByEntity: world.harvestablePlacements,
                pooledPlacements: world.pooledPlacements,
              }
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
  const minimapCells = world.ownAssets ? null : await loadMinimapCellColours(terrainGrid, world.terrain);

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
    saveEntrySearch: formatSearch(sessionSearch(session, script?.players ?? [])),
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
