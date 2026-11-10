import type {
  ContentSet,
  MapDiplomacy,
  MapScript,
  MapSpecialItem,
  MapVariantLandscapeObject,
  TerrainMapFile,
} from '@open-northland/data';
import {
  components,
  type Entity,
  FOG_MODE,
  halfCellMapFromCells,
  restoreSimulation,
  type SaveGame,
  type Simulation,
  type TerrainMap,
  TICKS_PER_MINUTE,
  warmWorldIndexes,
} from '@open-northland/sim';
import type { ContentIr } from '../../content/ir/rows.js';
import { spawnMapPalisades } from '../../content/map/palisades.js';
import { buildScriptLandscapeTerrain } from '../../content/map/script-landscape.js';
import { playerTribe } from '../../game/map/roster.js';
import { grantStartingPapers } from '../../game/map/starting-papers.js';
import { resolveAiControlPolicy } from '../../game/match/ai-control-policy.js';
import type { SeatTribeRemap } from '../../game/match/seat-tribes.js';
import { applySessionRuleOverrides, type SimSessionRules } from '../../game/match/session-rules.js';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import {
  resolveWorldContent,
  spawnMapBerryBushes,
  spawnMapChests,
  spawnMapFields,
  spawnMapGroundGoods,
  spawnMapResources,
  spawnVariantLandscapeObjects,
  type WorldContentOptions,
} from '../../game/sandbox/index.js';
import {
  authoredCatalogExtras,
  demoWorldBase,
  type MapScriptWorld,
  resolveAuthoredPlacements,
  runAuthoredMap,
  runBareMap,
  runDemoWorld,
  setupPlacementTribes,
  withNeutralRosterPairs,
} from '../../game/world/index.js';
import { grantAssistantDefaults } from '../../view/assistant/grants.js';

/**
 * The world the `?map=` entry plays on, assembled from decoded map data alone. It needs no renderer or
 * canvas, so the headless real-content harness builds the same world the browser boots on.
 */

export type MapWorldKind = 'authored' | 'bare' | 'demo';

export interface MapWorldOptions extends SimSessionRules {
  readonly missions?: boolean | null;
  readonly diplomacy?: readonly MapDiplomacy[];
  readonly seed: number;
  /** The decoded `content/maps/<id>.json` grid, or null when no map id resolved. */
  readonly map: TerrainMapFile | null;
  /** The served content IR. Null degrades to the raw cell grid, which the `?map=` entry never reaches:
   *  it halts on the missing terrain set first. */
  readonly ir: ContentIr | null;
  readonly content: WorldContentOptions;
  readonly machineSeats: readonly number[];
  /** Seats whose authored placements and walls the world leaves out. */
  readonly absentSeats?: readonly number[];
  /** Seats nobody plays that stand on the map, which its script feeds nothing like the absent ones. */
  readonly idleSeats?: readonly number[];
  /** The seats the session's {@link SimSessionRules.peace} binds; an absent seat among them is dropped. */
  readonly peaceSeats?: readonly number[];
  /** Computer seats that enable all modules their tribe supports instead of the map’s toggles. */
  readonly computerSeats?: readonly number[];
  /** How hard each computer seat the session names plays; an unnamed one plays hard. */
  readonly computerDifficulties?: ReadonlyMap<number, components.ComputerDifficulty>;
  readonly playerRoster?: MapScript['players'];
  /** The tribes a changed seat's authored placements take; the map's own when omitted. */
  readonly seatTribes?: SeatTribeRemap;
  /** Seats whose assistant grants start on, excluding machine seats without autonomous control. */
  readonly assistantSeats: readonly number[];
  /** Override the authored participant roster; an empty list runs no match. */
  readonly matchParticipants?: readonly number[];
  /** The map script's authored `specialItems` rows, the papers each player starts with. */
  readonly specialItems?: readonly MapSpecialItem[];
  /** What the map's script contributes: the authored `diplomacy` rows (a roster pair they leave unset
   *  starts neutral, and a world without a roster keeps every pair hostile) and the resolved mission
   *  triggers, which run unless explicitly disabled. */
  readonly script?: MapScriptWorld;
  /** Owner of the demo strip's entities, reached only when no map decodes; omitted leaves them neutral. */
  readonly demoOwner?: number;
  /** True as the entry runs it. The headless harness turns bushes off for scenarios that ignore food. */
  readonly berryBushes?: boolean;
  /** The map variant's deposit yield factors by content good id; a good it leaves out keeps its yield. */
  readonly depositYield?: Readonly<Record<string, number>>;
  /** The map variant's own harvestable objects, placed after the map's. */
  readonly landscapeObjects?: readonly MapVariantLandscapeObject[];
}

