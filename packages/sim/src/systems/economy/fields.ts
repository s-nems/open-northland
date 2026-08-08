import type { GoodFarming } from '@open-northland/data';
import { Building, Crop, Position, Resource } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { coordHash } from '../../core/coord-hash.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import {
  buildingBlockedCells,
  dynamicBlockOverlay,
  stampResourceFootprintOrFallback,
  unstampResourceFootprint,
} from '../footprint/index.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { stockpilesAtNode } from '../spatial/stockpiles.js';

// Field farming: the content resolution, growth system, and atomic-effect appliers behind the farm's
// sow, water, grow and reap loop. Source basis: the loop's vocabulary is readable original data
// (`goodtypes.ini` wheat atomics 34/35/29 plus `isProducedOnMapFlag`, `landscapetypes.ini` wheat lanes
// 27/28/29 with `maximumValency 5`); its timings and areas are the content `farming` block's calibration
// constants, since no readable growth timing or field radius exists.

// Watering is the growth fuel: a field grows only while `watered` and every stage step consumes it, so a
// field needs one sowing plus one watering per stage and the farm's throughput is its farmers' labor rather
// than a wall-clock timer. Calibrated against the original's observed ~10 grain per farmer per 10 minutes,
// up to the farm's four slots, on a plot of ~24 plants per crew. Approximation: the cultivate atomic exists
// in the readable data (id 35, the watering-can animation) but its engine-side effect is not decoded. An
// untended field stands at its stage and deadlocks nothing.

/** Distinct growth paces a field can be sown into, spread evenly across the good's `growthSpreadPercent`
 *  band. Approximation: enough to keep a plot of a couple of dozen fields visibly out of step. */
const GROWTH_BANDS = 8;

/**
 * The per-stage growth time of a field sown at half-cell node `(x, y)`: the good's nominal `ticksPerStage`
 * shifted into one of {@link GROWTH_BANDS} paces spanning ±`growthSpreadPercent`. A pure coordinate hash,
 * never `world.rng`, so a field's pace is byte-stable across runs and replays; clamped to at least one tick.
 * Approximation: the spread keeps a burst-sown plot from ripening in one mass harvest, matching the mixed
 * heights the original shows, whose per-plant timing is not decoded.
 */
function stageTicksAt(farming: GoodFarming, x: number, y: number): number {
  const spread = farming.growthSpreadPercent;
  if (spread === 0) return farming.ticksPerStage;
  const band = coordHash(x, y) % GROWTH_BANDS;
  const percent = -spread + Math.floor((2 * spread * band) / (GROWTH_BANDS - 1)); // -spread..+spread
  return Math.max(1, Math.floor((farming.ticksPerStage * (100 + percent)) / 100));
}

/** A field-farmed good's resolved loop parameters: its content `farming` block plus the
 *  `atomicForPlanting` / `atomicForCultivating` / `atomicForHarvesting` ids. */
export interface FarmingSpec {
  readonly goodType: number;
  readonly farming: GoodFarming;
  readonly plantAtomic: number;
  readonly cultivateAtomic: number;
  readonly harvestAtomic: number;
}

/**
 * Resolve a good's {@link FarmingSpec}, or null when it is not field-farmed: no `farming` block, or any of
 * the three loop atomics missing.
 */
function farmingSpecFor(ctx: SystemContext, goodType: number): FarmingSpec | null {
  const good = contentIndex(ctx.content).goods.get(goodType);
  if (good?.farming === undefined) return null;
  const { plant, cultivate, harvest } = good.atomics;
  if (plant === undefined || cultivate === undefined || harvest === undefined) return null;
  return {
    goodType,
    farming: good.farming,
    plantAtomic: plant,
    cultivateAtomic: cultivate,
    harvestAtomic: harvest,
  };
}

/**
 * The field-farmed good a workplace cultivates, or null when it farms none: the first of the building type's
 * `produces` goods that resolves a {@link FarmingSpec}, a fixed content array so the pick is deterministic.
 * The data-driven farm test, never a hardcoded building-type id.
 */
export function farmWorkGood(world: World, ctx: SystemContext, workplace: Entity): FarmingSpec | null {
  const b = world.tryGet(workplace, Building);
  if (b === undefined) return null;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return null;
  for (const goodType of type.produces) {
    const spec = farmingSpecFor(ctx, goodType);
    if (spec !== null) return spec;
  }
  return null;
}

/** Whether a resource, field or stockpile already occupies half-cell node `(hx, hy)` for sowing purposes.
 *  Both halves of the sow race share this rule, so it must read live state: a field or heap that landed on
 *  the node since the planner chose it still has to reject the swing. A membership test, so the node
 *  indexes' superset answers need no canonical ordering; the walls half is {@link applySow}'s block check. */
