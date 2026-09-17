import {
  type ContentSet,
  type MapDiplomacy,
  type MapScript,
  type MapSpecialItem,
  type TerrainMapFile,
  WERESNAKE_TRIBE,
  WEREWOLF_TRIBE,
} from '@open-northland/data';
import type { SessionRules } from '@open-northland/lockstep';
import {
  components,
  type Entity,
  FOG_MODE,
  halfCellMapFromCells,
  restoreSimulation,
  type SaveGame,
  type Simulation,
  type TerrainMap,
} from '@open-northland/sim';
import { buildCollisionTerrain } from '../../content/collision.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { buildScriptLandscapeTerrain } from '../../content/script-landscape.js';
import { playerTribe } from '../../game/map-roster.js';
import { setupPlacementTribes } from '../../game/placement-tribes.js';
import {
  mapResourceObjectNames,
  resolveWorldContent,
  spawnMapBerryBushes,
  spawnMapChests,
  spawnMapGroundGoods,
  spawnMapResources,
  type WorldContentOptions,
} from '../../game/sandbox/index.js';
import { applySessionRuleOverrides } from '../../game/session-rules.js';
import { grantStartingPapers } from '../../game/starting-papers.js';
import {
  authoredCatalogExtras,
  demoWorldBase,
  type MapScriptWorld,
  resolveAuthoredPlacements,
  runAuthoredMap,
  runBareMap,
  runDemoWorld,
} from '../../game/world/index.js';
import { grantAssistantDefaults } from '../../view/assistant-grants.js';

/**
 * The world the `?map=` entry plays on, assembled from decoded map data alone. It needs no renderer or
 * canvas, so the headless real-content harness builds the same world the browser boots on.
 */

export type MapWorldKind = 'authored' | 'bare' | 'demo';

export interface MapWorldOptions extends SessionRules {
  readonly missions?: boolean | null;
  readonly diplomacy?: readonly MapDiplomacy[];
  /** Groups of players that explore through one fog mask, the lobby's teams. */
  readonly sharedVision?: readonly (readonly number[])[];
  readonly matchVictory?: 'script' | 'elimination';
  readonly seed: number;
  /** The decoded `content/maps/<id>.json` grid, or null when no map id resolved. */
  readonly map: TerrainMapFile | null;
  /** The served content IR. Null degrades to the raw cell grid, which the `?map=` entry never reaches:
   *  it halts on the missing terrain set first. */
  readonly ir: ContentIr | null;
  readonly content: WorldContentOptions;
  readonly aiSeats: readonly number[];
  readonly playerRoster?: MapScript['players'];
  /** Seats whose chest-window assistant grants start on. */
  readonly assistantSeats: readonly number[];
  /** Override the authored participant roster; an empty list runs no match. */
  readonly matchParticipants?: readonly number[];
  /** The map script's authored `specialItems` rows, the papers each player starts with. */
  readonly specialItems?: readonly MapSpecialItem[];
  /** What the map's script contributes: the authored `diplomacy` rows (omitted or empty keeps every
   *  player pair hostile) and the resolved mission triggers, which run unless explicitly disabled. */
  readonly script?: MapScriptWorld;
  /** Owner of the demo strip's entities, reached only when no map decodes; omitted leaves them neutral. */
  readonly demoOwner?: number;
  /** True as the entry runs it. The headless harness turns bushes off for scenarios that ignore food. */
  readonly berryBushes?: boolean;
}

export interface MapWorld {
  readonly sim: Simulation;
  readonly kind: MapWorldKind;
  /** Each spawned harvestable's placement ordinal in the map's object list: the join back to the static
   *  layer's sprite for that placement. */
  readonly harvestablePlacements: readonly (readonly [Entity, number])[];
  /** The chest and ground-goods placements, whose entities the sim draws from tick zero. */
  readonly pooledPlacements: readonly number[];
}

/** Placements are queued commands: one tick drains them, so the start-camera focus sees entities a
 *  0-tick snapshot would not, while leaving the spawned settlers at their start. */
const PLACEMENT_DRAIN_TICKS = 1;

/** The tribes whose computer seats get the scripted handler alone: the original's AI manager
 *  (`an original routine`) withholds the strategic handler from a `PLAYER_TYPE_AI` seat of either. */
const TRIBES_WITHOUT_STRATEGIC_AI: ReadonlySet<number> = new Set([WERESNAKE_TRIBE, WEREWOLF_TRIBE]);

/** Session rules and visibility are applied before the briefing can pause the world. */
export function buildMapWorld(options: MapWorldOptions): MapWorld {
  const terrain = collisionTerrain(options.map, options.ir, options.script?.missions !== undefined);
  const { sim, kind } = runWorld(options, terrain);
  setupPlacementTribes(sim, options.playerRoster);
  applySessionRules(sim, options);
  const { harvestablePlacements, pooledPlacements } = spawnHarvestables(sim, options);
  sim.step();
  return { sim, kind, harvestablePlacements, pooledPlacements };
}

/** Harvestable placements stay out of the static bake: they spawn as `Resource` entities whose
 *  footprints unblock when felled. */
function collisionTerrain(
  map: TerrainMapFile | null,
  ir: ContentIr | null,
  scripted: boolean,
): TerrainMap | null {
  if (map === null) return null;
  if (scripted && ir !== null) return buildScriptLandscapeTerrain(map, ir);
  return ir === null
    ? halfCellMapFromCells({
        ...map,
        ...(map.continents !== undefined ? { waterContinents: map.continents } : {}),
      })
    : buildCollisionTerrain(map, ir, mapResourceObjectNames(ir));
}

