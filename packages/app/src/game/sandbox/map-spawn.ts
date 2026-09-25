import type { ContentSet, TerrainObjects } from '@open-northland/data';
import { type Entity, type ResourceNodeSpec, type Simulation, systems } from '@open-northland/sim';
import type { ContentIr } from '../../content/ir/rows.js';
import { mapPalisadeSpawns } from '../../content/map-palisades.js';
import {
  type MapResourceSpawn,
  mapBerryBushSpawns,
  mapChestSpawns,
  mapFieldSpawns,
  mapGroundGoodsSpawns,
  mapResourceSpawns,
} from '../../content/map-resources.js';
import { diag } from '../../diag/index.js';
import { GATHERERS, type GathererSpec } from './ids/index.js';
import { resourceSpecFor } from './place/index.js';

/** A decoded-map object whose good sits outside this set stays render-only decor. */
const SPAWNABLE_GOOD_IDS: ReadonlySet<string> = new Set(GATHERERS.map((g) => g.id));

/** Keyed by goodId string, the bridge across the IR's original good numbering and the app's ids. */
const GATHERER_BY_GOOD_ID: ReadonlyMap<string, GathererSpec> = new Map(GATHERERS.map((g) => [g.id, g]));

/**
 * The starting yield of a deposit placement authored below full: its 1-based `lmlv` level of `states`
 * scaled onto the deposit's full `units`. Floored rather than rounded, because the render's fill bucket
 * rounds up, so flooring lands the node on the exact state the static object layer drew.
 *
 * Source basis: `lmlv` is a live per-placement valency rather than decor variety, because
 * `[GfxLandscape]` keys each frame list by an explicit valency value.
 */
export function authoredDepositUnits(units: number, level: number, states: number): number {
  return Math.min(units, Math.max(1, Math.floor((units * level) / states)));
}

/**
 * Size a mined placement's deposit from its own `[GfxLandscape]` record and start it at the authored
 * `lmlv` level, so level L spawns L units on state L. A record with no valency keeps the catalog size.
 * `initial` is the full size rather than the starting `remaining`, so a part-mined deposit's decal
 * continues from the state the static layer drew instead of snapping to near-full on the first chip.
 *
 * Source basis: readable semantics, scoped. `LogicMaximumValency` is a capacity, not a stated unit
 * count, so reading it as units holds only for a record authoring one fill state per valency step.
 * Every mined record does (`maxValency === frames.length` across all 32), which
 * `test/content/ir-invariants.test.ts` pins over real content.
 */
export function withRecordDeposit(spec: ResourceNodeSpec, spawn: MapResourceSpawn): ResourceNodeSpec {
  const { deposit } = spec;
  if (deposit === undefined) return spec; // a felled tree or a pluck-whole node has no valency ladder
  const { maxValency, growth } = spawn;
  const units = maxValency ?? spec.remaining;
  return {
    ...spec,
    remaining: growth === undefined ? units : authoredDepositUnits(units, growth.level, growth.states),
    deposit: { ...deposit, initial: units, levels: maxValency ?? deposit.levels },
  };
}

/** `placementByEntity` holds each spawned entity's ordinal in `objects.placements`, the join back to the
 *  static layer's drawn sprite for the same placement. */
export interface MapResourceSpawnResult {
  readonly spawned: number;
  readonly placementByEntity: ReadonlyMap<Entity, number>;
}

export interface MapFieldSpawnResult extends MapResourceSpawnResult {
  /** Remove every promoted field from the static layer, including fields buried under a building. */
  readonly retiredPlacements: readonly number[];
}

/** Map-authored growing fields use the same Crop loop as fields a farmer sows later. */
export function spawnMapFields(sim: Simulation, objects: TerrainObjects, ir: ContentIr): MapFieldSpawnResult {
  const farmed = new Map(
    sim.content.goods.filter((good) => good.farming !== undefined).map((good) => [good.id, good.typeId]),
  );
  const placementByEntity = new Map<Entity, number>();
  const retiredPlacements: number[] = [];
  for (const field of mapFieldSpawns(objects, ir, new Set(farmed.keys()))) {
    retiredPlacements.push(field.placement);
    const goodType = farmed.get(field.goodId);
    if (goodType === undefined) continue;
    const entity = systems.createMapCrop(sim.world, sim.content, {
      goodType,
      x: field.hx,
      y: field.hy,
      stage: field.stage,
      gfxIndex: field.gfxIndex,
      landscapeId: field.placement,
    });
    if (entity !== null) placementByEntity.set(entity, field.placement);
  }
  return { spawned: placementByEntity.size, placementByEntity, retiredPlacements };
}

