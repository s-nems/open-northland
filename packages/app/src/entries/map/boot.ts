import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { type GameSession, seatColourOf } from '@open-northland/lockstep';
import {
  createWindowPixiApp,
  type ElevationField,
  type GroundWave,
  makeElevationField,
  type SceneTerrain,
  type SpriteSheet,
  type TerrainTextureSet,
  type WorldRenderer,
} from '@open-northland/render';
import type { MatchRulesView, SaveGame, SaveGameHeader } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { MONSTER_TRIBES } from '../../catalog/creatures.js';
import { loadAmbientCreatures } from '../../content/animal-gfx/index.js';
import { authoredBuildingSheet } from '../../content/building-gfx/authored.js';
import { loadGroundWaves } from '../../content/ground-waves.js';
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
import { resolveSpriteSheet } from '../../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../../content/terrain.js';
import { readVerifiedMapDocuments, type VerifiedMapDocuments } from '../../content/transfer/index.js';
import { diag, hashTraceFor, setDiagGameSession } from '../../diag/index.js';
import { assertMultiplayerMap } from '../../game/multiplayer-map.js';
import { sandboxGoods } from '../../game/sandbox/index.js';
import { sessionSeating } from '../../game/seat-tribes.js';
import { onOffParam } from '../../game/session-rules.js';
import type { SessionRosterSlot } from '../../game/session-url.js';
import { resolveAuthoredPlacements } from '../../game/world/authored-placements.js';
import { terrainSceneFor } from '../../game/world/index.js';
import { type WorldTribes, worldTribes } from '../../game/world-tribes.js';
import { WorldNotAdoptedError } from '../../net/relayed-worlds.js';
import { type PresentationPack, presentationPack } from '../../presentation/pack.js';
import type { SessionHost } from '../../session/index.js';
import { type BootPhase, type BootProgress, mountBootProgress } from '../../view/boot-progress.js';
import {
  createWorldRenderer,
  haltOnFailedRestore,
  haltOnMissingContent,
  loadLocalizedRealContent,
} from '../../view/runtime/world-bootstrap.js';
import { readStoredSettings } from '../../view/settings-store.js';
import type { MapWorldDocuments, MapWorldPlacements } from './world-inputs.js';

export { type MapRuntime, presentMapWorld } from './present.js';

export const MAP_BOOT_PHASES = [
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'world',
  'objects',
  'minimap',
  'hud',
] as const satisfies readonly BootPhase[];

/** A relayed map's card stays up until every member shows its world, so they start together. */
export const RELAYED_MAP_BOOT_PHASES = [
  ...MAP_BOOT_PHASES,
  'players',
] as const satisfies readonly BootPhase[];

/** The running world as the presentation half reads it, whichever thread its sim runs on. */
export interface HostedMapWorld {
  readonly host: SessionHost;
  readonly placements: MapWorldPlacements;
  /** As the world stood when built, for the briefing's skirmish goal. */
  readonly matchRules: MatchRulesView;
  readonly seed: number;
}

/** What the boot reads of the save a world restores from; the host holds the save itself. */
export interface RestoredSave {
  readonly header: Pick<SaveGameHeader, 'tick' | 'mapId'>;
  /** The mission save a sub-mission's save continues. */
  readonly parent?: SaveGame;
}

export interface MapBootPlan<H extends HostedMapWorld> {
  /** Stands the world up from the loaded documents; a rejection of a staged save halts the boot. */
  readonly hostWorld: (inputs: MapWorldDocuments) => Promise<H>;
  readonly multiplayer?: boolean;
  /** Hears the card's progress at each boot step, as the fraction of the bar done. */
  readonly onBootProgress?: (fraction: number) => void;
  readonly mapId: string | null;
  readonly stagedSave: RestoredSave | null;
  readonly verifiedMap?: VerifiedMapDocuments;
  /** The session once the map's roster is known. A relayed boot ignores the roster: its descriptor was
   *  broadcast whole. */
  readonly sessionFor: (roster: readonly SessionRosterSlot[]) => GameSession;
}

type LoadedMap = Awaited<ReturnType<typeof loadTerrainMap>>;
type LoadedObjects = Awaited<ReturnType<typeof loadMapObjects>>;

/** Everything the presentation half needs from the assembly half. */
export interface AssembledMapWorld<H extends HostedMapWorld = HostedMapWorld> {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly boot: BootProgress;
  readonly plan: MapBootPlan<H>;
  readonly session: GameSession;
  /** Its host is the one object the presentation half and the diag session share. */
  readonly hosted: H;
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet;
  readonly pack: PresentationPack | null;
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
  /** The roster as the session plays it, each seat on the civilization the lobby chose. */
  readonly seatedPlayers: MapScript['players'];
  readonly staticObjects: LoadedObjects | undefined;
  /** The map's shore waves by placement ordinal, the key a script's landscape removal names them by. */
  readonly groundWaves: ReadonlyMap<number, GroundWave>;
}

/**
 * Host the planned world; null when a staged save failed to restore, which halts the boot. A relayed
 * world's failure is its entry's to show, and a world the relay client dropped for a newer one, or on
 * leaving, failed no load: its entry settles it.
 */
export async function hostMapWorld<H extends HostedMapWorld>(
  plan: MapBootPlan<H>,
  documents: MapWorldDocuments,
): Promise<H | null> {
  try {
    return await plan.hostWorld(documents);
  } catch (err) {
    if (plan.stagedSave === null || plan.multiplayer === true || err instanceof WorldNotAdoptedError)
      throw err;
    haltOnFailedRestore(err);
    return null;
  }
}

