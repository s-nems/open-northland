import type { TerrainObjects } from '@open-northland/data';
import { type Entity, type ResourceNodeSpec, type Simulation, systems } from '@open-northland/sim';
import type { ContentIr } from '../../content/ir/rows.js';
import {
  type MapResourceSpawn,
  mapBerryBushSpawns,
  mapResourceSpawns,
  simResourceObjectNames,
} from '../../content/map-resources.js';
import { diag } from '../../diag/index.js';
import { GATHERERS, type GathererSpec } from './ids/index.js';
import { resourceSpecFor } from './place/index.js';

/**
 * Spawn the harvestable resources a decoded map's placed objects define as real sim entities - the
 * `?map=` entry's join from the static object layer (trees/ore/stone/bushes drawn once) to live
 * `Resource`/`BerryBush` nodes a settler can work. Distinct from the scene-setup helpers in
 * {@link import('./place/index.js')}: those author a hand-placed world, these read a real map's objects. Both
 * assemble nodes directly (the sanctioned pre-tick-0 `sim.world` exception) and share
 * {@link resourceSpecFor} for the gatherer-good → node-spec resolution.
 */

/** The goods a real gatherer trade exists for - the {@link GATHERERS} ids. A decoded-map object whose good
 *  is outside this set (a harvestable the app has no collector for yet) stays render-only decor. */
const SPAWNABLE_GOOD_IDS: ReadonlySet<string> = new Set(GATHERERS.map((g) => g.id));

/** A `goodId` string → its {@link GathererSpec} (the map-resource join returns pipeline goodId strings, the
 *  bridge across the IR's original good numbering and the app's hand-authored ids). */
const GATHERER_BY_GOOD_ID: ReadonlyMap<string, GathererSpec> = new Map(GATHERERS.map((g) => [g.id, g]));

/**
 * The object EditNames this app spawns as sim resources - the set the static collision join must skip
 * ({@link import('../../content/collision.js').buildCollisionTerrain} `skipObjectNames`), so a felled
 * node's blocking vanishes with its dynamic footprint instead of being baked into the grid forever.
 */
export function mapResourceObjectNames(ir: ContentIr): ReadonlySet<string> {
  return simResourceObjectNames(ir, SPAWNABLE_GOOD_IDS);
}

/**
 * The starting yield a deposit placement authored below full spawns with: its 1-based `lmlv` `level` of
 * `states` authored states, scaled onto the deposit's full `units`. Floored rather than rounded, because
 * the render's fill bucket rounds up - flooring puts the node back on the exact state the static object
 * layer drew for it. Over a record-sized deposit ({@link withRecordDeposit}) the scaling is the identity,
 * `units === states`; it only rescales the catalog fallback, whose count is unrelated to the record's.
 *
 * source basis: `lmlv` is a live per-placement valency, not decor variety - `[GfxLandscape]` keys each
 * frame list by an explicit valency value (see {@link withRecordDeposit}), which is only meaningful if
 * the lane it selects on is a quantity.
 */
export function authoredDepositUnits(units: number, level: number, states: number): number {
  return Math.min(units, Math.max(1, Math.floor((units * level) / states)));
}

/**
 * Size a mined placement's deposit from its own `[GfxLandscape]` record and start it at the authored
 * `lmlv` level, so level L spawns exactly L units on state L and the decal keeps predicting the yield all
 * the way down. A record with no valency - and every admin/scene spawn, which has no record at all -
 * keeps the catalog size from `catalog/mining.ts`.
 *
 * source basis: readable semantics, scoped. `LogicMaximumValency` is a capacity, not a stated unit count -
 * `wall_01` keys 5 frame lists at 80/60/40/20/1 against a valency of 100, where a step is hitpoints.
 * Reading it as units holds only for a record authoring one fill state per valency step, which every mined
 * record does (`maxValency === frames.length` across all 32: gold/iron/clay mines 5, stone rocks 4 or 5)
 * and which the pileable ore records state outright - `gold ore 01` is `logicispileableonmap` at valency 5
 * over 5 states, the same "state ≡ remaining units" read a dropped pile's `DrawItem.fill` already uses.
 * The equality is pinned over real content by `test/content/ir-invariants.test.ts`; a record that broke it
 * would put the sprite pool and the static object layer on different frames for the same placement.
 *
 * `initial` is the full size rather than the starting `remaining`, so a part-mined deposit's decal
 * continues from the state the static layer drew instead of snapping to near-full on the first chip.
 */