export function sowNodeOccupied(world: World, hx: number, hy: number): boolean {
  return stockpilesAtNode(world, hx, hy).length > 0 || resourcesAtNode(world, hx, hy).length > 0;
}

/**
 * Apply a completed `sow` swing: plant a {@link Crop} field of `goodType` for `farm` at half-cell node
 * `(x, y)`. A node taken since the planner chose it plants nothing, the same raced-target no-op stance
 * every goods effect takes. The field starts at stage 1 with `Resource.remaining` 0, which is the gate
 * that keeps the generic harvest scans off an unripe field.
 */
export function applySow(
  world: World,
  ctx: SystemContext,
  effect: { farm: Entity; goodType: number; x: number; y: number },
): void {
  const spec = farmingSpecFor(ctx, effect.goodType);
  if (spec === null) return; // content changed under the swing
  // Grain grows only on plantable ground (the original's `biocanplanton` class - grass, never sand); the
  // planner already filters, this is the completion-time re-check every goods effect carries.
  if (ctx.terrain !== undefined && !ctx.terrain.isPlantable(ctx.terrain.nodeAtClamped(effect.x, effect.y)))
    return;
  if (sowNodeOccupied(world, effect.x, effect.y)) return;
  // Blocked since the planner chose it: a field there would be unreachable from birth, and only the
  // building paths have a clearing pass. Tests the same memoized overlay `nextSowNode` filtered on, since a
  // narrower one would admit a node the planner had rejected.
  if (ctx.terrain !== undefined) {
    const node = ctx.terrain.nodeAtClamped(effect.x, effect.y);
    if (dynamicBlockOverlay(world, ctx, ctx.terrain).has(node)) return;
  }
  const e = world.create();
  world.add(e, Position, positionOfNode(effect.x, effect.y));
  world.add(e, Resource, { goodType: effect.goodType, remaining: 0, harvestAtomic: spec.harvestAtomic });
  // Landscape-derived on real content, anchor-only on fixture content whose farmed good ships no record.
  stampResourceFootprintOrFallback(world, ctx.content, e, effect.goodType);
  world.add(e, Crop, {
    goodType: effect.goodType,
    farm: effect.farm,
    stage: 1,
    stages: spec.farming.stages,
    growth: 0,
    ticksPerStage: stageTicksAt(spec.farming, effect.x, effect.y),
    watered: false,
    yieldUnits: spec.farming.yieldPerField,
  });
}

/** Apply a completed `water` (cultivate) swing: mark the field `watered`, fueling one stage of growth. */
export function applyWater(world: World, crop: Entity): void {
  const c = world.tryGet(crop, Crop);
  if (c === undefined || c.watered || c.stage >= c.stages) return;
  world.mut(crop, Crop).watered = true;
}

/**
 * Destroy every field standing under `building`'s walls. A field is worked from the node it stands on, so a
 * wall over that node puts it permanently out of reach and it would hold one of the farm's `maxFields`
 * slots forever. Only cells the building actually makes unwalkable clear a field, unlike the decor razing
 * passes which clear the whole reserved zone. Bounded by the footprint: one node probe per blocked cell.
 */
export function destroyFieldsUnderBuilding(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  // The world's derived block set, not the raw footprint cells: it carves the door back out, so a field on
  // the passable gate cell survives.
  const blocked = buildingBlockedCells(world, ctx, terrain);
  for (const cell of translatedCells(terrain, footprint.blocked, hx, hy)) {
    if (!blocked.has(cell)) continue;
    const at = terrain.coordsOf(cell);
    // Copied first: the probe hands back the index's live node bucket, which the destroys below splice.
    for (const e of [...resourcesAtNode(world, at.x, at.y)]) {
      if (!world.has(e, Crop)) continue;
      unstampResourceFootprint(world, e);
      world.destroy(e);
    }
  }
}

/**
 * Advance every watered field's integer growth counter and step its stage; each step consumes the watering.
 * At the final stage {@link Resource.remaining} becomes the sown `yieldUnits`, which is what makes the field
 * harvestable. Per-field independent integer mutation with no cross-entity pick, so store-order iteration is
 * fine, and the stage step is the exact compare `growth >= ticksPerStage` rather than an accumulated fraction.
 */
export const cropGrowthSystem: System = (world) => {
  for (const e of world.query(Crop)) {
    const crop = world.get(e, Crop);
    if (crop.stage >= crop.stages) continue; // ripe - waiting for the scythe
    if (!crop.watered) continue;
    let ripened = false;
    const c = world.mut(e, Crop);
    c.growth += 1;
    if (c.growth >= c.ticksPerStage) {
      c.growth -= c.ticksPerStage;
      c.stage += 1;
      c.watered = false;
      ripened = c.stage >= c.stages;
      if (ripened) c.growth = 0; // frozen so the display is stable
    }
    if (ripened && world.has(e, Resource)) {
      world.mut(e, Resource).remaining = crop.yieldUnits;
    }
  }
};