/**
 * Direct scene assembly, valid pre-tick-0 only. Nodes are created in the map's native placement order,
 * so ids mint deterministically. A tree authored as a sapling still spawns at the full wood yield,
 * because a tree's level is a growth stage rather than a stock. A placement whose good has no gatherer
 * trade or no footprint is skipped, not fatal.
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
    if (g === undefined) continue;
    const spec = {
      ...withRecordDeposit(resourceSpecFor(g, hx, hy), spawn),
      gfxIndex,
      ...(sim.terrain?.landscapes !== undefined ? { landscapeId: placement } : {}),
    };
    const e = systems.createResourceNode(sim.world, sim.content, spec);
    if (e !== null) {
      spawned++;
      placementByEntity.set(e, placement);
    } else {
      unspawnable++;
    }
  }
  if (unspawnable > 0) {
    // A latent collision hole: the static bake skipped these placements on the promise of a dynamic
    // footprint that never materialised, leaving a drawn object settlers walk through.
    diag.warn(
      'content',
      `spawnMapResources: ${unspawnable} harvestable placements failed to spawn (no sim-content footprint) - they block nothing`,
    );
  }
  return { spawned, placementByEntity };
}

/**
 * The placement ordinals a fresh build turns into sim entities, applying the same skips as
 * {@link spawnMapResources}. A restored boot retires these placements' static sprites and pool-draws
 * the loaded nodes, because the static bake only matches a virgin world.
 */
export function harvestablePlacementOrdinals(
  content: ContentSet,
  objects: TerrainObjects,
  ir: ContentIr,
): number[] {
  const out: number[] = [];
  for (const spawn of mapResourceSpawns(objects, ir, SPAWNABLE_GOOD_IDS)) {
    const g = GATHERER_BY_GOOD_ID.get(spawn.goodId);
    if (g === undefined || systems.resourceFootprintForGood(content, g.good) === null) continue;
    out.push(spawn.placement);
  }
  const farmed = new Set(content.goods.filter((good) => good.farming !== undefined).map((good) => good.id));
  for (const field of mapFieldSpawns(objects, ir, farmed)) out.push(field.placement);
  for (const bush of mapBerryBushSpawns(objects, ir)) out.push(bush.placement);
  for (const chest of mapChestSpawns(objects, ir)) out.push(chest.placement);
  const goodBySlug = new Map(content.goods.map((good) => [good.id, good.typeId]));
  for (const goods of mapGroundGoodsSpawns(objects, ir)) {
    if (goodBySlug.has(goods.goodId)) out.push(goods.placement);
  }
  for (const wall of mapPalisadeSpawns(objects, ir)) out.push(wall.placement);
  return out;
}

/**
 * Direct scene assembly, valid pre-tick-0 only, in native placement order so ids mint deterministically.
 * Bushes are walkable in the original, so nothing here is skipped from the static collision bake and the
 * placement join serves only the render handover.
 */
export function spawnMapBerryBushes(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { gfxIndex, hx, hy, placement } of mapBerryBushSpawns(objects, ir)) {
    const e = systems.createBerryBush(sim.world, {
      x: hx,
      y: hy,
      gfxIndex,
      ...(sim.terrain?.landscapes !== undefined ? { landscapeId: placement } : {}),
    });
    placementByEntity.set(e, placement);
    spawned++;
  }
  return { spawned, placementByEntity };
}

/**
 * Direct scene assembly, valid pre-tick-0 only, in native placement order so ids mint deterministically.
 * A goods object is a loose heap of the good, so a settler can be sent to wear or haul it exactly like a
 * dropped one; the join retires the static sprite the goods sheet now draws over. A good the world's
 * content lacks lays no heap and is counted; every non-void good of the real content is present, so only
 * a catalog fallback reaches that branch (on a scripted map, `scriptLandscapeTypes` would still have
 * marked the placement resource-backed).
 */
export function spawnMapGroundGoods(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  let unknown = 0;
  const placementByEntity = new Map<Entity, number>();
  const goodBySlug = new Map(sim.content.goods.map((good) => [good.id, good.typeId]));
  for (const { goodId, hx, hy, amount, placement } of mapGroundGoodsSpawns(objects, ir)) {
    const goodType = goodBySlug.get(goodId);
    if (goodType === undefined) {
      unknown++;
      continue;
    }
    const e = systems.createGroundGoods(sim.world, {
      goodType,
      amount,
      x: hx,
      y: hy,
      ...(sim.terrain?.landscapes !== undefined ? { landscapeId: placement } : {}),
    });
    placementByEntity.set(e, placement);
    spawned++;
  }
  if (unknown > 0) {
    diag.warn(
      'content',
      `spawnMapGroundGoods: ${unknown} goods placements name a good outside the world's content - no heap laid`,
    );
  }
  return { spawned, placementByEntity };
}

/**
 * Direct scene assembly, valid pre-tick-0 only, in native placement order so ids mint deterministically.
 * A chest blocks like a resource node, so its placement is out of the static collision bake and the join
 * serves both the render handover and the dynamic footprint.
 */
export function spawnMapChests(
  sim: Simulation,
  objects: TerrainObjects,
  ir: ContentIr,
): MapResourceSpawnResult {
  let spawned = 0;
  const placementByEntity = new Map<Entity, number>();
  for (const { kind, gfxIndex, hx, hy, contents, placement } of mapChestSpawns(objects, ir)) {
    const e = systems.createChest(sim.world, sim.content, {
      kind,
      contents,
      x: hx,
      y: hy,
      gfxIndex,
      ...(sim.terrain?.landscapes !== undefined ? { landscapeId: placement } : {}),
    });
    placementByEntity.set(e, placement);
    spawned++;
  }
  return { spawned, placementByEntity };
}
