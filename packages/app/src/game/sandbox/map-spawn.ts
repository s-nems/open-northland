import type { TerrainObjects } from '@open-northland/data';
import { type Entity, type Simulation, systems } from '@open-northland/sim';
import type { ContentIr } from '../../content/ir.js';
import {
  mapBerryBushSpawns,
  mapResourceSpawns,
  simResourceObjectNames,
} from '../../content/map-resources.js';
import { GATHERERS, type GathererSpec } from './ids.js';
import { resourceSpecFor } from './place.js';

/**
 * Spawn the harvestable resources a DECODED MAP's placed objects define as real sim entities — the
 * `?map=` entry's join from the static object layer (trees/ore/stone/bushes drawn once) to live
 * `Resource`/`BerryBush` nodes a settler can work. Distinct from the scene-setup helpers in
 * {@link import('./place.js')}: those author a hand-placed world, these read a real map's objects. Both
 * assemble nodes DIRECTLY (the sanctioned pre-tick-0 `sim.world` exception) and share
 * {@link resourceSpecFor} for the gatherer-good → node-spec resolution.
 */

/** The goods a real gatherer trade exists for — the {@link GATHERERS} ids. A decoded-map object whose good
 *  is outside this set (a harvestable the app has no collector for yet) stays render-only decor. */
const SPAWNABLE_GOOD_IDS: ReadonlySet<string> = new Set(GATHERERS.map((g) => g.id));

/** A `goodId` string → its {@link GathererSpec} (the map-resource join returns pipeline goodId strings, the
 *  bridge across the IR's original good numbering and the app's clean-room ids). */
const GATHERER_BY_GOOD_ID: ReadonlyMap<string, GathererSpec> = new Map(GATHERERS.map((g) => [g.id, g]));

/**
 * The object EditNames this app spawns as sim resources — the set the STATIC collision join must skip
 * ({@link import('../../content/collision.js').buildCollisionTerrain} `skipObjectNames`), so a felled
 * node's blocking vanishes with its dynamic footprint instead of being baked into the grid forever.
 */
export function mapResourceObjectNames(ir: ContentIr): ReadonlySet<string> {
  return simResourceObjectNames(ir, SPAWNABLE_GOOD_IDS);
}

/** What {@link spawnMapResources} made: the node count plus each spawned ENTITY's placement ordinal in
 *  `objects.placements` — the join back to the static layer's drawn sprite for the same placement, so the
 *  `?map=` entry can hand a first-worked node from the built-once static layer to the live sprite pool. */
export interface MapResourceSpawnResult {
  readonly spawned: number;
  readonly placementByEntity: ReadonlyMap<Entity, number>;
}

/**
 * Spawn every harvestable resource node a decoded map's placed objects define (trees → wood, ore outcrops →
 * iron/gold, clay/stone → mud/stone) as real `Resource` sim nodes — the SAME component set the admin
 * `placeResource` builds (Position + Resource + footprint + Felling|MineDeposit), assembled DIRECTLY here as
 * scene setup pre-tick-0 (the sanctioned exception, like {@link import('./place.js').placeResourceNode}). This
 * is what makes a map's own trees hoverable + gatherable (plan `gathering-economy.md` step 6); before it, only
 * an admin-spawned node was ever a real sim entity.
 *
 * The nodes are created in the map's native placement order, so ids are minted deterministically. Yields
 * and fell/mine parameters reuse the gatherer catalog defaults (`resourceSpecFor`) — the map's per-placement
 * growth `levels` lane is not yet mapped to a starting amount (a named approximation, same defaults an
 * admin-spawned node uses). Each spawn carries its placement's OWN harvest-stage `gfxIndex` (the species
 * variant), so a node the sprite pool draws (a worked/handed-over one) keeps the exact original graphic. A
 * placement whose good has no gatherer trade or whose good has no footprint is skipped, not fatal (unlike
 * the throwing scene helper).
 */
export function spawnMapResources(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  let unspawnable = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { goodId, gfxIndex, hx, hy, placement } of mapResourceSpawns(objects, ir, SPAWNABLE_GOOD_IDS)) {
    const g = GATHERER_BY_GOOD_ID.get(goodId);
    if (g === undefined) continue; // filtered by SPAWNABLE_GOOD_IDS already, but keep the type honest
    const spec = { ...resourceSpecFor(g, hx, hy), gfxIndex };
    const e = systems.createResourceNode(sim.world, sim.content, spec);
    if (e !== null) {
      spawned++;
      placementByEntity.set(e, placement);
    } else {
      unspawnable++;
    }
  }
  if (unspawnable > 0) {
    // A latent collision hole: these placements were SKIPPED from the static collision bake
    // (mapResourceObjectNames) on the promise of a dynamic footprint that never materialised (the
    // good has no footprint record in the sim content) — a drawn object settlers walk through.
    console.warn(
      `spawnMapResources: ${unspawnable} harvestable placements failed to spawn (no sim-content footprint) — they block nothing`,
    );
  }
  return { spawned, placementByEntity };
}

/**
 * Spawn every forageable berry bush a decoded map's placed objects define (fruited-bush objects →
 * ripe {@link components.BerryBush} entities), assembled DIRECTLY here as pre-tick-0 scene setup (the
 * sanctioned exception, like {@link spawnMapResources}). This is what makes a map's own bushes actual
 * wild food a hungry settler forages; before it, "bush NN fruits" was pure render decor.
 *
 * Bushes carry no footprint (walkable in the original), so — unlike {@link spawnMapResources} — nothing
 * is skipped from the static collision bake; the placement join is purely for the render handover (the
 * static layer keeps drawing the fruited bush until it is first foraged). Created in native placement
 * order, so ids mint deterministically. Each carries its placement's fruited-bush `gfxIndex`.
 */
export function spawnMapBerryBushes(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { gfxIndex, hx, hy, placement } of mapBerryBushSpawns(objects, ir)) {
    const e = systems.createBerryBush(sim.world, { x: hx, y: hy, gfxIndex });
    placementByEntity.set(e, placement);
    spawned++;
  }
  return { spawned, placementByEntity };
}
