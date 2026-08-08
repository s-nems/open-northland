import type { MapDiplomacy, TerrainMapFile } from '@open-northland/data';
import { type Entity, halfCellMapFromCells, type Simulation, type TerrainMap } from '@open-northland/sim';
import { buildCollisionTerrain } from '../../content/collision.js';
import type { ContentIr } from '../../content/ir/rows.js';
import {
  mapResourceObjectNames,
  spawnMapBerryBushes,
  spawnMapResources,
  type WorldContentOptions,
} from '../../game/sandbox/index.js';
import { applySessionRuleOverrides, type SessionRuleOverrides } from '../../game/session-rules.js';
import { runAuthoredMap, runBareMap, runDemoWorld } from '../../game/world/index.js';
import { grantAssistantDefaults } from '../../view/assistant-grants.js';

/**
 * The world the `?map=` entry plays on, assembled from decoded map data alone. It needs no renderer or
 * canvas, so the headless real-content harness builds the same world the browser boots on.
 */

export type MapWorldKind = 'authored' | 'bare' | 'demo';

export interface MapWorldOptions extends SessionRuleOverrides {
  readonly seed: number;
  /** The decoded `content/maps/<id>.json` grid, or null when no map id resolved. */
  readonly map: TerrainMapFile | null;
  /** The served content IR. Null degrades to the raw cell grid, which the `?map=` entry never reaches:
   *  it halts on the missing terrain set first. */
  readonly ir: ContentIr | null;
  readonly content: WorldContentOptions;
  readonly aiSeats: readonly number[];
  /** Seats whose chest-window assistant grants start on. */
  readonly assistantSeats: readonly number[];
  /** The map script's authored `diplomacy` rows; omitted or empty keeps every player pair hostile. */
  readonly diplomacy?: readonly MapDiplomacy[];
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
}

/** Placements are queued commands: one tick drains them, so the start-camera focus sees entities a
 *  0-tick snapshot would not, while leaving the spawned settlers at their start. */
const PLACEMENT_DRAIN_TICKS = 1;

/** The returned sim sits at a tick boundary with every setup command enqueued. */
export function buildMapWorld(options: MapWorldOptions): MapWorld {
  const terrain = collisionTerrain(options.map, options.ir);
  const { sim, kind } = runWorld(options, terrain);
  applySessionRules(sim, options);
  return { sim, kind, harvestablePlacements: spawnHarvestables(sim, options) };
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
}

/** Spawned in the map's placement order after the placement tick, so ids mint deterministically behind
 *  the authored buildings and settlers. */
function spawnHarvestables(
  sim: Simulation,
  options: MapWorldOptions,
): readonly (readonly [Entity, number])[] {
  const { map, ir } = options;
  if (map?.objects === undefined || ir === null) return [];
  const resources = spawnMapResources(sim, map.objects, ir);
  if (options.berryBushes === false) return [...resources.placementByEntity];
  const bushes = spawnMapBerryBushes(sim, map.objects, ir);
  return [...resources.placementByEntity, ...bushes.placementByEntity];
}