export interface MapWorld {
  readonly sim: Simulation;
  readonly kind: MapWorldKind;
  /** Each spawned harvestable's placement ordinal in the map's object list: the join back to the static
   *  layer's sprite for that placement. */
  readonly harvestablePlacements: readonly (readonly [Entity, number])[];
  /** Fields, chests and ground-goods placements, whose entities the sim draws from tick zero. */
  readonly pooledPlacements: readonly number[];
}

/** Placements are queued commands: one tick drains them, so the start-camera focus sees entities a
 *  0-tick snapshot would not, while leaving the spawned settlers at their start. */
const PLACEMENT_DRAIN_TICKS = 1;

/** Session rules and visibility are applied before the briefing can pause the world. */
export function buildMapWorld(options: MapWorldOptions): MapWorld {
  const absent = new Set([
    ...(options.absentSeats ?? []),
    ...(options.playerRoster ?? []).filter((slot) => slot.type === 'none').map((slot) => slot.player),
  ]);
  options = {
    ...options,
    absentSeats: [...absent],
    machineSeats: options.machineSeats.filter((seat) => !absent.has(seat)),
    assistantSeats: options.assistantSeats.filter((seat) => !absent.has(seat)),
  };
  const terrain = collisionTerrain(options.map, options.ir);
  const { sim, kind } = runWorld(options, terrain);
  setupPlacementTribes(sim, options.playerRoster);
  applySessionRules(sim, options);
  const { harvestablePlacements, pooledPlacements } = spawnHarvestables(sim, options);
  sim.step();
  warmWorldIndexes(sim);
  enableScript(sim, options);
  return { sim, kind, harvestablePlacements, pooledPlacements };
}

/** Whether the world runs its map's `[MissionData]` script; `?missions=off` keeps it off. */
function scriptedWorld(options: MapWorldOptions): boolean {
  return options.script?.missions !== undefined && options.missions !== false;
}

/** Enqueued after the boot step, so the script's load pass runs on the first live tick, where the
 *  frame loop collects its opening briefing; a boot tick's events reach nobody. */
function enableScript(sim: Simulation, options: MapWorldOptions): void {
  const enabled = options.missions ?? (scriptedWorld(options) ? true : null);
  if (enabled !== null) sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled });
}

/** With content, the base grid bakes only ground classes and the map objects keep their own collision,
 *  so a felled tree or a razed wall frees its ground. */
function collisionTerrain(map: TerrainMapFile | null, ir: ContentIr | null): TerrainMap | null {
  if (map === null) return null;
  if (ir !== null) return buildScriptLandscapeTerrain(map, ir);
  return halfCellMapFromCells({
    ...map,
    ...(map.continents !== undefined ? { waterContinents: map.continents } : {}),
    ...(map.roughness !== undefined ? { roughness: map.roughness } : {}),
  });
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
  const rows = options.diplomacy ?? options.script?.diplomacy ?? [];
  const roster = (options.playerRoster ?? []).map((row) => row.player);
  const script = { ...options.script, diplomacy: withNeutralRosterPairs(roster, rows) };
  if (map?.entities !== undefined && ir !== null) {
    const authored = runAuthoredMap(
      seed,
      PLACEMENT_DRAIN_TICKS,
      terrain,
      map.entities,
      ir,
      content,
      script,
      options.absentSeats,
      options.seatTribes,
    );
    if (authored !== null) return { sim: authored, kind: 'authored' };
  }
  return { sim: runBareMap(seed, terrain, content, script), kind: 'bare' };
}