function runWorld(
  options: MapWorldOptions,
  terrain: TerrainMap | null,
): { sim: Simulation; kind: MapWorldKind } {
  const { map, ir, seed, content } = options;
  if (terrain === null) {
    const demo = { ...content, ...(options.demoOwner !== undefined ? { owner: options.demoOwner } : {}) };
    return { sim: runDemoWorld(seed, PLACEMENT_DRAIN_TICKS, undefined, demo), kind: 'demo' };
  }
  const script = {
    ...options.script,
    ...(options.diplomacy !== undefined ? { diplomacy: options.diplomacy } : {}),
  };
  if (map?.entities !== undefined && ir !== null) {
    const authored = runAuthoredMap(seed, PLACEMENT_DRAIN_TICKS, terrain, map.entities, ir, content, script);
    if (authored !== null) return { sim: authored, kind: 'authored' };
  }
  return { sim: runBareMap(seed, terrain, content, script), kind: 'bare' };
}

function applySessionRules(sim: Simulation, options: MapWorldOptions): void {
  const scripted = options.script?.missions !== undefined && options.missions !== false;
  applySessionRuleOverrides(sim, {
    ...options,
    missions: options.missions ?? (scripted ? true : null),
    fog: options.fog ?? (scripted ? FOG_MODE.REVEAL : null),
  });
  for (const players of options.sharedVision ?? []) sim.enqueueSetup({ kind: 'setSharedVision', players });
  const roster = options.playerRoster === undefined ? null : { players: options.playerRoster };
  for (const seat of options.aiSeats) {
    const authored = options.script?.ai?.find((row) => row.player === seat);
    // `AI_Disable` stops both handlers yet leaves the seat a computer player; `HAI_Disable*` stops
    // the named strategic modules alone, as does a monster tribe.
    const strategicOff = authored?.disabled || TRIBES_WITHOUT_STRATEGIC_AI.has(playerTribe(roster, seat));
    const off = strategicOff ? components.AI_MODULE_IDS : (authored?.strategicOff ?? []);
    sim.enqueueSetup({
      kind: 'setPlayerAi',
      player: seat,
      enabled: true,
      ...(off.length > 0 ? { modules: Object.fromEntries(off.map((id) => [id, false])) } : {}),
      ...(authored?.disabled ? { scripted: false } : {}),
    });
  }
  grantAssistantDefaults(sim, sim.content, options.assistantSeats);
  grantStartingPapers(sim, options.specialItems ?? []);
  const participants = options.matchParticipants ?? (scripted ? options.script?.participants : undefined);
  if (participants !== undefined) {
    sim.enqueueSetup({
      kind: 'setMatchParticipants',
      players: participants,
      victory: options.matchVictory ?? (scripted ? (options.script?.victory ?? 'script') : 'elimination'),
    });
  }
}

/** The world-build inputs a restore reuses: identity only, since placements, session rules, AI seats
 *  and harvestables are already in the saved state. */
export type RestoreWorldOptions = Pick<
  MapWorldOptions,
  'map' | 'ir' | 'content' | 'demoOwner' | 'playerRoster' | 'script'
>;

export interface RestoredMapWorld {
  readonly sim: Simulation;
  readonly kind: MapWorldKind;
}

/**
 * Resolve the exact terrain and content a fresh {@link buildMapWorld} would and restore the save onto
 * them. Throws when the save does not fit the resolved world; app-layer round-trip tests hold both
 * paths to the same resolution.
 */
export function restoreMapWorld(options: RestoreWorldOptions, save: SaveGame): RestoredMapWorld {
  const terrain = collisionTerrain(options.map, options.ir, options.script?.missions !== undefined);
  if (terrain === null) {
    const demo = {
      ...options.content,
      ...(options.demoOwner !== undefined ? { owner: options.demoOwner } : {}),
    };
    const base = demoWorldBase(undefined, demo);
    return { sim: restoreSimulation(save, { content: base.content, map: base.terrain }), kind: 'demo' };
  }
  const authored = authoredWorldContent(terrain, options);
  const ai = options.script?.ai;
  const sim = restoreSimulation(save, {
    content: authored ?? resolveWorldContent(terrain, options.content),
    map: terrain,
    ...(options.script?.missions !== undefined ? { missions: options.script.missions } : {}),
    ...(ai !== undefined && ai.length > 0 ? { aiScript: ai } : {}),
  });
  return { sim, kind: authored !== null ? 'authored' : 'bare' };
}

/** The authored path's content, or null exactly when `runWorld` would fall through to the bare map. */
function authoredWorldContent(terrain: TerrainMap, options: RestoreWorldOptions): ContentSet | null {
  const { map, ir } = options;
  if (map?.entities === undefined || ir === null) return null;
  const { placements } = resolveAuthoredPlacements(map.entities, ir, terrain);
  if (placements.length === 0) return null;
  return resolveWorldContent(terrain, options.content, authoredCatalogExtras(placements, ir));
}

/** Spawned in the map's placement order after the placement tick, so ids mint deterministically behind
 *  the authored buildings and settlers. */
function spawnHarvestables(
  sim: Simulation,
  options: MapWorldOptions,
): Pick<MapWorld, 'harvestablePlacements' | 'pooledPlacements'> {
  const { map, ir } = options;
  if (map?.objects === undefined || ir === null) return { harvestablePlacements: [], pooledPlacements: [] };
  const resources = spawnMapResources(sim, map.objects, ir);
  const chests = spawnMapChests(sim, map.objects, ir);
  const goods = spawnMapGroundGoods(sim, map.objects, ir);
  const bushes =
    options.berryBushes === false ? [] : [...spawnMapBerryBushes(sim, map.objects, ir).placementByEntity];
  return {
    harvestablePlacements: [...resources.placementByEntity, ...bushes],
    pooledPlacements: [...chests.placementByEntity.values(), ...goods.placementByEntity.values()],
  };
}
