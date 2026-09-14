import type {
  ContentSet,
  MapDiplomacy,
  MapScript,
  MapSpecialItem,
  TerrainMapFile,
} from '@open-northland/data';
import type { SessionRules } from '@open-northland/lockstep';
import {
  type Entity,
  halfCellMapFromCells,
  restoreSimulation,
  type SaveGame,
  type Simulation,
  type TerrainMap,
} from '@open-northland/sim';
import { buildCollisionTerrain } from '../../content/collision.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { setupPlacementTribes } from '../../game/placement-tribes.js';
import {
  mapResourceObjectNames,
  resolveWorldContent,
  spawnMapBerryBushes,
  spawnMapChests,
  spawnMapResources,
  type WorldContentOptions,
} from '../../game/sandbox/index.js';
import { applySessionRuleOverrides } from '../../game/session-rules.js';
import { grantStartingPapers } from '../../game/starting-papers.js';
import {
  authoredCatalogExtras,
  demoWorldBase,
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
  /** The seats that can win or lose the skirmish; omitted or empty runs no match. */
  readonly matchParticipants?: readonly number[];
  /** The map script's authored `diplomacy` rows; omitted or empty keeps every player pair hostile. */
  readonly diplomacy?: readonly MapDiplomacy[];
  /** The map script's authored `specialItems` rows, the papers each player starts with. */
  readonly specialItems?: readonly MapSpecialItem[];
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
  readonly chestPlacements: readonly number[];
}

/** Placements are queued commands: one tick drains them, so the start-camera focus sees entities a
 *  0-tick snapshot would not, while leaving the spawned settlers at their start. */
const PLACEMENT_DRAIN_TICKS = 1;

/** Session rules and visibility are applied before the briefing can pause the world. */
export function buildMapWorld(options: MapWorldOptions): MapWorld {
  const terrain = collisionTerrain(options.map, options.ir);
  const { sim, kind } = runWorld(options, terrain);
  setupPlacementTribes(sim, options.playerRoster);
  applySessionRules(sim, options);
  const { harvestablePlacements, chestPlacements } = spawnHarvestables(sim, options);
  sim.step();
  return { sim, kind, harvestablePlacements, chestPlacements };
}

/** Harvestable placements stay out of the static bake: they spawn as `Resource` entities whose
 *  footprints unblock when felled. */
function collisionTerrain(map: TerrainMapFile | null, ir: ContentIr | null): TerrainMap | null {
  if (map === null) return null;
  return ir === null ? halfCellMapFromCells(map) : buildCollisionTerrain(map, ir, mapResourceObjectNames(ir));
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
  const diplomacy = options.diplomacy ?? [];
  if (map?.entities !== undefined && ir !== null) {
    const authored = runAuthoredMap(
      seed,
      PLACEMENT_DRAIN_TICKS,
      terrain,
      map.entities,
      ir,
      content,
      diplomacy,
    );
    if (authored !== null) return { sim: authored, kind: 'authored' };
  }
  return { sim: runBareMap(seed, terrain, content, diplomacy), kind: 'bare' };
}

function applySessionRules(sim: Simulation, options: MapWorldOptions): void {
  applySessionRuleOverrides(sim, options);
  for (const seat of options.aiSeats) {
    sim.enqueueSetup({ kind: 'setPlayerAi', player: seat, enabled: true });
  }
  grantAssistantDefaults(sim, sim.content, options.assistantSeats);
  grantStartingPapers(sim, options.specialItems ?? []);
  if (options.matchParticipants !== undefined && options.matchParticipants.length > 0) {
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: options.matchParticipants });
  }
}

/** The world-build inputs a restore reuses: identity only, since placements, session rules, AI seats
 *  and harvestables are already in the saved state. */
export type RestoreWorldOptions = Pick<
  MapWorldOptions,
  'map' | 'ir' | 'content' | 'demoOwner' | 'playerRoster'
>;

export interface RestoredMapWorld {
  readonly sim: Simulation;
  readonly kind: MapWorldKind;
  /** True when the save's conversion revision differs from the loaded content's; presentation-only. */
  readonly contentRevisionDiffers: boolean;
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
    const restored = restoreSimulation(save, { content: base.content, map: base.terrain });
    return { ...restored, kind: 'demo' };
  }
  const authored = authoredWorldContent(terrain, options);
  const restored = restoreSimulation(save, {
    content: authored ?? resolveWorldContent(terrain, options.content),
    map: terrain,
  });
  return { ...restored, kind: authored !== null ? 'authored' : 'bare' };
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
): Pick<MapWorld, 'harvestablePlacements' | 'chestPlacements'> {
  const { map, ir } = options;
  if (map?.objects === undefined || ir === null) return { harvestablePlacements: [], chestPlacements: [] };
  const resources = spawnMapResources(sim, map.objects, ir);
  const chests = spawnMapChests(sim, map.objects, ir);
  const bushes =
    options.berryBushes === false ? [] : [...spawnMapBerryBushes(sim, map.objects, ir).placementByEntity];
  return {
    harvestablePlacements: [...resources.placementByEntity, ...bushes],
    chestPlacements: [...chests.placementByEntity.values()],
  };
}