/** Assemble the map's world up to a sim standing at a tick boundary; null when the boot halted. */
export async function assembleMapWorld<H extends HostedMapWorld>(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  plan: MapBootPlan<H>,
): Promise<AssembledMapWorld<H> | null> {
  const { mapId, stagedSave } = plan;
  const pack = presentationPack(params);
  if (plan.verifiedMap !== undefined && mapId === null) throw new Error('Verified map requires a map id');
  const verified =
    plan.verifiedMap !== undefined && mapId !== null
      ? readVerifiedMapDocuments(plan.verifiedMap, mapId)
      : undefined;
  const boot = mountBootProgress(
    plan.multiplayer === true ? RELAYED_MAP_BOOT_PHASES : MAP_BOOT_PHASES,
    plan.onBootProgress,
  );
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
    const seating = sessionSeating(session, script?.players ?? [], ir ?? {});
    const tribes = worldTribes(
      script === null ? null : { players: seating.players, missions: script.missions },
      loaded?.entities,
      ir ?? {},
      seating.remap,
    );
    await boot.begin('sprites');
    const goods = realContent?.content.goods ?? sandboxGoods();
    // The admin panel's monster presets draw only with their looks loaded; those pages are large, so they
    // load when the admin tools were on at game start.
    const adminCharacterTribes = readStoredSettings().debugToolsEnabled ? [...MONSTER_TRIBES] : [];
    let sheet =
      pack !== null
        ? await pack.spriteSheet(ir, goods, params)
        : await resolveSpriteSheet(goods, tribes, adminCharacterTribes);
    await boot.begin('terrain');
    let terrain: TerrainTextureSet;
    try {
      terrain = pack !== null ? await pack.terrain(app.renderer, ir) : await loadRealTerrain(ir);
    } catch (err) {
      if (!(err instanceof MissingTerrainError)) throw err;
      haltOnMissingContent(err);
      return null;
    }
    await boot.begin('world');
    const hosted = await hostMapWorld(plan, {
      map: loaded,
      ir,
      script,
      goodNames,
      content: realContent?.content ?? null,
      session,
      // `?missions=off` is a local diagnostic; the descriptor carries no such rule, so a relayed
      // world never reads it.
      missions: plan.multiplayer ? null : onOffParam(params, 'missions'),
    });
    if (hosted === null) return null;
    const { host } = hosted;
    if (pack === null && loaded?.entities !== undefined && ir !== null) {
      const { placements } = resolveAuthoredPlacements(loaded.entities, ir, {
        width: loaded.width * 2,
        height: loaded.height * 2,
      });
      const authored = authoredBuildingSheet(sheet, placements, host.snapshot(), ir);
      sheet = authored.sheet;
      if (authored.skipped > 0) {
        diag.warn('content', 'authored building bodies unavailable - falling back', {
          count: authored.skipped,
        });
      }
    }
    const renderer = await createWorldRenderer(app, params, sheet, playerColourOf);
    renderer.setTerrain(terrainGrid, terrain);
    // `embr` accented by elevation hillshade, shared with the placed landscape objects so an object
    // cannot disagree with the ground under it.
    const brightness = renderer.brightnessField();
    // A partial `content/`, such as a missing atlas PNG, degrades to bare ground instead of crashing.
    await boot.begin('objects');
    let staticObjects: LoadedObjects | undefined;
    let groundWaves: ReadonlyMap<number, GroundWave> = new Map();
    if (loaded?.objects !== undefined && ir !== null) {
      try {
        const loadedObjects = pack
          ? await pack.mapObjects(app.renderer, loaded.objects, ir, elevation)
          : await loadMapObjects(loaded.objects, ir, elevation, brightness);
        renderer.setMapObjects(loadedObjects.sprites);
        // Assigned only after the layer accepted the sprites: static refs against an empty layer would
        // leave every virgin node invisible until first touch.
        staticObjects = loadedObjects;
      } catch (err) {
        diag.warn('content', `map objects unavailable, bare ground fallback: ${String(err)}`);
      }
      // The swarms and waves are dressing: losing either must not cost the map its objects.
      try {
        // The ambient swarms are original art, so a presentation pack's world goes without them.
        if (pack === null && loaded.entities !== undefined) {
          renderer.addMapObjects(await loadAmbientCreatures(loaded.entities.animals, ir, elevation));
        }
      } catch (err) {
        diag.warn('content', `ambient creatures unavailable: ${String(err)}`);
      }
      try {
        // The waves only shift the ground already drawn, so they apply under a presentation pack too.
        const loadedWaves = await loadGroundWaves(loaded.objects, ir, elevation);
        renderer.setGroundWaves(loadedWaves.waves);
        groundWaves = loadedWaves.byPlacement;
      } catch (err) {
        diag.warn('content', `shore waves unavailable: ${String(err)}`);
      }
    }
    renderer.setWeatherSeed(hosted.seed);
    setDiagGameSession({
      entry: 'map',
      worldId: mapId,
      seed: hosted.seed,
      restoredAtTick: stagedSave !== null ? host.tick : null,
      host,
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
      hosted,
      renderer,
      sheet,
      pack,
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
      seatedPlayers: seating.players,
      staticObjects,
      groundWaves,
    };
  } finally {
    if (!assembled) app.destroy(false, { children: true });
  }
}