function applySessionRules(sim: Simulation, options: MapWorldOptions): void {
  const scripted = scriptedWorld(options);
  applySessionRuleOverrides(sim, {
    fog: options.fog ?? (scripted ? FOG_MODE.CLASSIC : null),
    progression: options.progression,
    needs: options.needs,
    alliedVision: options.alliedVision,
  });
  const computerDisabled = new Set<number>();
  for (const seat of options.machineSeats) {
    const control = resolveAiControlPolicy(
      seat,
      options.playerRoster ?? [],
      options.script,
      options.computerSeats?.includes(seat) === true ? 'computer' : 'map-ai',
    );
    if (
      control.computerEnabled === false ||
      components.COMPUTER_MODULE_IDS.every((id) => control.modules?.[id] === false)
    )
      computerDisabled.add(seat);
    const difficulty = options.computerDifficulties?.get(seat);
    sim.enqueueSetup({
      kind: 'setAiControl',
      player: seat,
      enabled: true,
      ...control,
      ...(difficulty === undefined ? {} : { difficulty }),
    });
  }
  // Original behavior: the assistant's switches start off for every player and only a chest-window
  // command turns them on, so no computer seat ever sends its people for gear. This build starts them
  // on for the seats a person or the computer player controls; a map AI camp keeps them off.
  grantAssistantDefaults(
    sim,
    sim.content,
    options.assistantSeats.filter((seat) => !computerDisabled.has(seat)),
  );
  grantStartingPapers(sim, options.specialItems ?? []);
  openPeace(sim, options);
  const unplayed = [...(options.absentSeats ?? []), ...(options.idleSeats ?? [])];
  if (unplayed.length > 0) sim.enqueueSetup({ kind: 'setUnplayedSeats', players: unplayed });
  const participants = (
    options.matchParticipants ?? (scripted ? options.script?.participants : undefined)
  )?.filter((seat) => !options.absentSeats?.includes(seat));
  if (participants !== undefined) {
    const script = options.script;
    const goals =
      script?.victory === 'goals' ? (scripted ? script.goals : script.scriptlessGoals) : undefined;
    const victory = goals !== undefined ? 'goals' : scripted ? (script?.victory ?? 'script') : 'elimination';
    sim.enqueueSetup({
      kind: 'setMatchParticipants',
      players: participants,
      victory,
      ...(victory === 'goals' && goals !== undefined ? { goals, goalSeats: immortalSeats(options) } : {}),
    });
  }
}

/** The lobby peace from the match start; no rule, or no seat left to bind, enqueues nothing. */
function openPeace(sim: Simulation, options: MapWorldOptions): void {
  if (options.peace === null) return;
  const players = (options.peaceSeats ?? []).filter((seat) => !options.absentSeats?.includes(seat));
  if (players.length === 0) return;
  const untilTick = options.peace * TICKS_PER_MINUTE;
  sim.enqueueSetup({ kind: 'setPeaceTime', untilTick, players });
}

/** The map's seats that cannot die and are on the map: no participants, yet a goal row can decide them. */
function immortalSeats(options: MapWorldOptions): number[] {
  const absent = new Set(options.absentSeats);
  const roster = new Set((options.playerRoster ?? []).map((row) => row.player));
  return (options.script?.neverDies ?? []).filter((seat) => roster.has(seat) && !absent.has(seat));
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
  const terrain = collisionTerrain(options.map, options.ir);
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
    ...(ai !== undefined && ai.length > 0 ? { mapAiScript: ai } : {}),
    ...(options.script?.escalation !== undefined ? { mapEscalation: options.script.escalation } : {}),
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
  const resources = spawnMapResources(sim, map.objects, ir, options.depositYield);
  const fields = spawnMapFields(sim, map.objects, ir);
  const chests = spawnMapChests(sim, map.objects, ir);
  const goods = spawnMapGroundGoods(sim, map.objects, ir);
  const roster = options.playerRoster === undefined ? null : { players: options.playerRoster };
  const palisades = spawnMapPalisades(
    sim,
    map.objects,
    ir,
    (owner) => (owner === undefined ? PRIMARY_TRIBE : playerTribe(roster, owner)),
    new Set(options.absentSeats),
  );
  const bushes = options.berryBushes === false ? null : spawnMapBerryBushes(sim, map.objects, ir);
  spawnVariantLandscapeObjects(sim, ir, options.landscapeObjects ?? [], options.depositYield);
  return {
    harvestablePlacements: [...resources.placementByEntity, ...(bushes?.placementByEntity ?? [])],
    pooledPlacements: [
      ...fields.retiredPlacements,
      ...(bushes?.retiredPlacements ?? []),
      ...chests.placementByEntity.values(),
      ...goods.placementByEntity.values(),
      ...palisades,
    ],
  };
}