function withRecordDeposit(spec: ResourceNodeSpec, spawn: MapResourceSpawn): ResourceNodeSpec {
  const { deposit } = spec;
  if (deposit === undefined) return spec; // a felled tree or a pluck-whole node: no valency, no ladder
  const { maxValency, growth } = spawn;
  const units = maxValency ?? spec.remaining;
  return {
    ...spec,
    remaining: growth === undefined ? units : authoredDepositUnits(units, growth.level, growth.states),
    deposit: { ...deposit, initial: units, levels: maxValency ?? deposit.levels },
  };
}

/** What {@link spawnMapResources} made: the node count plus each spawned entity's placement ordinal in
 *  `objects.placements` - the join back to the static layer's drawn sprite for the same placement, so the
 *  `?map=` entry can hand a first-worked node from the built-once static layer to the live sprite pool. */
export interface MapResourceSpawnResult {
  readonly spawned: number;
  readonly placementByEntity: ReadonlyMap<Entity, number>;
}

/**
 * Spawn every harvestable resource node a decoded map's placed objects define (trees → wood, ore outcrops →
 * iron/gold, clay/stone → mud/stone) as real `Resource` sim nodes - the same component set the admin
 * `placeResource` builds (Position + Resource + footprint + Felling|MineDeposit), assembled directly here as
 * scene setup pre-tick-0 (the sanctioned exception, like {@link import('./place/index.js').placeResourceNode}). This
 * is what makes a map's own trees hoverable + gatherable.
 *
 * The nodes are created in the map's native placement order, so ids are minted deterministically. Fell/mine
 * parameters reuse the gatherer catalog defaults (`resourceSpecFor`); a deposit is then resized and
 * part-mined from its own record ({@link withRecordDeposit}), while a tree authored as a sapling still
 * spawns at the full wood yield - a tree's level is a growth stage it would grow out of, not a stock, and a
 * felled tree never draws its standing frame from the pool. Each spawn carries its placement's own `gfxIndex` (the species
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
  for (const spawn of mapResourceSpawns(objects, ir, SPAWNABLE_GOOD_IDS)) {
    const { goodId, gfxIndex, hx, hy, placement } = spawn;
    const g = GATHERER_BY_GOOD_ID.get(goodId);
    if (g === undefined) continue; // filtered by SPAWNABLE_GOOD_IDS already, but keep the type honest
    const spec = { ...withRecordDeposit(resourceSpecFor(g, hx, hy), spawn), gfxIndex };
    const e = systems.createResourceNode(sim.world, sim.content, spec);
    if (e !== null) {
      spawned++;
      placementByEntity.set(e, placement);
    } else {
      unspawnable++;
    }
  }
  if (unspawnable > 0) {
    // A latent collision hole: these placements were skipped from the static collision bake
    // (mapResourceObjectNames) on the promise of a dynamic footprint that never materialised (the
    // good has no footprint record in the sim content) - a drawn object settlers walk through.
    diag.warn(
      'content',
      `spawnMapResources: ${unspawnable} harvestable placements failed to spawn (no sim-content footprint) - they block nothing`,
    );
  }
  return { spawned, placementByEntity };
}

/**
 * Spawn every forageable berry bush a decoded map's placed objects define (fruited-bush objects →
 * ripe {@link components.BerryBush} entities), assembled directly here as pre-tick-0 scene setup (the
 * sanctioned exception, like {@link spawnMapResources}). This is what makes a map's own bushes actual
 * wild food a hungry settler forages.
 *
 * Bushes carry no footprint (walkable in the original), so - unlike {@link spawnMapResources} - nothing
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
